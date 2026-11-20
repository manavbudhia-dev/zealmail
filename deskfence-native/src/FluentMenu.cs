using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Shell;
using System.Windows.Threading;
using Microsoft.Win32;

namespace DeskFence
{
    /// <summary>One line of a menu: text, a Windows icon glyph, an optional shortcut and submenu.</summary>
    internal sealed class MenuEntry
    {
        public string Text;
        public string Glyph; // a Segoe Fluent Icons / MDL2 character
        public string Shortcut;
        public Action Run;
        public bool Enabled = true;
        public bool? Checked; // null = not a toggle
        public List<MenuEntry> Children;
        public bool IsSeparator;

        public static MenuEntry Separator() => new MenuEntry { IsSeparator = true };
        public static MenuEntry Item(string glyph, string text, Action run, bool enabled = true) =>
            new MenuEntry { Glyph = glyph, Text = text, Run = run, Enabled = enabled };
        public static MenuEntry Toggle(string text, bool on, Action run, bool enabled = true) =>
            new MenuEntry { Text = text, Checked = on, Run = run, Enabled = enabled };
        public static MenuEntry Sub(string glyph, string text, List<MenuEntry> children, bool enabled = true) =>
            new MenuEntry { Glyph = glyph, Text = text, Children = children, Enabled = enabled };
    }

    /// <summary>Icon characters from Windows' own icon font (Segoe Fluent Icons on Windows 11, MDL2 on 10).</summary>
    internal static class Glyphs
    {
        public const string View = "", Sort = "", Refresh = "", Rename = "", Up = "", Down = "",
            Auto = "", Lock = "", Unlock = "", Add = "", Close = "", Folder = "",
            Link = "", Unlink = "", Delete = "", Open = "", Copy = "", Desktop = "",
            Remove = "", Peek = "", Hide = "", Settings = "", Power = "", Check = "",
            Chevron = "", NewFence = "", Data = "", Search = "\uE721", Customize = "\uE790",
            Rules = "\uE945", Privacy = "\uE727", Organize = "\uE8FD", Clock = "\uE823", Cleanup = "\uE8F1", Layout = "\uF0E2", Backup = "\uE777", Save = "\uE74E";
    }

    /// <summary>
    /// A Windows 11 style context menu: see-through (acrylic) background, rounded corners, an icon per
    /// line, submenus with a chevron, following the system's dark / light mode. Used for every menu.
    /// </summary>
    internal sealed class FluentMenu : Window
    {
        static FluentMenu openRoot;
        readonly FluentMenu parentMenu;
        FluentMenu childMenu;
        readonly List<MenuEntry> entries;
        readonly bool dark = IsDarkMode();
        readonly DispatcherTimer submenuTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
        Border pendingSubmenuRow;
        Native.POINT anchor;
        IntPtr hwnd;
        bool closing;

        static readonly FontFamily IconFont = new FontFamily("Segoe Fluent Icons, Segoe MDL2 Assets");
        static readonly FontFamily TextFont = new FontFamily("Segoe UI Variable Text, Segoe UI");

        Brush TextBrush => dark ? Brushes.White : new SolidColorBrush(Color.FromRgb(26, 26, 26));
        Brush HoverBrush => new SolidColorBrush(dark ? Color.FromArgb(26, 255, 255, 255) : Color.FromArgb(15, 0, 0, 0));
        Brush LineBrush => new SolidColorBrush(dark ? Color.FromArgb(40, 255, 255, 255) : Color.FromArgb(28, 0, 0, 0));

        /// <summary>Closes the open menu, if any (a click on a fence: fences never take focus, so the menu would not notice).</summary>
        public static void CloseOpen() => openRoot?.CloseAll();

        /// <summary>Opens a menu at the mouse pointer (closing any other DeskFence menu).</summary>
        public static void ShowAtCursor(List<MenuEntry> entries)
        {
            Native.GetCursorPos(out var p);
            openRoot?.CloseAll();
            var menu = new FluentMenu(entries, null, p);
            openRoot = menu;
            menu.Show();
        }

