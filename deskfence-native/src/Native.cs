using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace DeskFence
{
    /// <summary>Windows API declarations used across the app.</summary>
    internal static class Native
    {
        // ---- window styles / positions ----
        public const int GWL_EXSTYLE = -20;
        public const int GWLP_HWNDPARENT = -8;
        public const long WS_EX_TOOLWINDOW = 0x00000080;
        public const long WS_EX_APPWINDOW = 0x00040000;
        public const long WS_EX_NOACTIVATE = 0x08000000;
        public const long WS_EX_TOPMOST = 0x00000008;

        public static readonly IntPtr HWND_TOP = IntPtr.Zero;
        public static readonly IntPtr HWND_BOTTOM = new IntPtr(1);
        public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);

        public const uint SWP_NOSIZE = 0x0001;
        public const uint SWP_NOMOVE = 0x0002;
        public const uint SWP_NOZORDER = 0x0004;
        public const uint SWP_NOACTIVATE = 0x0010;
        public const uint SWP_SHOWWINDOW = 0x0040;
        public const uint SWP_NOOWNERZORDER = 0x0200;

        public const int WM_WINDOWPOSCHANGING = 0x0046;
        public const int WM_MOUSEACTIVATE = 0x0021;
        public const int WM_EXITSIZEMOVE = 0x0232;
        public const int WM_DISPLAYCHANGE = 0x007E;
        public const int WM_DPICHANGED = 0x02E0;
        public const int MA_NOACTIVATE = 3;

        [StructLayout(LayoutKind.Sequential)]
        public struct WINDOWPOS
        {
            public IntPtr hwnd;
            public IntPtr hwndInsertAfter;
            public int x, y, cx, cy;
            public uint flags;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X; public int Y; }

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left, Top, Right, Bottom; }

        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value);
        [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
        [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
        [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
        [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] public static extern uint GetDoubleClickTime();
        [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
        [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
        [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern uint RegisterWindowMessage(string name);

        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);

        public static string ClassOf(IntPtr h)
        {
            var sb = new StringBuilder(64);
            GetClassName(h, sb, 64);
            return sb.ToString();
        }

        public static long GetExStyle(IntPtr h) => GetWindowLongPtr(h, GWL_EXSTYLE).ToInt64();
        public static void SetExStyle(IntPtr h, long style) => SetWindowLongPtr(h, GWL_EXSTYLE, new IntPtr(style));

        /// <summary>Root window class under a screen point ("Progman"/"WorkerW" = the bare Desktop).</summary>
        public static string RootClassAt(POINT p)
        {
            IntPtr h = WindowFromPoint(p);
            if (h == IntPtr.Zero) return "";
            IntPtr root = GetAncestor(h, 2); // GA_ROOT
            return ClassOf(root == IntPtr.Zero ? h : root);
        }

        public static bool IsDesktopAt(POINT p)
        {
            string c = RootClassAt(p);
            return c == "Progman" || c == "WorkerW";
        }

        /// <summary>The top-level window that hosts the Desktop icons (Progman, or a WorkerW on some setups).</summary>
        public static IntPtr DesktopHost()
        {
            IntPtr host = IntPtr.Zero;
            IntPtr progman = FindWindow("Progman", null);
            if (progman != IntPtr.Zero && FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) return progman;
            EnumWindows((h, _) =>
            {
                if (FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
                {
                    host = h;
                    return false;
                }
                return true;
            }, IntPtr.Zero);
            return host != IntPtr.Zero ? host : progman;
        }

        /// <summary>The Desktop's icon view (SHELLDLL_DefView), used to hide/show the Desktop icons.</summary>
        public static IntPtr DesktopDefView()
        {
            IntPtr host = DesktopHost();
            return host == IntPtr.Zero ? IntPtr.Zero : FindWindowEx(host, IntPtr.Zero, "SHELLDLL_DefView", null);
        }

        // ---- monitors ----
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct MONITORINFOEX
        {
            public int cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
        }

        public delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, ref RECT rect, IntPtr data);
        [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc proc, IntPtr data);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFOEX info);
        [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(POINT p, uint flags);
        [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr hMonitor, int type, out uint dpiX, out uint dpiY);

        public sealed class Monitor
        {
            public IntPtr Handle;
            public string Device;
            public RECT Work;
            public RECT Bounds;
            public bool Primary;
            public double Scale; // 1.0 = 96 dpi
        }

        public static List<Monitor> Monitors()
        {
            var list = new List<Monitor>();
            EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr h, IntPtr hdc, ref RECT r, IntPtr d) =>
            {
                list.Add(Describe(h));
                return true;
            }, IntPtr.Zero);
            return list;
        }

        public static Monitor MonitorAt(POINT p) => Describe(MonitorFromPoint(p, 2)); // MONITOR_DEFAULTTONEAREST

        static Monitor Describe(IntPtr h)
        {
            var info = new MONITORINFOEX { cbSize = Marshal.SizeOf<MONITORINFOEX>() };
            GetMonitorInfo(h, ref info);
            double scale = 1.0;
            try
            {
                if (GetDpiForMonitor(h, 0, out uint dx, out _) == 0 && dx > 0) scale = dx / 96.0;
            }
            catch
            {
                /* very old Windows: assume 96 dpi */
            }
            return new Monitor { Handle = h, Device = info.szDevice, Work = info.rcWork, Bounds = info.rcMonitor, Primary = (info.dwFlags & 1) != 0, Scale = scale };
        }

        // ---- shell: delete to Recycle Bin ----
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct SHFILEOPSTRUCT
        {
            public IntPtr hwnd;
            public uint wFunc;
            public string pFrom;
            public string pTo;
            public ushort fFlags;
            public bool fAnyOperationsAborted;
            public IntPtr hNameMappings;
            public string lpszProgressTitle;
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHFileOperation(ref SHFILEOPSTRUCT op);

        public static bool SendToRecycleBin(string path)
        {
            var op = new SHFILEOPSTRUCT
            {
                wFunc = 3, // FO_DELETE
                pFrom = path + "\0\0",
                fFlags = 0x0040 | 0x0010 | 0x0004, // FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT
            };
            return SHFileOperation(ref op) == 0 && !op.fAnyOperationsAborted;
        }
    }
}
