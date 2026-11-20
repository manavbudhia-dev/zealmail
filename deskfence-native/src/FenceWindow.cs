using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Threading;

namespace DeskFence
{
    /// <summary>
    /// One fence: a small borderless window that lives just above the Desktop. It never takes the
    /// keyboard focus or comes up over your apps when clicked (except while renaming, and during Peek).
    /// </summary>
    internal sealed class FenceWindow : Window
    {
        public FenceData Data { get; }
        readonly DeskFenceApp app;
        IntPtr hwnd;
        bool allowActivate;

        Theme.Look look;
        readonly Border frame = new Border();
        readonly Grid header = new Grid();
        readonly TextBlock title = new TextBlock();
        readonly TextBox titleEdit = new TextBox();
        readonly Grid tabsPanel = new Grid();
        /// <summary>Room around the visible fence for its shadow: the window is this much bigger on each side.</summary>
        const double Pad = 6;
        readonly Button optionsButton = new Button();
        readonly ScrollViewer body = new ScrollViewer();
        readonly WrapPanel itemsPanel = new WrapPanel();
        readonly TextBlock emptyText = new TextBlock();
        readonly Thumb resizeGrip = new Thumb();
        readonly Border dropHint = new Border();
        readonly DispatcherTimer rollupTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
        bool hovered;
        string selectedItemId;

        // search, browsing a sub-folder, Details view, privacy (view state only, never saved)
        readonly Button searchButton = new Button();
        readonly Border searchBar = new Border();
        readonly TextBox searchBox = new TextBox();
        readonly Grid detailsHeader = new Grid();
        readonly TextBlock detailsTitle = new TextBlock();
        readonly TextBox detailsSearch = new TextBox();
        readonly Border browseBar = new Border();
        readonly TextBlock browseName = new TextBlock();
        readonly StackPanel detailsPanel = new StackPanel();
        readonly Border privacyOverlay = new Border();
        readonly DispatcherTimer revealTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
        string search; // null = no search box (icon view)
        string browsePath;
        List<JsonObject> browseItems;
        string detailsSort = "name";
        bool detailsAscending = true;
        bool revealed;
        /// <summary>A dialog of this fence (Customize, Rules) is open: never mask it while you work on it.</summary>
        public bool DialogOpen { get; set; }

        bool Details => (Theme.Str(Data.Raw["view"]) ?? (string.IsNullOrEmpty(Data.PortalPath) ? "icons" : "details")) == "details";
        bool IsPrivate => (Data.Raw["privacy"] is JsonValue pv && pv.TryGetValue(out bool pb) && pb) || app.PrivacyAll;

        public FenceWindow(DeskFenceApp app, FenceData data)
        {
            this.app = app;
            Data = data;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ShowInTaskbar = false;
            ShowActivated = false;
            ResizeMode = ResizeMode.NoResize;
            Title = "DeskFence - " + data.Name;
            Width = data.Width + Pad * 2;
            Height = data.Height + Pad * 2;
            AllowDrop = true;
            UseLayoutRounding = true;
            SnapsToDevicePixels = true;
            TextOptions.SetTextFormattingMode(this, TextFormattingMode.Display);

            BuildChrome();
            Refresh();

            MouseEnter += (_, __) => SetHovered(true);
            MouseLeave += (_, __) => SetHovered(false);
            revealTimer.Tick += (_, __) =>
            {
                revealTimer.Stop();
                revealed = true;
                ApplyMask();
            };
            rollupTimer.Tick += (_, __) =>
            {
                rollupTimer.Stop();
                if (!IsMouseOver) ApplyRolledUp();
            };
            DragEnter += OnDragOver;
            DragOver += OnDragOver;
            DragLeave += (_, __) =>
            {
                dropHint.Visibility = Visibility.Collapsed;
                ApplyMask(); // a private fence hides again when the drag leaves
            };
            Drop += OnDrop;
            PreviewMouseDown += (_, __) =>
            {
                selectedItemId = null;
                FluentMenu.CloseOpen();
            };
        }

        // ================= window plumbing =================
        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            hwnd = new WindowInteropHelper(this).Handle;
            long ex = Native.GetExStyle(hwnd);
            ex = (ex | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE) & ~Native.WS_EX_APPWINDOW; // not in Alt+Tab, never steals focus
            Native.SetExStyle(hwnd, ex);
            PinToDesktop();
            HwndSource.FromHwnd(hwnd).AddHook(WndProc);
            Place();
        }

        /// <summary>Owned by the Desktop window: stays above the wallpaper/icons, survives "Show desktop".</summary>
        public void PinToDesktop()
        {
            if (hwnd == IntPtr.Zero) return;
            IntPtr host = Native.DesktopHost();
            if (host != IntPtr.Zero) Native.SetWindowLongPtr(hwnd, Native.GWLP_HWNDPARENT, host);
            SendToBottom();
        }

