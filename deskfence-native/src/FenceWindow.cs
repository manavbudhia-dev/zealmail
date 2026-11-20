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
            rollupTimer.Tick += (_, __) =>
            {
                rollupTimer.Stop();
                if (!IsMouseOver) ApplyRolledUp();
            };
            DragEnter += OnDragOver;
            DragOver += OnDragOver;
            DragLeave += (_, __) => dropHint.Visibility = Visibility.Collapsed;
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
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            // header: centered title (or tabs) + the options button that shows on hover
            header.Background = Brushes.Transparent; // hit-testable, so the whole bar drags
            header.Cursor = Cursors.SizeAll;
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(28) });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
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
            Grid.SetColumnSpan(tabsPanel, 2);
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
            Grid.SetColumn(optionsButton, 2);
            header.Children.Add(optionsButton);

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
            emptyText.HorizontalAlignment = HorizontalAlignment.Center;
            emptyText.VerticalAlignment = VerticalAlignment.Center;
            emptyText.Opacity = 0.5;
            emptyText.Margin = new Thickness(0, 12, 0, 12);
            emptyText.FontSize = 11;
            bodyGrid.Children.Add(emptyText);
            body.Content = bodyGrid;
            body.MouseLeftButtonDown += (_, __) => Select(null);
            Grid.SetRow(body, 1);
            root.Children.Add(body);

            // a dashed outline while files are dragged over the fence
            dropHint.BorderThickness = new Thickness(2);
            dropHint.BorderBrush = new SolidColorBrush(Color.FromArgb(200, 96, 165, 250));
            dropHint.Background = new SolidColorBrush(Color.FromArgb(30, 96, 165, 250));
            dropHint.IsHitTestVisible = false;
            dropHint.Visibility = Visibility.Collapsed;
            dropHint.Margin = new Thickness(3);
            Grid.SetRowSpan(dropHint, 2);
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
            Grid.SetRow(resizeGrip, 1);
            root.Children.Add(resizeGrip);

            frame.Child = root;
            frame.Margin = new Thickness(Pad); // room for the shadow
            Content = frame;
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
            title.Text = Data.Name + (Data.IsLocked ? "  🔒" : "") + (string.IsNullOrEmpty(Data.PortalPath) ? "" : "  🔗");
            title.Foreground = label;
            title.FontSize = look.LabelSize;
            title.HorizontalAlignment = look.TitleLeft ? HorizontalAlignment.Left : HorizontalAlignment.Center;
            titleEdit.Foreground = label;
            titleEdit.CaretBrush = label;
            titleEdit.FontSize = look.LabelSize;
            optionsButton.Foreground = label;
            optionsButton.FontSize = look.LabelSize + 2;
            emptyText.Foreground = label;
            emptyText.Text = string.IsNullOrEmpty(Data.PortalPath) ? "Drop files here" : "This folder is empty";

            BuildTabs(label);
            BuildItems();
            ApplyRolledUp();
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
            double cell = Math.Max(54, look.IconPx + 22);
            var items = Data.Items.OfType<JsonObject>().ToList();
            foreach (var item in items)
            {
                var tile = new ItemTile(app, this, item, look, cell);
                tile.IsSelected = Theme.Str(item["id"]) == selectedItemId;
                itemsPanel.Children.Add(tile);
            }
            emptyText.Visibility = items.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        }

        public void Select(string itemId)
        {
            selectedItemId = itemId;
            foreach (var tile in itemsPanel.Children.OfType<ItemTile>()) tile.IsSelected = tile.ItemId == itemId;
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
            resizeGrip.Opacity = on ? 1 : 0;
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
                    MenuEntry.Toggle("Large icons", px >= 44, () => SetIconSize(48)),
                    MenuEntry.Toggle("Medium icons", px >= 30 && px < 44, () => SetIconSize(34)),
                    MenuEntry.Toggle("Small icons", px < 30, () => SetIconSize(24)),
                }),
                MenuEntry.Sub(Glyphs.Sort, "Sort by", new List<MenuEntry>
                {
                    MenuEntry.Toggle("Name", sortBy == "name", () => app.SortFence(this, "name"), !locked),
                    MenuEntry.Toggle("Date modified", sortBy == "modified", () => app.SortFence(this, "modified"), !locked),
                    MenuEntry.Toggle("Type", sortBy == "type", () => app.SortFence(this, "type"), !locked),
                    MenuEntry.Toggle("Size", sortBy == "size", () => app.SortFence(this, "size"), !locked),
                }),
                MenuEntry.Item(Glyphs.Refresh, "Refresh", () => app.RefreshFence(this)),
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

        void SetIconSize(int px)
        {
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
                if (Data.AutoRollup && !hovered) SetHovered(true); // drop down so the file can go in
            }
            e.Handled = true;
        }

        void OnDrop(object sender, DragEventArgs e)
        {
            dropHint.Visibility = Visibility.Collapsed;
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