        FluentMenu(List<MenuEntry> entries, FluentMenu parent, Native.POINT anchor)
        {
            this.entries = entries;
            parentMenu = parent;
            this.anchor = anchor;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            ShowInTaskbar = false;
            Topmost = true;
            SizeToContent = SizeToContent.WidthAndHeight;
            ShowActivated = parent == null; // the root takes the keyboard (Esc, arrows); submenus do not
            Background = Brushes.Transparent;
            FontFamily = TextFont;
            FontSize = 14;
            UseLayoutRounding = true;
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = -32000; // placed exactly once it has its size (no flash in the corner)
            Top = -32000;
            TextOptions.SetTextFormattingMode(this, TextFormattingMode.Display);
            // let the system backdrop show through the whole window
            WindowChrome.SetWindowChrome(this, new WindowChrome
            {
                GlassFrameThickness = new Thickness(-1),
                CaptionHeight = 0,
                ResizeBorderThickness = new Thickness(0),
                CornerRadius = new CornerRadius(0),
                UseAeroCaptionButtons = false,
            });
            Content = Build();
            submenuTimer.Tick += (_, __) =>
            {
                submenuTimer.Stop();
                if (pendingSubmenuRow?.Tag is MenuEntry e && pendingSubmenuRow.IsMouseOver) OpenSubmenu(pendingSubmenuRow, e);
            };
            KeyDown += (_, e) =>
            {
                if (e.Key == Key.Escape) CloseAll();
            };
            // clicking anywhere else (another window, the Desktop) closes the whole menu
            Deactivated += (_, __) =>
            {
                if (parentMenu == null) Dispatcher.BeginInvoke(new Action(CloseAll));
            };
        }

        // ================= look =================
        UIElement Build()
        {
            var stack = new StackPanel { Margin = new Thickness(4), MinWidth = 220 };
            bool anyIcon = entries.Any(e => e.Glyph != null || e.Checked.HasValue);
            foreach (var entry in entries)
            {
                if (entry.IsSeparator)
                {
                    stack.Children.Add(new Border { Height = 1, Background = LineBrush, Margin = new Thickness(-4, 4, -4, 4) });
                    continue;
                }
                stack.Children.Add(Row(entry, anyIcon));
            }
            // a tint over the backdrop: keeps text readable everywhere (and is the whole look on Windows 10)
            return new Border
            {
                Child = stack,
                CornerRadius = new CornerRadius(8),
                Background = new SolidColorBrush(BackdropWorks
                    ? (dark ? Color.FromArgb(150, 32, 32, 32) : Color.FromArgb(150, 249, 249, 249))
                    : (dark ? Color.FromRgb(44, 44, 44) : Color.FromRgb(249, 249, 249))),
                BorderBrush = new SolidColorBrush(dark ? Color.FromArgb(50, 255, 255, 255) : Color.FromArgb(30, 0, 0, 0)),
                BorderThickness = new Thickness(1),
            };
        }

        Border Row(MenuEntry entry, bool iconColumn)
        {
            var grid = new Grid { Height = 32 };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(iconColumn ? 36 : 12) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(28) });