        public void SendToBottom()
        {
            if (hwnd != IntPtr.Zero)
                Native.SetWindowPos(hwnd, Native.HWND_BOTTOM, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
        }

        public void SetTopmost(bool on)
        {
            if (hwnd == IntPtr.Zero) return;
            Native.SetWindowPos(hwnd, on ? Native.HWND_TOPMOST : Native.HWND_NOTOPMOST, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
            if (!on) SendToBottom();
        }

        IntPtr WndProc(IntPtr h, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            switch (msg)
            {
                case Native.WM_MOUSEACTIVATE:
                    if (!allowActivate)
                    {
                        handled = true;
                        return new IntPtr(Native.MA_NOACTIVATE);
                    }
                    break;
                case Native.WM_WINDOWPOSCHANGING:
                    // keep the fence down on the Desktop: nothing may raise it above the apps (Peek may)
                    if (!app.Peeking)
                    {
                        var pos = System.Runtime.InteropServices.Marshal.PtrToStructure<Native.WINDOWPOS>(lParam);
                        if ((pos.flags & Native.SWP_NOZORDER) == 0 && pos.hwndInsertAfter != Native.HWND_BOTTOM)
                        {
                            pos.hwndInsertAfter = Native.HWND_BOTTOM;
                            System.Runtime.InteropServices.Marshal.StructureToPtr(pos, lParam, false);
                        }
                    }
                    break;
                case Native.WM_EXITSIZEMOVE:
                    SaveBounds();
                    break;
            }
            return IntPtr.Zero;
        }

        /// <summary>Puts the window where the fence is saved (real pixels, right monitor).</summary>
        public void Place()
        {
            if (hwnd == IntPtr.Zero) return;
            var (x, y, monitor) = Screens.ToScreen(Data.X, Data.Y, Data.Width, Data.ScreenDevice);
            int pad = (int)Math.Round(Pad * (monitor?.Scale ?? 1));
            Native.SetWindowPos(hwnd, IntPtr.Zero, x - pad, y - pad, 0, 0, Native.SWP_NOSIZE | Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
            Width = Data.Width + Pad * 2;
            ApplyRolledUp();
        }

        void SaveBounds()
        {
            if (hwnd == IntPtr.Zero || !Native.GetWindowRect(hwnd, out var rect)) return;
            var monitor = Native.MonitorAt(new Native.POINT { X = (rect.Left + rect.Right) / 2, Y = (rect.Top + rect.Bottom) / 2 });
            int pad = (int)Math.Round(Pad * monitor.Scale);
            // the visible fence starts `Pad` inside the window
            var visible = new Native.RECT { Left = rect.Left + pad, Top = rect.Top + pad, Right = rect.Right - pad, Bottom = rect.Bottom - pad };
            var (x, y, device) = Screens.FromScreen(visible);
            double height = IsRolledUp ? Data.Height : ActualHeight - Pad * 2;
            Data.SetBounds(x, y, ActualWidth - Pad * 2, height, device);
            app.SaveSoon();
        }

        void AllowFocus(bool on)
        {
            allowActivate = on;
            if (hwnd == IntPtr.Zero) return;
            long ex = Native.GetExStyle(hwnd);
            Native.SetExStyle(hwnd, on ? ex & ~Native.WS_EX_NOACTIVATE : ex | Native.WS_EX_NOACTIVATE);
            if (on)
            {
                Activate();
                Native.SetForegroundWindow(hwnd);
            }
        }

        // ================= layout =================
        void BuildChrome()
        {
            var root = new Grid();
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // header
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // search box (icon view)
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); // inside a sub-folder
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) }); // items

