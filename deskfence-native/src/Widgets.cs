using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Threading;

namespace DeskFence
{
    /// <summary>
    /// A window that lives on the Desktop like a fence: owned by the Desktop window, never activated by
    /// a click, kept at the bottom of the z-order (except during Peek), dragged by its background.
    /// Its position is saved like a fence's: DIP relative to a monitor's work area + that monitor.
    /// </summary>
    internal abstract class DesktopWidget : Window
    {
        protected readonly DeskFenceApp App;
        protected readonly JsonObject State; // this widget's part of widgets.json
        protected IntPtr Hwnd;
        bool allowActivate;

        protected DesktopWidget(DeskFenceApp app, JsonObject state)
        {
            App = app;
            State = state;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ShowInTaskbar = false;
            ShowActivated = false;
            ResizeMode = ResizeMode.NoResize;
            UseLayoutRounding = true;
            TextOptions.SetTextFormattingMode(this, TextFormattingMode.Ideal);
            MouseLeftButtonDown += (_, e) =>
            {
                if (e.Handled || Locked || e.ClickCount > 1) return;
                try { DragMove(); } catch (InvalidOperationException) { /* released already */ }
                SavePosition();
            };
            MouseRightButtonUp += (_, e) =>
            {
                if (e.Handled) return;
                FluentMenu.ShowAtCursor(MenuEntries());
                e.Handled = true;
            };
            PreviewMouseDown += (_, __) => FluentMenu.CloseOpen();
        }

        public bool Locked => State["locked"] is JsonValue v && v.TryGetValue(out bool b) && b;
        protected abstract List<MenuEntry> MenuEntries();

        protected bool Flag(string key, bool fallback) => State[key] is JsonValue v && v.TryGetValue(out bool b) ? b : fallback;

        protected void SetFlag(string key, bool value)
        {
            State[key] = value;
            App.SaveWidgetsSoon();
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            Hwnd = new WindowInteropHelper(this).Handle;
            Native.SetExStyle(Hwnd, (Native.GetExStyle(Hwnd) | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE) & ~Native.WS_EX_APPWINDOW);
            IntPtr host = Native.DesktopHost();
            if (host != IntPtr.Zero) Native.SetWindowLongPtr(Hwnd, Native.GWLP_HWNDPARENT, host);
            HwndSource.FromHwnd(Hwnd).AddHook(WndProc);
            Place();
            SendToBottom();
        }

        IntPtr WndProc(IntPtr h, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            if (msg == Native.WM_MOUSEACTIVATE && !allowActivate)
            {
                handled = true;
                return new IntPtr(Native.MA_NOACTIVATE);
            }
            if (msg == Native.WM_WINDOWPOSCHANGING && !App.Peeking)
            {
                var pos = System.Runtime.InteropServices.Marshal.PtrToStructure<Native.WINDOWPOS>(lParam);
                if ((pos.flags & Native.SWP_NOZORDER) == 0 && pos.hwndInsertAfter != Native.HWND_BOTTOM)
                {
                    pos.hwndInsertAfter = Native.HWND_BOTTOM;
                    System.Runtime.InteropServices.Marshal.StructureToPtr(pos, lParam, false);
                }
            }
            return IntPtr.Zero;
        }

