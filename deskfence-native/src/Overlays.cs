using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Shapes;

namespace DeskFence
{
    /// <summary>Common setup for full-monitor helper windows positioned in real screen pixels.</summary>
    internal abstract class ScreenWindow : Window
    {
        protected IntPtr Hwnd;
        readonly bool clickThrough;

        protected ScreenWindow(bool clickThrough)
        {
            this.clickThrough = clickThrough;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            ShowInTaskbar = false;
            ShowActivated = false;
            ResizeMode = ResizeMode.NoResize;
            Topmost = true;
            Left = -32000;
            Top = -32000;
            Width = 1;
            Height = 1;
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            Hwnd = new WindowInteropHelper(this).Handle;
            long ex = Native.GetExStyle(Hwnd) | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE;
            if (clickThrough) ex |= 0x00000020 | 0x00080000; // WS_EX_TRANSPARENT | WS_EX_LAYERED: invisible to the mouse
            Native.SetExStyle(Hwnd, ex);
        }

        public void Cover(Native.RECT r)
        {
            if (Hwnd == IntPtr.Zero) Show();
            Native.SetWindowPos(Hwnd, Native.HWND_TOPMOST, r.Left, r.Top, Math.Max(1, r.Right - r.Left), Math.Max(1, r.Bottom - r.Top), Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW);
        }
    }

    /// <summary>Peek: dims one monitor behind the fences; a click on it ends Peek.</summary>
    internal sealed class DimWindow : ScreenWindow
    {
        public event Action Clicked;

        public DimWindow() : base(false)
        {
            Background = new SolidColorBrush(Color.FromArgb(115, 0, 0, 0));
            var hint = new Border
            {
                Background = new SolidColorBrush(Color.FromArgb(160, 0, 0, 0)),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(10, 4, 10, 4),
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 16, 0, 0),
                IsHitTestVisible = false,
                Child = new TextBlock { Text = "Peek · Esc, Win+Space or a click here to go back", Foreground = Brushes.White, FontSize = 12 },
            };
            Content = new Grid { Children = { hint } };
            MouseDown += (_, __) => Clicked?.Invoke();
        }
    }

    /// <summary>The dashed outline that follows the mouse while a fence is drawn on the Desktop.</summary>
    internal sealed class RubberBand : ScreenWindow
    {
        public RubberBand() : base(true)
        {
            Background = Brushes.Transparent;
            Content = new Border
            {
                BorderThickness = new Thickness(2),
                BorderBrush = new SolidColorBrush(Color.FromArgb(230, 96, 165, 250)),
                Background = new SolidColorBrush(Color.FromArgb(40, 59, 130, 246)),
                CornerRadius = new CornerRadius(6),
            };
        }

        public void Span(Native.POINT a, Native.POINT b)
        {
            Cover(new Native.RECT
            {
                Left = Math.Min(a.X, b.X),
                Top = Math.Min(a.Y, b.Y),
                Right = Math.Max(a.X, b.X),
                Bottom = Math.Max(a.Y, b.Y),
            });
        }
    }

    /// <summary>
    /// "New fence" from the tray: the monitor catches the mouse until a rectangle is drawn (a plain
    /// click makes a default-size fence there). Esc, a right-click or 20 s without drawing cancel it.
    /// </summary>
    internal sealed class DrawModeWindow : ScreenWindow
    {
        public event Action<Native.RECT> Drawn;
        public event Action Cancelled;
        readonly Canvas canvas = new Canvas();
        readonly Rectangle outline = new Rectangle
        {
            Stroke = new SolidColorBrush(Color.FromArgb(230, 96, 165, 250)),
            StrokeThickness = 2,
            StrokeDashArray = new DoubleCollection { 4, 3 },
            Fill = new SolidColorBrush(Color.FromArgb(40, 59, 130, 246)),
            RadiusX = 6,
            RadiusY = 6,
            Visibility = Visibility.Collapsed,
        };
        Point? start;
        readonly System.Windows.Threading.DispatcherTimer idle = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(20) };

        public DrawModeWindow() : base(false)
        {
            Background = new SolidColorBrush(Color.FromArgb(18, 0, 0, 0)); // almost invisible, but catches the mouse
            Cursor = Cursors.Cross;
            canvas.Children.Add(outline);
            var hint = new Border
            {
                Background = new SolidColorBrush(Color.FromArgb(200, 17, 24, 39)),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(12, 6, 12, 6),
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 24, 0, 0),
                IsHitTestVisible = false,
                Child = new TextBlock { Text = "Drag a rectangle to draw the new fence  •  Esc or right-click to cancel", Foreground = Brushes.White, FontSize = 13 },
            };
            Content = new Grid { Children = { canvas, hint } };

            MouseLeftButtonDown += (_, e) =>
            {
                start = e.GetPosition(canvas);
                CaptureMouse();
                Update(start.Value);
                outline.Visibility = Visibility.Visible;
                idle.Stop();
            };
            MouseMove += (_, e) => { if (start.HasValue) Update(e.GetPosition(canvas)); };
            MouseLeftButtonUp += (_, e) =>
            {
                if (!start.HasValue) return;
                ReleaseMouseCapture();
                var a = PointToScreen(start.Value);
                var b = PointToScreen(e.GetPosition(canvas));
                start = null;
                Drawn?.Invoke(new Native.RECT
                {
                    Left = (int)Math.Min(a.X, b.X),
                    Top = (int)Math.Min(a.Y, b.Y),
                    Right = (int)Math.Max(a.X, b.X),
                    Bottom = (int)Math.Max(a.Y, b.Y),
                });
            };
            MouseRightButtonUp += (_, __) => Cancelled?.Invoke();
            KeyDown += (_, e) => { if (e.Key == Key.Escape) Cancelled?.Invoke(); };
            Deactivated += (_, __) => { if (!start.HasValue) Cancelled?.Invoke(); };
            idle.Tick += (_, __) => Cancelled?.Invoke();
            Loaded += (_, __) => idle.Start();
            Closed += (_, __) => idle.Stop();
        }

        void Update(Point now)
        {
            var s = start ?? now;
            Canvas.SetLeft(outline, Math.Min(s.X, now.X));
            Canvas.SetTop(outline, Math.Min(s.Y, now.Y));
            outline.Width = Math.Abs(now.X - s.X);
            outline.Height = Math.Abs(now.Y - s.Y);
        }

        /// <summary>Takes the keyboard so Esc works.</summary>
        public void TakeFocus()
        {
            long ex = Native.GetExStyle(Hwnd);
            Native.SetExStyle(Hwnd, ex & ~Native.WS_EX_NOACTIVATE);
            Activate();
            Native.SetForegroundWindow(Hwnd);
            Focus();
        }
    }

    /// <summary>Hide / show the real Desktop icons (the same as Desktop > View > Show desktop icons).</summary>
    internal static class DesktopIcons
    {
        public static bool AreHidden()
        {
            IntPtr view = Native.DesktopDefView();
            if (view == IntPtr.Zero) return false;
            IntPtr list = Native.FindWindowEx(view, IntPtr.Zero, "SysListView32", null);
            return list != IntPtr.Zero && !Native.IsWindowVisible(list);
        }

        /// <summary>Returns true when the icons are now in the wanted state.</summary>
        public static bool SetHidden(bool hidden)
        {
            if (AreHidden() == hidden) return true;
            IntPtr view = Native.DesktopDefView();
            if (view == IntPtr.Zero) return false;
            Native.SendMessage(view, 0x0111, new IntPtr(0x7402), IntPtr.Zero); // WM_COMMAND "toggle desktop icons"
            return AreHidden() == hidden;
        }
    }
}