            // header: centered title (or tabs) + the options button that shows on hover
            header.Background = Brushes.Transparent; // hit-testable, so the whole bar drags
            header.Cursor = Cursors.SizeAll;
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(52) });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(24) });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(28) });

            title.TextTrimming = TextTrimming.CharacterEllipsis;
            title.FontWeight = FontWeights.SemiBold;
            title.VerticalAlignment = VerticalAlignment.Center;
            title.Margin = new Thickness(0, 5, 0, 5);
            Grid.SetColumn(title, 1);
            header.Children.Add(title);

            titleEdit.Visibility = Visibility.Collapsed;
            titleEdit.Background = new SolidColorBrush(Color.FromArgb(70, 0, 0, 0));
            titleEdit.BorderThickness = new Thickness(0, 0, 0, 1);
            titleEdit.HorizontalContentAlignment = HorizontalAlignment.Center;
            titleEdit.Margin = new Thickness(0, 3, 0, 3);
            titleEdit.KeyDown += (_, e) =>
            {
                if (e.Key == Key.Enter) EndRename(true);
                if (e.Key == Key.Escape) EndRename(false);
            };
            titleEdit.LostKeyboardFocus += (_, __) => EndRename(true);
            Grid.SetColumn(titleEdit, 1);
            header.Children.Add(titleEdit);

            tabsPanel.HorizontalAlignment = HorizontalAlignment.Stretch;
            tabsPanel.Visibility = Visibility.Collapsed;
            Grid.SetColumn(tabsPanel, 0);
            Grid.SetColumnSpan(tabsPanel, 3);
            header.Children.Add(tabsPanel);

            optionsButton.Content = "⋯";
            optionsButton.Width = 24;
            optionsButton.Height = 22;
            optionsButton.Padding = new Thickness(0);
            optionsButton.Background = Brushes.Transparent;
            optionsButton.BorderThickness = new Thickness(0);
            optionsButton.Cursor = Cursors.Hand;
            optionsButton.Opacity = 0;
            optionsButton.ToolTip = "Fence options";
            optionsButton.Focusable = false;
            optionsButton.Click += (_, __) => ShowOptionsMenu(optionsButton);
            Grid.SetColumn(optionsButton, 3);
            header.Children.Add(optionsButton);

            searchButton.Content = new TextBlock { Text = "\uE721", FontFamily = new FontFamily("Segoe Fluent Icons, Segoe MDL2 Assets"), FontSize = 12 };
            searchButton.Width = 22;
            searchButton.Height = 22;
            searchButton.Padding = new Thickness(0);
            searchButton.Background = Brushes.Transparent;
            searchButton.BorderThickness = new Thickness(0);
            searchButton.Cursor = Cursors.Hand;
            searchButton.Opacity = 0;
            searchButton.Focusable = false;
            searchButton.ToolTip = "Search this fence";
            searchButton.Click += (_, __) =>
            {
                if (search == null) OpenSearch(searchBox);
                else CloseSearch();
            };
            Grid.SetColumn(searchButton, 2);
            header.Children.Add(searchButton);

            // Details view: the name as a tab on the left, a search box on the right (Folder Portal look)
            detailsHeader.Visibility = Visibility.Collapsed;
            detailsHeader.Margin = new Thickness(6, 4, 0, 4);
            detailsHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            detailsHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            detailsTitle.FontWeight = FontWeights.SemiBold;
            detailsTitle.TextTrimming = TextTrimming.CharacterEllipsis;
            detailsTitle.HorizontalAlignment = HorizontalAlignment.Center;
            detailsTitle.VerticalAlignment = VerticalAlignment.Center;
            var pill = new Border { Child = detailsTitle, CornerRadius = new CornerRadius(4), Padding = new Thickness(8, 3, 8, 3), Margin = new Thickness(0, 0, 6, 0) };
            pill.Name = "pill";
            detailsHeader.Children.Add(pill);
            StyleSearchBox(detailsSearch, "Search");
            Grid.SetColumn(detailsSearch, 1);
            detailsHeader.Children.Add(detailsSearch);
            Grid.SetColumn(searchHints[detailsSearch], 1);
            detailsHeader.Children.Add(searchHints[detailsSearch]);
            Grid.SetColumn(detailsHeader, 0);
            Grid.SetColumnSpan(detailsHeader, 3);
            header.Children.Add(detailsHeader);

            header.MouseLeftButtonDown += (_, e) =>
            {
                if (e.ClickCount == 2 && !Data.HasTabs) { StartRename(); e.Handled = true; return; }
                if (!Data.IsLocked && e.ButtonState == MouseButtonState.Pressed)
                {
                    try { DragMove(); } catch (InvalidOperationException) { /* button already released */ }
                    SaveBounds();
                }
            };
            header.MouseRightButtonUp += (_, e) =>
            {
                ShowOptionsMenu(header);
                e.Handled = true;
            };
            Grid.SetRow(header, 0);
            root.Children.Add(header);

            // body: the items
            body.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
            body.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
            body.Padding = new Thickness(4, 0, 4, 6);
            var bodyGrid = new Grid();
            itemsPanel.Orientation = Orientation.Horizontal;
            bodyGrid.Children.Add(itemsPanel);
            bodyGrid.Children.Add(detailsPanel);
            emptyText.HorizontalAlignment = HorizontalAlignment.Center;
            emptyText.VerticalAlignment = VerticalAlignment.Center;
            emptyText.Opacity = 0.5;
            emptyText.Margin = new Thickness(0, 12, 0, 12);
            emptyText.FontSize = 11;
            bodyGrid.Children.Add(emptyText);
            body.Content = bodyGrid;
            body.MouseLeftButtonDown += (_, __) => Select(null);
            Grid.SetRow(body, 3);
            root.Children.Add(body);

            // search box under the title (icon view)
            StyleSearchBox(searchBox, "Search this fence…");
            searchBar.Child = new Grid { Children = { searchBox, searchHints[searchBox] } };
            searchBar.Padding = new Thickness(8, 0, 8, 6);
            searchBar.Visibility = Visibility.Collapsed;
            Grid.SetRow(searchBar, 1);
            root.Children.Add(searchBar);

            // inside a sub-folder of the folder this fence shows: Back, its name, open in Explorer
            var browseGrid = new Grid();
            browseGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            browseGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            browseGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var back = SmallButton("\uE72B", "Back", "Back", () => GoUp());
            browseGrid.Children.Add(back);
            browseName.VerticalAlignment = VerticalAlignment.Center;
            browseName.TextTrimming = TextTrimming.CharacterEllipsis;
            browseName.Margin = new Thickness(8, 0, 8, 0);
            browseName.Opacity = 0.8;
            Grid.SetColumn(browseName, 1);
            browseGrid.Children.Add(browseName);
            var openHere = SmallButton("\uE8A7", null, "Open this folder in File Explorer", () => { if (browsePath != null) app.Open(browsePath); });
            Grid.SetColumn(openHere, 2);
            browseGrid.Children.Add(openHere);
            browseBar.Child = browseGrid;
            browseBar.Padding = new Thickness(8, 0, 8, 4);
            browseBar.Visibility = Visibility.Collapsed;
            Grid.SetRow(browseBar, 2);
            root.Children.Add(browseBar);

            // privacy: contents blurred until the mouse rests on the fence
            privacyOverlay.IsHitTestVisible = false;
            privacyOverlay.Visibility = Visibility.Collapsed;
            privacyOverlay.Child = new Border
            {
                Background = new SolidColorBrush(Color.FromArgb(110, 0, 0, 0)),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(8, 2, 8, 2),
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                Child = new TextBlock { Text = "Private · hover to show", Foreground = Brushes.White, FontSize = 11 },
            };
            Grid.SetRow(privacyOverlay, 1);
            Grid.SetRowSpan(privacyOverlay, 3);
            root.Children.Add(privacyOverlay);

            // a dashed outline while files are dragged over the fence
            dropHint.BorderThickness = new Thickness(2);
            dropHint.BorderBrush = new SolidColorBrush(Color.FromArgb(200, 96, 165, 250));
            dropHint.Background = new SolidColorBrush(Color.FromArgb(30, 96, 165, 250));
            dropHint.IsHitTestVisible = false;
            dropHint.Visibility = Visibility.Collapsed;
            dropHint.Margin = new Thickness(3);
            Grid.SetRowSpan(dropHint, 4);
            root.Children.Add(dropHint);

            // resize corner (shows on hover)
            resizeGrip.Width = 14;
            resizeGrip.Height = 14;
            resizeGrip.HorizontalAlignment = HorizontalAlignment.Right;
            resizeGrip.VerticalAlignment = VerticalAlignment.Bottom;
            resizeGrip.Cursor = Cursors.SizeNWSE;
            resizeGrip.Opacity = 0;
            resizeGrip.Template = GripTemplate();
            resizeGrip.DragDelta += (_, e) =>
            {
                if (Data.IsLocked) return;
                Width = Math.Max(160 + Pad * 2, Width + e.HorizontalChange);
                Height = Math.Max(60 + Pad * 2, Height + e.VerticalChange);
            };
            resizeGrip.DragCompleted += (_, __) => SaveBounds();
            Grid.SetRow(resizeGrip, 3);
            root.Children.Add(resizeGrip);

            frame.Child = root;
            frame.Margin = new Thickness(Pad); // room for the shadow
            Content = frame;
        }

        static readonly FontFamily IconFont = new FontFamily("Segoe Fluent Icons, Segoe MDL2 Assets");
        readonly System.Collections.Generic.Dictionary<TextBox, TextBlock> searchHints = new System.Collections.Generic.Dictionary<TextBox, TextBlock>();

        // the icon in Windows' icon font, the words in the normal font (the icon font has no letters)
        static UIElement IconAndText(string glyph, string text, double size)
        {
            var panel = new StackPanel { Orientation = Orientation.Horizontal };
            panel.Children.Add(new TextBlock { Text = glyph, FontFamily = IconFont, FontSize = size, VerticalAlignment = VerticalAlignment.Center });
            if (!string.IsNullOrEmpty(text))
                panel.Children.Add(new TextBlock { Text = text, FontSize = size, Margin = new Thickness(5, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center });
            return panel;
        }

        Button SmallButton(string glyph, string text, string tip, Action click)
        {
            var b = new Button
            {
                Content = IconAndText(glyph, text, 11),
                Padding = new Thickness(6, 2, 6, 2),
                Background = new SolidColorBrush(Color.FromArgb(30, 255, 255, 255)),
                BorderThickness = new Thickness(0),
                Cursor = Cursors.Hand,
                Focusable = false,
                ToolTip = tip,
                Template = FluentWindow.PlainButton(Color.FromArgb(60, 255, 255, 255)),
            };
            b.Click += (_, __) => click();
            return b;
        }

        void StyleSearchBox(TextBox box, string placeholder)
        {
            box.Background = new SolidColorBrush(Color.FromArgb(60, 0, 0, 0));
            box.BorderThickness = new Thickness(0, 0, 0, 1);
            box.BorderBrush = new SolidColorBrush(Color.FromArgb(70, 255, 255, 255));
            box.Padding = new Thickness(6, 2, 6, 2);
            box.ToolTip = placeholder;
            box.Tag = placeholder;
            // a "🔍 Search" hint over the box while it is empty and not being typed in
            var hint = new TextBlock { Opacity = 0.55, IsHitTestVisible = false, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(8, 0, 0, 0) };
            hint.Inlines.Add(new System.Windows.Documents.Run("\uE721") { FontFamily = IconFont });
            hint.Inlines.Add(new System.Windows.Documents.Run("  " + placeholder));
            searchHints[box] = hint;
            void ShowHint()
            {
                hint.Foreground = box.Foreground;
                hint.FontSize = box.FontSize;
                hint.Visibility = string.IsNullOrEmpty(box.Text) && !box.IsKeyboardFocused ? Visibility.Visible : Visibility.Collapsed;
            }
            box.Loaded += (_, __) => ShowHint();
            box.TextChanged += (_, __) => ShowHint();
            box.GotKeyboardFocus += (_, __) => ShowHint();
            box.LostKeyboardFocus += (_, __) => ShowHint();
            // typing needs the keyboard, which a fence normally never takes
            box.PreviewMouseDown += (_, __) => { if (!box.IsKeyboardFocused) OpenSearch(box); };
            box.TextChanged += (_, __) =>
            {
                search = box.Text;
                BuildItems();
            };
            box.KeyDown += (_, e) =>
            {
                if (e.Key == Key.Escape) CloseSearch();
            };
            box.LostKeyboardFocus += (_, __) =>
            {
                if (titleEdit.Visibility != Visibility.Visible) AllowFocus(false);
                if (box == searchBox && string.IsNullOrEmpty(box.Text)) CloseSearch();
            };
        }

        void OpenSearch(TextBox box)
        {
            search ??= "";
            if (box == searchBox) searchBar.Visibility = Visibility.Visible;
            AllowFocus(true);
            box.Focus();
            Keyboard.Focus(box);
        }

        void CloseSearch()
        {
            search = Details ? "" : null;
            searchBox.Text = "";
            detailsSearch.Text = "";
            searchBar.Visibility = Visibility.Collapsed;
            AllowFocus(false);
            SendToBottom();
            BuildItems();
        }

        // ================= Folder Portal: browse into sub-folders =================
        /// <summary>Shows a sub-folder of the linked folder inside the fence.</summary>
        public void Browse(string folder)
        {
            var items = app.ListFolder(folder);
            if (items == null)
            {
                app.Notice("Cannot open " + Path.GetFileName(folder));
                return;
            }
            browsePath = folder;
            browseItems = items;
            Refresh();
        }

        void GoUp()
        {
            if (browsePath == null || string.IsNullOrEmpty(Data.PortalPath)) return;
            string parent = Path.GetDirectoryName(browsePath.TrimEnd('\\', '/'));
            if (parent == null || !FileOps.IsInside(parent, Data.PortalPath))
            {
                browsePath = null;
                browseItems = null;
                Refresh();
            }
            else
            {
                Browse(parent);
            }
        }

        // ================= privacy =================
        void ApplyMask()
        {
            bool masked = IsPrivate && !revealed && !DialogOpen && dropHint.Visibility != Visibility.Visible && titleEdit.Visibility != Visibility.Visible;
            body.Effect = masked ? new BlurEffect { Radius = 14, RenderingBias = RenderingBias.Performance } : null;
            body.IsHitTestVisible = !masked;
            searchBar.Opacity = masked ? 0 : 1;
            browseBar.Opacity = masked ? 0 : 1;
            privacyOverlay.Visibility = masked && body.Visibility == Visibility.Visible ? Visibility.Visible : Visibility.Collapsed;
        }

        static ControlTemplate GripTemplate()
        {
            var template = new ControlTemplate(typeof(Thumb));
            var path = new FrameworkElementFactory(typeof(System.Windows.Shapes.Path));
            path.SetValue(System.Windows.Shapes.Path.DataProperty, Geometry.Parse("M 12,2 L 2,12 M 12,6 L 6,12 M 12,10 L 10,12"));
            path.SetValue(System.Windows.Shapes.Shape.StrokeProperty, new SolidColorBrush(Color.FromArgb(150, 255, 255, 255)));
            path.SetValue(System.Windows.Shapes.Shape.StrokeThicknessProperty, 1.0);
            var grid = new FrameworkElementFactory(typeof(Grid));
            grid.SetValue(Panel.BackgroundProperty, Brushes.Transparent);
            grid.AppendChild(path);
            template.VisualTree = grid;
            return template;
        }

        /// <summary>Redraws the fence from its data (style, title, tabs, items).</summary>
        public void Refresh()
        {
            look = Theme.Read(Data.Style);
            Title = "DeskFence - " + Data.Name;

            frame.Background = Theme.Brush(look.Background);
            frame.BorderBrush = Theme.Brush(look.Border);
            frame.BorderThickness = new Thickness(look.BorderWidth);
            frame.CornerRadius = new CornerRadius(look.Radius);
            frame.Opacity = look.Opacity;
            frame.Effect = look.Shadow ? new DropShadowEffect { BlurRadius = 10, ShadowDepth = 2, Opacity = 0.35, RenderingBias = RenderingBias.Performance } : null;

            var label = Theme.Brush(look.Label);
            header.Background = look.HasTitleBar ? Theme.Brush(look.TitleBar) : Brushes.Transparent;
            title.Inlines.Clear();
            if (look.CompactHeader)
                title.Inlines.Add(new System.Windows.Documents.Run("\uE8B7  ") { FontFamily = new FontFamily("Segoe Fluent Icons, Segoe MDL2 Assets"), Foreground = new SolidColorBrush(Color.FromRgb(233, 168, 37)) });
            title.Inlines.Add(new System.Windows.Documents.Run(Data.Name + (Data.IsLocked ? "  🔒" : "") + (string.IsNullOrEmpty(Data.PortalPath) ? "" : "  🔗")));
            title.Foreground = label;
            title.FontSize = look.LabelSize;
            title.HorizontalAlignment = look.TitleLeft ? HorizontalAlignment.Left : HorizontalAlignment.Center;
            titleEdit.Foreground = label;
            titleEdit.CaretBrush = label;
            titleEdit.FontSize = look.LabelSize;
            optionsButton.Foreground = label;
            optionsButton.FontSize = look.LabelSize + 2;
            searchButton.Foreground = label;
            searchBox.Foreground = label;
            searchBox.CaretBrush = label;
            detailsSearch.Foreground = label;
            detailsSearch.CaretBrush = label;
            detailsSearch.FontSize = Math.Max(11, look.LabelSize - 1);
            browseName.Foreground = label;
            detailsTitle.Inlines.Clear();
            detailsTitle.Inlines.Add(new System.Windows.Documents.Run("\uE8B7") { FontFamily = IconFont, Foreground = new SolidColorBrush(Color.FromRgb(233, 168, 37)) });
            detailsTitle.Inlines.Add(new System.Windows.Documents.Run("  " + Data.Name));
            detailsTitle.Foreground = label;
            detailsTitle.FontSize = look.LabelSize;
            if (detailsHeader.Children[0] is Border pill) pill.Background = Theme.Brush(look.TabActive);

            // a different (or no) linked folder: back to its top level
            if (browsePath != null && (string.IsNullOrEmpty(Data.PortalPath) || !FileOps.IsInside(browsePath, Data.PortalPath)))
            {
                browsePath = null;
                browseItems = null;
            }
            // re-read the sub-folder being browsed (an item may have been deleted or moved)
            if (browsePath != null) browseItems = app.ListFolder(browsePath) ?? new List<JsonObject>();
            browseBar.Visibility = browsePath != null ? Visibility.Visible : Visibility.Collapsed;
            browseName.Text = browsePath != null ? Path.GetFileName(browsePath.TrimEnd('\\', '/')) : "";
            bool detailsTop = Details && !Data.HasTabs && titleEdit.Visibility != Visibility.Visible;
            detailsHeader.Visibility = detailsTop ? Visibility.Visible : Visibility.Collapsed;
            if (Details && search == null) search = "";
            if (!Details && search == "" && !searchBox.IsKeyboardFocused) search = null;
            searchBar.Visibility = !Details && search != null ? Visibility.Visible : Visibility.Collapsed;
            emptyText.Foreground = label;
            emptyText.Text = string.IsNullOrEmpty(Data.PortalPath) ? "Drop files here" : "This folder is empty";

            BuildTabs(label);
            if (detailsHeader.Visibility == Visibility.Visible) title.Visibility = Visibility.Collapsed;
            BuildItems();
            ApplyRolledUp();
            ApplyMask();
        }

        void BuildTabs(Brush label)
        {
            tabsPanel.Children.Clear();
            bool tabbed = Data.HasTabs;
            tabsPanel.Visibility = tabbed ? Visibility.Visible : Visibility.Collapsed;
            title.Visibility = tabbed || titleEdit.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible;
            if (!tabbed) return;

            string active = Data.ActiveTabId;
            var tabs = Data.Tabs.OfType<JsonObject>().ToList();
            var grid = new UniformGrid { Rows = 1, Columns = tabs.Count, Margin = new Thickness(4, 3, 0, 3) };
            foreach (var tab in tabs)
            {
                string id = Theme.Str(tab["id"]);
                bool isActive = id == active;
                var text = new TextBlock
                {
                    Text = Theme.Str(tab["name"]) ?? "Tab",
                    Foreground = label,
                    FontSize = look.LabelSize,
                    FontWeight = isActive ? FontWeights.SemiBold : FontWeights.Normal,
                    Opacity = isActive ? 1 : 0.6,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    HorizontalAlignment = HorizontalAlignment.Center,
                };
                var chip = new Border
                {
                    Child = text,
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 2, 6, 2),
                    Margin = new Thickness(1, 0, 1, 0),
                    Background = isActive ? Theme.Brush(look.TabActive) : Brushes.Transparent,
                    Cursor = Cursors.Hand,
                    ToolTip = "Click to open • double-click to rename",
                };
                chip.MouseLeftButtonDown += (_, e) =>
                {
                    if (e.ClickCount == 2) { RenameTab(id); e.Handled = true; return; }
                    if (id != Data.ActiveTabId)
                    {
                        Data.SwitchTab(id);
                        app.SaveSoon();
                        Refresh();
                    }
                    e.Handled = true; // a tab click is not a drag of the fence
                };
                grid.Children.Add(chip);
            }
            tabsPanel.Children.Add(grid); // stretches across the header (the ⋯ column stays free)
        }

        void BuildItems()
        {
            itemsPanel.Children.Clear();
            detailsPanel.Children.Clear();
            bool readOnly = browsePath != null;
            var source = readOnly ? browseItems : Data.Items.OfType<JsonObject>().ToList();
            string query = (search ?? "").Trim();
            var items = source.Where(i => query.Length == 0 || (Theme.Str(i["name"]) ?? "").IndexOf(query, StringComparison.CurrentCultureIgnoreCase) >= 0).ToList();

            if (Details)
            {
                itemsPanel.Visibility = Visibility.Collapsed;
                detailsPanel.Visibility = Visibility.Visible;
                var columns = ItemRow.ColumnsFor(Data.Width);
                if (items.Count > 0) detailsPanel.Children.Add(DetailsColumnHeader(columns));
                foreach (var item in SortForDetails(items))
                {
                    var row = new ItemRow(app, this, item, look, columns, readOnly) { IsSelected = Theme.Str(item["id"]) == selectedItemId };
                    detailsPanel.Children.Add(row);
                }
            }
            else
            {
                itemsPanel.Visibility = Visibility.Visible;
                detailsPanel.Visibility = Visibility.Collapsed;
                double cell = Math.Max(54, look.IconPx + 22);
                if (look.Columns > 0)
                    cell = Math.Max(40, Math.Floor((Data.Width - 8 - look.BorderWidth * 2 - 18) / look.Columns)); // fixed number of columns
                foreach (var item in items)
                {
                    var tile = new ItemTile(app, this, item, look, cell, readOnly) { IsSelected = Theme.Str(item["id"]) == selectedItemId };
                    itemsPanel.Children.Add(tile);
                }
            }
            emptyText.Text = query.Length > 0 ? "Nothing matches" : readOnly || !string.IsNullOrEmpty(Data.PortalPath) ? "This folder is empty" : "Drop files here";
            emptyText.Visibility = items.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        }

        UIElement DetailsColumnHeader(string[] columns)
        {
            var grid = new Grid { Margin = new Thickness(6, 0, 6, 2) };
            var brush = Theme.Brush(look.Label);
            for (int i = 0; i < columns.Length; i++)
            {
                string column = columns[i];
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = ItemRow.WidthOf(column) });
                string label = column switch { "name" => "Name", "modified" => "Date modified", "type" => "Type", _ => "Size" };
                if (detailsSort == column) label += detailsAscending ? "  ▴" : "  ▾";
                var text = new TextBlock
                {
                    Text = label,
                    Foreground = brush,
                    Opacity = 0.75,
                    FontSize = Math.Max(11, look.ItemLabelSize + 2),
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    TextAlignment = column == "size" ? TextAlignment.Right : TextAlignment.Left,
                    Padding = new Thickness(column == "name" ? 0 : 8, 3, 0, 3),
                };
                var cell = new Border
                {
                    Child = text,
                    Background = Brushes.Transparent,
                    Cursor = Cursors.Hand,
                    ToolTip = "Sort",
                    BorderBrush = new SolidColorBrush(Color.FromArgb(40, 255, 255, 255)),
                    BorderThickness = new Thickness(i == 0 ? 0 : 1, 0, 0, 1),
                };
                cell.MouseLeftButtonUp += (_, e) =>
                {
                    detailsAscending = detailsSort == column ? !detailsAscending : true;
                    detailsSort = column;
                    BuildItems();
                    e.Handled = true;
                };
                Grid.SetColumn(cell, i);
                grid.Children.Add(cell);
            }
            return grid;
        }

        // Folders first (like Explorer), then by the clicked column
        IEnumerable<JsonObject> SortForDetails(List<JsonObject> items)
        {
            var withInfo = items.Select(i => (Item: i, Info: ItemRow.FileInfoOf(Theme.Str(i["path"]) ?? ""), Name: Theme.Str(i["name"]) ?? "")).ToList();
            IOrderedEnumerable<(JsonObject Item, FileSystemInfo Info, string Name)> ordered =
                withInfo.OrderBy(x => x.Info is DirectoryInfo || Theme.Str(x.Item["type"]) == "folder" ? 0 : 1);
            Func<(JsonObject Item, FileSystemInfo Info, string Name), object> key = detailsSort switch
            {
                "modified" => x => x.Info?.LastWriteTimeUtc ?? DateTime.MinValue,
                "type" => x => ItemRow.TypeLabel(x.Name, x.Info is DirectoryInfo),
                "size" => x => x.Info is FileInfo f ? f.Length : 0L,
                _ => x => x.Name.ToLowerInvariant(),
            };
            ordered = detailsAscending ? ordered.ThenBy(key) : ordered.ThenByDescending(key);
            return ordered.ThenBy(x => x.Name, StringComparer.CurrentCultureIgnoreCase).Select(x => x.Item);
        }

        public void Select(string itemId)
        {
            selectedItemId = itemId;
            foreach (var tile in itemsPanel.Children.OfType<ItemBase>()) tile.IsSelected = tile.ItemId == itemId;
            foreach (var row in detailsPanel.Children.OfType<ItemBase>()) row.IsSelected = row.ItemId == itemId;
        }

        // ================= roll-up / hover =================
        bool IsRolledUp => Data.AutoRollup ? !hovered : Data.Collapsed;

        void ApplyRolledUp()
        {
            bool rolled = IsRolledUp && titleEdit.Visibility != Visibility.Visible;
            body.Visibility = rolled ? Visibility.Collapsed : Visibility.Visible;
            resizeGrip.Visibility = rolled || Data.IsLocked ? Visibility.Collapsed : Visibility.Visible;
            if (rolled)
            {
                header.Measure(new Size(Width, double.PositiveInfinity));
                Height = header.DesiredSize.Height + frame.Margin.Top + frame.Margin.Bottom + look.BorderWidth * 2;
            }
            else
            {
                Height = Data.Height + Pad * 2;
            }
        }

        void SetHovered(bool on)
        {
            hovered = on;
            optionsButton.Opacity = on ? 0.85 : 0;
            searchButton.Opacity = on && !Details ? 0.7 : 0;
            resizeGrip.Opacity = on ? 1 : 0;
            if (on && IsPrivate)
            {
                revealTimer.Stop();
                revealTimer.Start(); // a quick pass across the fence reveals nothing
            }
            else if (!on)
            {
                revealTimer.Stop();
                revealed = false;
                ApplyMask();
            }
            if (!Data.AutoRollup) return;
            if (on)
            {
                rollupTimer.Stop();
                ApplyRolledUp();
            }
            else
            {
                rollupTimer.Start(); // a small slip outside does not roll it up at once
            }
        }

        // ================= rename =================
        void StartRename()
        {
            if (Data.IsLocked) return;
            titleEdit.Text = Data.Name;
            titleEdit.Visibility = Visibility.Visible;
            title.Visibility = Visibility.Collapsed;
            detailsHeader.Visibility = Visibility.Collapsed; // Details view: the name box takes the title bar while typing
            AllowFocus(true); // typing needs the keyboard
            titleEdit.Focus();
            Keyboard.Focus(titleEdit);
            titleEdit.SelectAll();
        }

        /// <summary>Opens the title for typing (used right after a fence is drawn).</summary>
        public void BeginRenameSoon() => Dispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(StartRename));

        void EndRename(bool keep)
        {
            if (titleEdit.Visibility != Visibility.Visible) return;
            titleEdit.Visibility = Visibility.Collapsed;
            if (keep && !string.IsNullOrWhiteSpace(titleEdit.Text) && titleEdit.Text.Trim() != Data.Name)
            {
                Data.Name = titleEdit.Text.Trim();
                app.SaveSoon();
            }
            AllowFocus(false);
            SendToBottom();
            Refresh();
        }

        void RenameTab(string tabId)
        {
            if (Data.IsLocked) return;
            var tab = Data.Tabs?.OfType<JsonObject>().FirstOrDefault(t => Theme.Str(t["id"]) == tabId);
            string name = Prompt.Show(this, "Rename tab", Theme.Str(tab?["name"]) ?? "");
            if (name == null) return;
            Data.RenameTab(tabId, name);
            app.SaveSoon();
            Refresh();
        }

        // ================= menu =================
        void ShowOptionsMenu(UIElement anchor)
        {
            bool locked = Data.IsLocked;
            bool portal = !string.IsNullOrEmpty(Data.PortalPath);
            double px = look.IconPx;
            string sortBy = Theme.Str(Data.Raw["sortBy"]) ?? "";
            var entries = new List<MenuEntry>
            {
                MenuEntry.Sub(Glyphs.View, "View", new List<MenuEntry>
                {
                    MenuEntry.Toggle("Large icons", !Details && px >= 44, () => SetIconSize(48)),
                    MenuEntry.Toggle("Medium icons", !Details && px >= 30 && px < 44, () => SetIconSize(34)),
                    MenuEntry.Toggle("Small icons", !Details && px < 30, () => SetIconSize(24)),
                    MenuEntry.Separator(),
                    MenuEntry.Toggle("Details (list with date, type, size)", Details, () => SetView("details")),
                }),
                MenuEntry.Sub(Glyphs.Sort, "Sort by", new List<MenuEntry>
                {
                    MenuEntry.Toggle("Name", sortBy == "name", () => app.SortFence(this, "name"), !locked),
                    MenuEntry.Toggle("Date modified", sortBy == "modified", () => app.SortFence(this, "modified"), !locked),
                    MenuEntry.Toggle("Type", sortBy == "type", () => app.SortFence(this, "type"), !locked),
                    MenuEntry.Toggle("Size", sortBy == "size", () => app.SortFence(this, "size"), !locked),
                }),
                MenuEntry.Item(Glyphs.Refresh, "Refresh", () => app.RefreshFence(this)),
                MenuEntry.Item(Glyphs.Search, "Search", () => { if (Details) OpenSearch(detailsSearch); else OpenSearch(searchBox); }),
                MenuEntry.Separator(),
                MenuEntry.Item(Glyphs.Customize, "Customize…", () => app.OpenCustomize(this)),
                MenuEntry.Toggle("Privacy (hide contents until hovered)", Data.Raw["privacy"] is JsonValue pv && pv.TryGetValue(out bool pb) && pb, () =>
                {
                    bool on = !(Data.Raw["privacy"] is JsonValue v && v.TryGetValue(out bool b) && b);
                    Data.Raw["privacy"] = on;
                    Data.Touch();
                    app.SaveSoon();
                    Refresh();
                }),
                MenuEntry.Item(Glyphs.Rules, (Data.Raw["rules"] as JsonArray)?.Count > 0 ? $"Rules ({((JsonArray)Data.Raw["rules"]).Count})…" : "Rules…", () => app.OpenRules(this)),
                MenuEntry.Separator(),
                MenuEntry.Item(Glyphs.Rename, "Rename", StartRename, !locked && !Data.HasTabs),
            };
            if (!Data.AutoRollup)
                entries.Add(MenuEntry.Item(Data.Collapsed ? Glyphs.Down : Glyphs.Up, Data.Collapsed ? "Expand" : "Roll up to title",
                    () => { Data.Collapsed = !Data.Collapsed; app.SaveSoon(); ApplyRolledUp(); }));
            entries.Add(MenuEntry.Toggle("Auto roll-up (opens on hover)", Data.AutoRollup,
                () => { Data.AutoRollup = !Data.AutoRollup; Data.Collapsed = false; app.SaveSoon(); ApplyRolledUp(); }));
            entries.Add(MenuEntry.Item(locked ? Glyphs.Unlock : Glyphs.Lock, locked ? "Unlock" : "Lock", () => { Data.IsLocked = !locked; app.SaveSoon(); Refresh(); }));
            entries.Add(MenuEntry.Separator());
            if (!portal)
            {
                entries.Add(MenuEntry.Item(Glyphs.Add, "New tab", () => { Data.AddTab(); app.SaveSoon(); Refresh(); }, !locked));
                if (Data.HasTabs)
                {
                    string active = Data.ActiveTabId;
                    entries.Add(MenuEntry.Item(Glyphs.Rename, "Rename this tab", () => RenameTab(active), !locked));
                    entries.Add(MenuEntry.Item(Glyphs.Close, "Close this tab", () => { Data.RemoveTab(active); app.SaveSoon(); Refresh(); }, !locked));
                }
            }
            string folder = portal ? Data.PortalPath : Data.StoragePath;
            if (!string.IsNullOrEmpty(folder) && Directory.Exists(folder))
                entries.Add(MenuEntry.Item(Glyphs.Folder, "Open folder in File Explorer", () => app.Open(folder)));
            entries.Add(portal
                ? MenuEntry.Item(Glyphs.Unlink, "Stop showing the folder", () => app.UnlinkFolder(this), !locked)
                : MenuEntry.Item(Glyphs.Link, "Show a folder in this fence…", () => app.LinkFolder(this), !locked && !Data.HasTabs));
            entries.Add(MenuEntry.Separator());
            entries.Add(MenuEntry.Item(Glyphs.Delete, "Delete fence", () => app.DeleteFence(this), !locked));
            FluentMenu.ShowAtCursor(entries);
        }

        void SetView(string view)
        {
            Data.Raw["view"] = view;
            Data.Touch();
            app.SaveSoon();
            Refresh();
        }

        void SetIconSize(int px)
        {
            Data.Raw["view"] = "icons";
            Data.Style["iconPx"] = px;
            Data.Touch();
            app.SaveSoon();
            Refresh();
        }

        // ================= drag & drop in =================
        void OnDragOver(object sender, DragEventArgs e)
        {
            if (Data.IsLocked || !e.Data.GetDataPresent(DataFormats.FileDrop))
            {
                e.Effects = DragDropEffects.None;
            }
            else
            {
                e.Effects = (e.KeyStates & DragDropKeyStates.ControlKey) != 0 ? DragDropEffects.Copy : DragDropEffects.Move;
                dropHint.Visibility = Visibility.Visible;
                ApplyMask();
                if (Data.AutoRollup && !hovered) SetHovered(true); // drop down so the file can go in
            }
            e.Handled = true;
        }

        void OnDrop(object sender, DragEventArgs e)
        {
            dropHint.Visibility = Visibility.Collapsed;
            ApplyMask();
            if (Data.IsLocked)
            {
                app.Notice("This fence is locked. Unlock it to add items.");
                return;
            }
            if (e.Data.GetData(DataFormats.FileDrop) is string[] paths && paths.Length > 0)
            {
                bool copy = (e.KeyStates & DragDropKeyStates.ControlKey) != 0;
                // finish the drop for Windows first; move the files right after
                Dispatcher.BeginInvoke(new Action(() => app.DropInto(this, paths, copy)));
            }
            e.Handled = true;
        }

        protected override void OnClosed(EventArgs e)
        {
            rollupTimer.Stop();
            revealTimer.Stop();
            base.OnClosed(e);
        }
    }

    /// <summary>A tiny text prompt (rename a tab).</summary>
    internal static class Prompt
    {
        public static string Show(Window owner, string caption, string value)
        {
            var box = new TextBox { Text = value, Margin = new Thickness(12, 12, 12, 6), MinWidth = 240 };
            var ok = new Button { Content = "OK", IsDefault = true, Width = 80, Margin = new Thickness(4) };
            var cancel = new Button { Content = "Cancel", IsCancel = true, Width = 80, Margin = new Thickness(4) };
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(8, 0, 8, 8) };
            buttons.Children.Add(ok);
            buttons.Children.Add(cancel);
            var panel = new StackPanel();
            panel.Children.Add(box);
            panel.Children.Add(buttons);
            var window = new Window
            {
                Title = caption,
                Content = panel,
                SizeToContent = SizeToContent.WidthAndHeight,
                ResizeMode = ResizeMode.NoResize,
                WindowStartupLocation = WindowStartupLocation.CenterScreen,
                Topmost = true,
                ShowInTaskbar = false,
            };
            string result = null;
            ok.Click += (_, __) => { result = box.Text; window.DialogResult = true; };
            window.Loaded += (_, __) => { box.Focus(); box.SelectAll(); };
            window.ShowDialog();
            return result;
        }
    }
}