        public void SendToBottom()
        {
            if (Hwnd != IntPtr.Zero) Native.SetWindowPos(Hwnd, Native.HWND_BOTTOM, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
        }

        public void SetTopmost(bool on)
        {
            if (Hwnd == IntPtr.Zero) return;
            Native.SetWindowPos(Hwnd, on ? Native.HWND_TOPMOST : Native.HWND_NOTOPMOST, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
            if (!on) SendToBottom();
        }

        /// <summary>Puts the widget where it was saved (or where `DefaultSpot` says, the first time).</summary>
        public void Place()
        {
            if (Hwnd == IntPtr.Zero) return;
            double x = FenceData.Num(State["x"], double.NaN), y = FenceData.Num(State["y"], double.NaN);
            string device = Theme.Str(State["device"]);
            if (double.IsNaN(x) || double.IsNaN(y)) (x, y) = DefaultSpot(Screens.ByDevice(device));
            var (px, py, _) = Screens.ToScreen(x, y, Math.Max(120, ActualWidth), device);
            Native.SetWindowPos(Hwnd, IntPtr.Zero, px, py, 0, 0, Native.SWP_NOSIZE | Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
        }

        /// <summary>First position, in DIP relative to the monitor's work area.</summary>
        protected abstract (double X, double Y) DefaultSpot(Native.Monitor monitor);

        protected void SavePosition()
        {
            if (Hwnd == IntPtr.Zero || !Native.GetWindowRect(Hwnd, out var rect)) return;
            var (x, y, device) = Screens.FromScreen(rect);
            State["x"] = Math.Round(x);
            State["y"] = Math.Round(y);
            State["device"] = device;
            App.SaveWidgetsSoon();
        }

        /// <summary>Typing needs the keyboard, which a Desktop widget normally never takes.</summary>
        protected void AllowFocus(bool on)
        {
            allowActivate = on;
            if (Hwnd == IntPtr.Zero) return;
            long ex = Native.GetExStyle(Hwnd);
            Native.SetExStyle(Hwnd, on ? ex & ~Native.WS_EX_NOACTIVATE : ex | Native.WS_EX_NOACTIVATE);
            if (on)
            {
                Activate();
                Native.SetForegroundWindow(Hwnd);
            }
            else
            {
                SendToBottom();
            }
        }

        protected static TextBlock Glyph(string glyph, double size) => new TextBlock
        {
            Text = glyph,
            FontFamily = new FontFamily("Segoe Fluent Icons, Segoe MDL2 Assets"),
            FontSize = size,
            VerticalAlignment = VerticalAlignment.Center,
        };
    }

    // =====================================================================================
    /// <summary>A big clock with the date under it, straight on the wallpaper (or on a panel).</summary>
    internal sealed class ClockWidget : DesktopWidget
    {
        readonly TextBlock time = new TextBlock();
        readonly TextBlock seconds = new TextBlock();
        readonly TextBlock date = new TextBlock();
        readonly Border panel = new Border();
        readonly DispatcherTimer timer = new DispatcherTimer();

        bool Use24h => Flag("use24h", CultureInfo.CurrentCulture.DateTimeFormat.ShortTimePattern.Contains("H"));
        bool ShowSeconds => Flag("seconds", false);
        bool ShowDate => Flag("showDate", true);
        bool ShowPanel => Flag("panel", false);
        string Size => Theme.Str(State["size"]) ?? "large";

        public ClockWidget(DeskFenceApp app, JsonObject state) : base(app, state)
        {
            Title = "DeskFence clock";
            SizeToContent = SizeToContent.WidthAndHeight;
            var family = new FontFamily("Segoe UI Variable Display, Segoe UI");
            time.FontFamily = family;
            time.FontWeight = FontWeights.Light;
            seconds.FontFamily = family;
            seconds.FontWeight = FontWeights.Light;
            seconds.Opacity = 0.7;
            seconds.VerticalAlignment = VerticalAlignment.Top;
            date.FontFamily = family;
            date.HorizontalAlignment = HorizontalAlignment.Center;
            date.Opacity = 0.9;

            var line = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Center };
            line.Children.Add(time);
            line.Children.Add(seconds);
            var stack = new StackPanel();
            stack.Children.Add(line);
            stack.Children.Add(date);
            panel.Child = stack;
            panel.Margin = new Thickness(12); // room for the shadow
            Content = panel;
            Background = new SolidColorBrush(Color.FromArgb(1, 0, 0, 0)); // all of it can be grabbed and dragged

            Apply();
            timer.Tick += (_, __) => Tick();
            Loaded += (_, __) => { Tick(); timer.Start(); };
            Closed += (_, __) => timer.Stop();
            ToolTip = null;
        }

        void Apply()
        {
            double big = Size == "small" ? 56 : Size == "medium" ? 84 : 120;
            time.FontSize = big;
            seconds.FontSize = big * 0.38;
            seconds.Margin = new Thickness(big * 0.06, big * 0.18, 0, 0);
            seconds.Visibility = ShowSeconds ? Visibility.Visible : Visibility.Collapsed;
            date.FontSize = Math.Max(13, big * 0.2);
            date.Margin = new Thickness(0, -big * 0.08, 0, 0);
            date.Visibility = ShowDate ? Visibility.Visible : Visibility.Collapsed;
            var white = Brushes.White;
            time.Foreground = seconds.Foreground = date.Foreground = white;
            // a soft shadow keeps the white text readable on any wallpaper
            panel.Effect = new DropShadowEffect { BlurRadius = 14, ShadowDepth = 1, Opacity = 0.55, RenderingBias = RenderingBias.Performance };
            if (ShowPanel)
            {
                var look = Theme.Read(Theme.DefaultStyle());
                panel.Background = Theme.Brush(look.Background);
                panel.BorderBrush = Theme.Brush(look.Border);
                panel.BorderThickness = new Thickness(1);
                panel.CornerRadius = new CornerRadius(10);
                panel.Padding = new Thickness(24, 6, 24, 14);
            }
            else
            {
                panel.Background = null;
                panel.BorderThickness = new Thickness(0);
                panel.Padding = new Thickness(0);
            }
            // tick on the second while seconds show, else once a minute is plenty (no wasted work)
            timer.Interval = TimeSpan.FromMilliseconds(ShowSeconds ? 1000 : 1000);
            Tick();
        }

        void Tick()
        {
            var now = DateTime.Now;
            time.Text = Use24h ? now.ToString("HH:mm", CultureInfo.CurrentCulture) : now.ToString("h:mm", CultureInfo.CurrentCulture);
            seconds.Text = ShowSeconds ? now.ToString("ss", CultureInfo.CurrentCulture) : "";
            if (!Use24h && !ShowSeconds) seconds.Text = "";
            date.Text = now.ToString("dddd, d MMMM", CultureInfo.CurrentCulture) + (Use24h ? "" : "  ·  " + now.ToString("tt", CultureInfo.CurrentCulture));
            // next tick right after the next second (or minute) starts, so the clock never lags
            int msToNext = ShowSeconds ? 1000 - now.Millisecond : (60 - now.Second) * 1000 - now.Millisecond;
            timer.Interval = TimeSpan.FromMilliseconds(Math.Max(50, msToNext + 20));
        }

        protected override (double X, double Y) DefaultSpot(Native.Monitor monitor)
        {
            double workW = (monitor.Work.Right - monitor.Work.Left) / monitor.Scale;
            return (Math.Max(0, workW / 2 - 200), 40); // top centre
        }

        protected override List<MenuEntry> MenuEntries()
        {
            void Change(string key, bool value) { SetFlag(key, value); Apply(); }
            return new List<MenuEntry>
            {
                MenuEntry.Toggle("24-hour time", Use24h, () => Change("use24h", !Use24h)),
                MenuEntry.Toggle("Show seconds", ShowSeconds, () => Change("seconds", !ShowSeconds)),
                MenuEntry.Toggle("Show the date", ShowDate, () => Change("showDate", !ShowDate)),
                MenuEntry.Toggle("On a panel (like a fence)", ShowPanel, () => Change("panel", !ShowPanel)),
                MenuEntry.Sub(Glyphs.View, "Size", new List<MenuEntry>
                {
                    MenuEntry.Toggle("Large", Size == "large", () => { State["size"] = "large"; App.SaveWidgetsSoon(); Apply(); }),
                    MenuEntry.Toggle("Medium", Size == "medium", () => { State["size"] = "medium"; App.SaveWidgetsSoon(); Apply(); }),
                    MenuEntry.Toggle("Small", Size == "small", () => { State["size"] = "small"; App.SaveWidgetsSoon(); Apply(); }),
                }),
                MenuEntry.Separator(),
                MenuEntry.Toggle("Lock position", Locked, () => SetFlag("locked", !Locked)),
                MenuEntry.Item(Glyphs.Close, "Remove clock", () => App.SetWidgetEnabled("clock", false)),
            };
        }
    }

    // =====================================================================================
    /// <summary>A to-do list on the Desktop: add with Enter, tick to complete, double-click to edit.</summary>
    internal sealed class TodoWidget : DesktopWidget
    {
        readonly Border frame = new Border();
        readonly StackPanel list = new StackPanel();
        readonly TextBlock count = new TextBlock();
        readonly TextBox addBox = new TextBox();
        readonly TextBlock addHint = new TextBlock();
        readonly Border privacyOverlay = new Border();
        readonly ScrollViewer scroll = new ScrollViewer();
        readonly DispatcherTimer revealTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
        bool revealed;
        Theme.Look look;

        JsonArray Items
        {
            get
            {
                if (State["items"] is not JsonArray items)
                {
                    items = new JsonArray();
                    State["items"] = items;
                }
                return items;
            }
        }

        bool ShowCompleted => Flag("showCompleted", true);

        public TodoWidget(DeskFenceApp app, JsonObject state) : base(app, state)
        {
            Title = "DeskFence to-do";
            Width = Math.Max(220, FenceData.Num(state["width"], 300)) + 12;
            Height = Math.Max(160, FenceData.Num(state["height"], 340)) + 12;
            look = Theme.Read(Theme.DefaultStyle());
            Build();
            Render();
            MouseEnter += (_, __) => { if (App.PrivacyAll) revealTimer.Start(); };
            MouseLeave += (_, __) => { revealTimer.Stop(); revealed = false; ApplyMask(); };
            revealTimer.Tick += (_, __) => { revealTimer.Stop(); revealed = true; ApplyMask(); };
        }

        void Build()
        {
            var label = Theme.Brush(look.Label);
            var root = new Grid();
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            // header: "To do", how many are left, the options button
            var header = new Grid { Margin = new Thickness(12, 8, 6, 6), Cursor = Cursors.SizeAll, Background = Brushes.Transparent };
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var titleLine = new StackPanel { Orientation = Orientation.Horizontal };
            var check = Glyph("", look.LabelSize); // checkbox glyph
            check.Foreground = label;
            check.Margin = new Thickness(0, 0, 8, 0);
            titleLine.Children.Add(check);
            titleLine.Children.Add(new TextBlock { Text = "To do", Foreground = label, FontSize = look.LabelSize + 1, FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center });
            count.Foreground = label;
            count.Opacity = 0.6;
            count.Margin = new Thickness(8, 0, 0, 0);
            count.VerticalAlignment = VerticalAlignment.Center;
            count.FontSize = look.LabelSize - 2;
            titleLine.Children.Add(count);
            header.Children.Add(titleLine);
            var more = new Button
            {
                Content = Glyph("", 14),
                Foreground = label,
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                Padding = new Thickness(6, 2, 6, 2),
                Cursor = Cursors.Hand,
                Focusable = false,
                ToolTip = "Options",
                Template = FluentWindow.PlainButton(Color.FromArgb(40, 255, 255, 255)),
            };
            more.Click += (_, __) => FluentMenu.ShowAtCursor(MenuEntries());
            Grid.SetColumn(more, 1);
            header.Children.Add(more);
            root.Children.Add(header);

            scroll.Content = list;
            scroll.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
            scroll.Padding = new Thickness(6, 0, 6, 0);
            Grid.SetRow(scroll, 1);
            root.Children.Add(scroll);

            // add a task: type and press Enter
            addBox.Background = new SolidColorBrush(Color.FromArgb(50, 0, 0, 0));
            addBox.Foreground = label;
            addBox.CaretBrush = label;
            addBox.BorderThickness = new Thickness(0, 0, 0, 1);
            addBox.BorderBrush = new SolidColorBrush(Color.FromArgb(60, 255, 255, 255));
            addBox.Padding = new Thickness(8, 6, 8, 6);
            addBox.FontSize = Math.Max(12, look.ItemLabelSize + 3);
            addBox.PreviewMouseDown += (_, __) => { if (!addBox.IsKeyboardFocused) { AllowFocus(true); addBox.Focus(); Keyboard.Focus(addBox); } };
            addBox.KeyDown += (_, e) =>
            {
                if (e.Key == Key.Enter) { Add(addBox.Text); addBox.Text = ""; e.Handled = true; }
                if (e.Key == Key.Escape) { addBox.Text = ""; Keyboard.ClearFocus(); AllowFocus(false); }
            };
            addBox.LostKeyboardFocus += (_, __) => { AllowFocus(false); UpdateHint(); };
            addBox.GotKeyboardFocus += (_, __) => UpdateHint();
            addBox.TextChanged += (_, __) => UpdateHint();
            addHint.IsHitTestVisible = false;
            addHint.Foreground = label;
            addHint.Opacity = 0.55;
            addHint.VerticalAlignment = VerticalAlignment.Center;
            addHint.Margin = new Thickness(10, 0, 0, 0);
            addHint.FontSize = addBox.FontSize;
            addHint.Inlines.Add(new System.Windows.Documents.Run("") { FontFamily = new FontFamily("Segoe Fluent Icons, Segoe MDL2 Assets") });
            addHint.Inlines.Add(new System.Windows.Documents.Run("   Add a task"));
            var addGrid = new Grid { Margin = new Thickness(8, 6, 8, 10) };
            addGrid.Children.Add(addBox);
            addGrid.Children.Add(addHint);
            Grid.SetRow(addGrid, 2);
            root.Children.Add(addGrid);

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
            root.Children.Add(privacyOverlay);

            // resize corner
            var grip = new System.Windows.Controls.Primitives.Thumb { Width = 14, Height = 14, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom, Cursor = Cursors.SizeNWSE, Opacity = 0.6 };
            grip.Template = new ControlTemplate(typeof(System.Windows.Controls.Primitives.Thumb)) { VisualTree = new FrameworkElementFactory(typeof(Border)) };
            grip.Template.VisualTree.SetValue(Border.BackgroundProperty, Brushes.Transparent);
            grip.DragDelta += (_, e) =>
            {
                if (Locked) return;
                Width = Math.Max(232, Width + e.HorizontalChange);
                Height = Math.Max(172, Height + e.VerticalChange);
            };
            grip.DragCompleted += (_, __) =>
            {
                State["width"] = Math.Round(Width - 12);
                State["height"] = Math.Round(Height - 12);
                App.SaveWidgetsSoon();
            };
            Grid.SetRow(grip, 2);
            root.Children.Add(grip);

            frame.Child = root;
            frame.Margin = new Thickness(6);
            frame.Background = Theme.Brush(look.Background);
            frame.BorderBrush = Theme.Brush(look.Border);
            frame.BorderThickness = new Thickness(look.BorderWidth);
            frame.CornerRadius = new CornerRadius(Math.Max(6, look.Radius));
            frame.Effect = new DropShadowEffect { BlurRadius = 10, ShadowDepth = 2, Opacity = 0.35, RenderingBias = RenderingBias.Performance };
            Content = frame;
        }

        void UpdateHint() => addHint.Visibility = string.IsNullOrEmpty(addBox.Text) && !addBox.IsKeyboardFocused ? Visibility.Visible : Visibility.Collapsed;

        public void Render()
        {
            list.Children.Clear();
            var label = Theme.Brush(look.Label);
            var items = Items.OfType<JsonObject>().ToList();
            int left = items.Count(i => !Done(i));
            count.Text = items.Count == 0 ? "" : left == 0 ? "all done" : left + " left";
            // open tasks first (in the order added), then completed ones
            foreach (var item in items.Where(i => !Done(i)).Concat(ShowCompleted ? items.Where(Done) : Enumerable.Empty<JsonObject>()))
                list.Children.Add(Row(item, label));
            if (items.Count == 0)
                list.Children.Add(new TextBlock { Text = "Nothing to do. Add a task below.", Foreground = label, Opacity = 0.5, Margin = new Thickness(8, 12, 8, 12), FontSize = 12, TextWrapping = TextWrapping.Wrap });
            UpdateHint();
            ApplyMask();
        }

        static bool Done(JsonObject item) => item["done"] is JsonValue v && v.TryGetValue(out bool b) && b;

        UIElement Row(JsonObject item, Brush label)
        {
            bool done = Done(item);
            double size = Math.Max(12, look.ItemLabelSize + 3);
            var grid = new Grid { Margin = new Thickness(0, 1, 0, 1), Background = Brushes.Transparent };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(30) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(26) });

            // round checkbox: a ring, or a filled circle with a tick when done
            var circle = new Border
            {
                Width = size + 4,
                Height = size + 4,
                CornerRadius = new CornerRadius((size + 4) / 2),
                BorderThickness = new Thickness(1.5),
                BorderBrush = label,
                Background = done ? new SolidColorBrush(Color.FromRgb(96, 165, 250)) : Brushes.Transparent,
                Cursor = Cursors.Hand,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(4, 3, 0, 0),
                ToolTip = done ? "Mark as not done" : "Mark as done",
            };
            if (done)
            {
                var tick = Glyph("", size - 4);
                tick.Foreground = Brushes.White;
                tick.HorizontalAlignment = HorizontalAlignment.Center;
                circle.Child = tick;
                circle.BorderBrush = circle.Background;
            }
            circle.MouseLeftButtonDown += (_, e) =>
            {
                item["done"] = !done;
                if (!done) item["doneAt"] = DateTimeOffset.Now.ToUnixTimeMilliseconds();
                Save();
                e.Handled = true;
            };
            grid.Children.Add(circle);

            var text = new TextBlock
            {
                Text = Theme.Str(item["text"]) ?? "",
                Foreground = label,
                FontSize = size,
                TextWrapping = TextWrapping.Wrap,
                Opacity = done ? 0.5 : 1,
                TextDecorations = done ? TextDecorations.Strikethrough : null,
                Margin = new Thickness(4, 3, 4, 3),
                ToolTip = "Double-click to edit",
            };
            text.MouseLeftButtonDown += (_, e) =>
            {
                if (e.ClickCount == 2) { Edit(item, grid, text); e.Handled = true; }
            };
            Grid.SetColumn(text, 1);
            grid.Children.Add(text);

            var delete = new Button
            {
                Content = Glyph("", 10),
                Foreground = label,
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                Cursor = Cursors.Hand,
                Focusable = false,
                Opacity = 0,
                ToolTip = "Delete",
                VerticalAlignment = VerticalAlignment.Top,
                Padding = new Thickness(4),
                Template = FluentWindow.PlainButton(Color.FromArgb(40, 255, 255, 255)),
            };
            delete.Click += (_, __) => { Items.Remove(item); Save(); };
            Grid.SetColumn(delete, 2);
            grid.Children.Add(delete);
            grid.MouseEnter += (_, __) => { delete.Opacity = 0.8; grid.Background = new SolidColorBrush(Color.FromArgb(22, 255, 255, 255)); };
            grid.MouseLeave += (_, __) => { delete.Opacity = 0; grid.Background = Brushes.Transparent; };
            return new Border { Child = grid, CornerRadius = new CornerRadius(4) };
        }