            string glyph = entry.Checked == true ? Glyphs.Check : entry.Checked == false ? null : entry.Glyph;
            if (glyph != null)
            {
                var icon = new TextBlock { Text = glyph, FontFamily = IconFont, FontSize = 16, Foreground = TextBrush, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center };
                grid.Children.Add(icon);
            }
            var text = new TextBlock { Text = entry.Text, Foreground = TextBrush, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(2, 0, 16, 0) };
            Grid.SetColumn(text, 1);
            grid.Children.Add(text);
            if (!string.IsNullOrEmpty(entry.Shortcut))
            {
                var shortcut = new TextBlock { Text = entry.Shortcut, Foreground = TextBrush, Opacity = 0.6, FontSize = 12, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 4, 0) };
                Grid.SetColumn(shortcut, 2);
                grid.Children.Add(shortcut);
            }
            if (entry.Children != null)
            {
                var chevron = new TextBlock { Text = Glyphs.Chevron, FontFamily = IconFont, FontSize = 11, Foreground = TextBrush, Opacity = 0.8, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center };
                Grid.SetColumn(chevron, 3);
                grid.Children.Add(chevron);
            }

            var row = new Border { Child = grid, CornerRadius = new CornerRadius(4), Margin = new Thickness(0, 1, 0, 1), Background = Brushes.Transparent, Tag = entry };
            if (!entry.Enabled)
            {
                row.Opacity = 0.4;
                return row;
            }
            row.MouseEnter += (_, __) =>
            {
                row.Background = HoverBrush;
                if (childMenu != null && childMenu.Tag != entry) CloseChild();
                if (entry.Children != null && (childMenu == null || childMenu.Tag != entry))
                {
                    pendingSubmenuRow = row;
                    submenuTimer.Stop();
                    submenuTimer.Start();
                }
            };
            row.MouseLeave += (_, __) => row.Background = Brushes.Transparent;
            row.MouseLeftButtonUp += (_, e) =>
            {
                e.Handled = true;
                if (entry.Children != null)
                {
                    OpenSubmenu(row, entry);
                    return;
                }
                var run = entry.Run;
                CloseAll();
                if (run != null) Application.Current.Dispatcher.BeginInvoke(run); // after the menu is gone
            };
            return row;
        }

        // ================= submenus =================
        void OpenSubmenu(Border row, MenuEntry entry)
        {
            if (childMenu != null && childMenu.Tag == entry) return;
            CloseChild();
            var topRight = row.PointToScreen(new Point(row.ActualWidth, 0));
            childMenu = new FluentMenu(entry.Children, this, new Native.POINT { X = (int)topRight.X + 2, Y = (int)topRight.Y - 5 }) { Tag = entry };
            childMenu.Show();
        }

        void CloseChild()
        {
            if (childMenu == null) return;
            childMenu.CloseAll(true);
            childMenu = null;
        }

        void CloseAll() => CloseAll(false);

        void CloseAll(bool onlyThisBranch)
        {
            if (closing) return;
            closing = true;
            submenuTimer.Stop();
            childMenu?.CloseAll(true);
            childMenu = null;
            if (!onlyThisBranch && parentMenu != null) parentMenu.CloseAll();
            if (openRoot == this) openRoot = null;
            Close();
        }

        // ================= window plumbing =================
        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            hwnd = new WindowInteropHelper(this).Handle;
            var source = HwndSource.FromHwnd(hwnd);
            // transparent window surface: the acrylic backdrop (Windows 11) or nothing (Windows 10) shows outside the rounded panel
            source.CompositionTarget.BackgroundColor = Colors.Transparent;
            Native.SetExStyle(hwnd, Native.GetExStyle(hwnd) | Native.WS_EX_TOOLWINDOW | (parentMenu != null ? Native.WS_EX_NOACTIVATE : 0));

            int on = dark ? 1 : 0;
            DwmSetWindowAttribute(hwnd, 20, ref on, sizeof(int)); // DWMWA_USE_IMMERSIVE_DARK_MODE
            int round = 2;
            DwmSetWindowAttribute(hwnd, 33, ref round, sizeof(int)); // DWMWA_WINDOW_CORNER_PREFERENCE = round
            if (BackdropWorks)
            {
                int acrylic = 3;
                DwmSetWindowAttribute(hwnd, 38, ref acrylic, sizeof(int)); // DWMWA_SYSTEMBACKDROP_TYPE = transient (acrylic)
            }
        }

        protected override void OnContentRendered(EventArgs e)
        {
            base.OnContentRendered(e);
            PlaceOnScreen();
        }

        // Next to the pointer (or the parent row), flipped so it stays on the monitor
        void PlaceOnScreen()
        {
            if (hwnd == IntPtr.Zero || !Native.GetWindowRect(hwnd, out var r)) return;
            int w = r.Right - r.Left, h = r.Bottom - r.Top;
            var m = Native.MonitorAt(anchor);
            int x = anchor.X, y = anchor.Y;
            if (x + w > m.Work.Right)
            {
                // no room on the right: a submenu opens on the parent's left, a menu to the left of the pointer
                if (parentMenu != null && parentMenu.hwnd != IntPtr.Zero && Native.GetWindowRect(parentMenu.hwnd, out var pr)) x = pr.Left - w + 2;
                else x -= w;
            }
            if (y + h > m.Work.Bottom) y = Math.Max(m.Work.Top, m.Work.Bottom - h);
            x = Math.Max(m.Work.Left, x);
            Native.SetWindowPos(hwnd, Native.HWND_TOPMOST, x, y, 0, 0, Native.SWP_NOSIZE | (parentMenu != null ? Native.SWP_NOACTIVATE : 0));
            if (parentMenu == null)
            {
                Activate();
                Native.SetForegroundWindow(hwnd);
                Focus();
            }
        }

        protected override void OnClosed(EventArgs e)
        {
            submenuTimer.Stop();
            base.OnClosed(e);
        }

        // ================= system =================
        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        /// <summary>The acrylic menu backdrop exists from Windows 11 22H2 (build 22621).</summary>
        static bool BackdropWorks => Environment.OSVersion.Version.Build >= 22621;

        static bool IsDarkMode()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
                return !(key?.GetValue("AppsUseLightTheme") is int light && light == 1);
            }
            catch
            {
                return true;
            }
        }
    }
}