        void Edit(JsonObject item, Grid row, TextBlock text)
        {
            var box = new TextBox
            {
                Text = text.Text,
                FontSize = text.FontSize,
                Foreground = text.Foreground,
                CaretBrush = text.Foreground,
                Background = new SolidColorBrush(Color.FromArgb(60, 0, 0, 0)),
                BorderThickness = new Thickness(0, 0, 0, 1),
                TextWrapping = TextWrapping.Wrap,
                Margin = text.Margin,
            };
            Grid.SetColumn(box, 1);
            row.Children.Remove(text);
            row.Children.Add(box);
            bool finished = false;
            void Finish(bool keep)
            {
                if (finished) return;
                finished = true;
                if (keep && !string.IsNullOrWhiteSpace(box.Text)) item["text"] = box.Text.Trim();
                AllowFocus(false);
                Save();
            }
            box.KeyDown += (_, e) =>
            {
                if (e.Key == Key.Enter) { Finish(true); e.Handled = true; }
                if (e.Key == Key.Escape) Finish(false);
            };
            box.LostKeyboardFocus += (_, __) => Finish(true);
            AllowFocus(true);
            box.Focus();
            Keyboard.Focus(box);
            box.SelectAll();
        }

        void Add(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return;
            Items.Add(new JsonObject
            {
                ["id"] = FenceData.NewId("todo"),
                ["text"] = text.Trim(),
                ["done"] = false,
                ["created"] = DateTimeOffset.Now.ToUnixTimeMilliseconds(),
            });
            Save();
        }

        void Save()
        {
            App.SaveWidgetsSoon();
            Render();
        }

        public void ApplyMask()
        {
            bool masked = App.PrivacyAll && !revealed && !addBox.IsKeyboardFocused;
            scroll.Effect = masked ? new BlurEffect { Radius = 12, RenderingBias = RenderingBias.Performance } : null;
            scroll.IsHitTestVisible = !masked;
            privacyOverlay.Visibility = masked ? Visibility.Visible : Visibility.Collapsed;
        }

        protected override (double X, double Y) DefaultSpot(Native.Monitor monitor)
        {
            double workW = (monitor.Work.Right - monitor.Work.Left) / monitor.Scale;
            return (Math.Max(0, workW - 340), 200); // right side, under the top fences
        }

        protected override List<MenuEntry> MenuEntries()
        {
            int completed = Items.OfType<JsonObject>().Count(Done);
            return new List<MenuEntry>
            {
                MenuEntry.Item(Glyphs.Delete, completed > 0 ? $"Clear completed ({completed})" : "Clear completed", () =>
                {
                    foreach (var item in Items.OfType<JsonObject>().Where(Done).ToList()) Items.Remove(item);
                    Save();
                }, completed > 0),
                MenuEntry.Toggle("Show completed tasks", ShowCompleted, () => { SetFlag("showCompleted", !ShowCompleted); Render(); }),
                MenuEntry.Separator(),
                MenuEntry.Toggle("Lock position", Locked, () => SetFlag("locked", !Locked)),
                MenuEntry.Item(Glyphs.Close, "Remove to-do widget", () => App.SetWidgetEnabled("todo", false)),
            };
        }
    }
}
