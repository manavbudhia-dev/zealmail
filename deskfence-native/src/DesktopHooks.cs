using System;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Threading;

namespace DeskFence
{
    /// <summary>
    /// Desktop gestures, seen through low-level mouse and keyboard hooks:
    ///   double-click on empty Desktop space  -> Quick-hide
    ///   right-button drag on empty Desktop   -> draw a new fence
    ///   Win + Space                          -> Peek (taken from Windows' language switcher)
    ///   Esc while peeking / drawing          -> end it
    /// The hook callbacks only queue the event and return at once: anything slow in a low-level hook
    /// delays every mouse move and key press on the PC. A second thread looks at the queue and does
    /// the checks (which window is under the cursor, is it an icon or empty space).
    /// </summary>
    internal sealed class DesktopHooks
    {
        // ---- switches set by the app (read inside the hooks, so plain volatile flags) ----
        public volatile bool QuickHideEnabled = true;
        public volatile bool DrawEnabled = true;
        public volatile bool PeekKeyEnabled = true;
        public volatile bool PeekActive;
        public volatile bool DrawModeActive;
        public volatile bool FencesVisible = true;

        // ---- events, raised on the UI thread ----
        public event Action<Native.POINT> QuickHideRequested;
        public event Action<Native.POINT> DrawStarted;
        public event Action<Native.POINT> DrawEnded;
        public event Action DrawCancelled;
        public event Action PeekToggled;
        public event Action EscapePressed;
        /// <summary>A drag that started in a File Explorer window is under way / has ended.</summary>
        public event Action ExplorerDragStarted;
        public event Action ExplorerDragEnded;
        public volatile bool DropFolderEnabled = true;

        readonly Dispatcher ui;
        readonly BlockingCollection<(int Msg, Native.POINT Pt, uint Time)> events = new BlockingCollection<(int, Native.POINT, uint)>(4096);
        HookProc mouseProc, keyProc; // kept in fields: the GC must never collect a live hook callback
        IntPtr mouseHook, keyHook;
        volatile bool rightDown;
        volatile bool leftDown;
        bool swallowingSpace;

        public DesktopHooks(Dispatcher ui) => this.ui = ui;

        public void Start()
        {
            var hookThread = new Thread(HookLoop) { IsBackground = true, Name = "Hooks" };
            hookThread.Start();
            var worker = new Thread(GestureLoop) { IsBackground = true, Name = "Gestures" };
            worker.SetApartmentState(ApartmentState.MTA); // UI Automation calls are made from here
            worker.Start();
        }

        // ================= hook thread =================
        delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)] struct MSLLHOOKSTRUCT { public Native.POINT pt; public uint mouseData, flags, time; public IntPtr extra; }
        [StructLayout(LayoutKind.Sequential)] struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public IntPtr extra; }
        [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }

        [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr hMod, uint threadId);
        [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);

        void HookLoop()
        {
            mouseProc = MouseHook;
            keyProc = KeyHook;
            IntPtr module = GetModuleHandle(null);
            mouseHook = SetWindowsHookEx(14, mouseProc, module, 0); // WH_MOUSE_LL
            keyHook = SetWindowsHookEx(13, keyProc, module, 0); // WH_KEYBOARD_LL
            if (mouseHook == IntPtr.Zero || keyHook == IntPtr.Zero) Log.Error("Could not install the Desktop gesture hooks (error " + Marshal.GetLastWin32Error() + ")");
            while (GetMessage(out _, IntPtr.Zero, 0, 0) > 0) { } // low-level hooks need a message loop
        }

        IntPtr MouseHook(int code, IntPtr wParam, IntPtr lParam)
        {
            if (code >= 0)
            {
                int msg = wParam.ToInt32();
                if (msg == 0x0201 || msg == 0x0202 || msg == 0x0204 || msg == 0x0205 || (msg == 0x0200 && (rightDown || (leftDown && DropFolderEnabled))))
                {
                    var data = Marshal.PtrToStructure<MSLLHOOKSTRUCT>(lParam);
                    if ((data.flags & 1) == 0) // LLMHF_INJECTED: ignore synthetic input
                    {
                        if (msg == 0x0204) rightDown = true;
                        else if (msg == 0x0205) rightDown = false;
                        else if (msg == 0x0201) leftDown = true;
                        else if (msg == 0x0202) leftDown = false;
                        events.TryAdd((msg, data.pt, data.time)); // never blocks: a full queue drops the event
                    }
                }
            }
            return CallNextHookEx(mouseHook, code, wParam, lParam);
        }

        IntPtr KeyHook(int code, IntPtr wParam, IntPtr lParam)
        {
            if (code >= 0)
            {
                var k = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
                int msg = wParam.ToInt32();
                bool down = msg == 0x100 || msg == 0x104;
                bool up = msg == 0x101 || msg == 0x105;
                bool injected = (k.flags & 0x10) != 0;
                if (!injected && k.vkCode == 0x20 && PeekKeyEnabled) // Space
                {
                    bool win = (Native.GetAsyncKeyState(0x5B) & 0x8000) != 0 || (Native.GetAsyncKeyState(0x5C) & 0x8000) != 0;
                    if (down && win)
                    {
                        if (!swallowingSpace)
                        {
                            swallowingSpace = true; // key repeat while held counts once
                            // a harmless unassigned key while Win is held, so letting go of Win does not open Start
                            Native.keybd_event(0xE8, 0, 0, UIntPtr.Zero);
                            Native.keybd_event(0xE8, 0, 2, UIntPtr.Zero);
                            ui.BeginInvoke(() => PeekToggled?.Invoke());
                        }
                        return (IntPtr)1;
                    }
                    if (up && swallowingSpace)
                    {
                        swallowingSpace = false;
                        return (IntPtr)1;
                    }
                }
                if (!injected && k.vkCode == 0x1B && down && (PeekActive || DrawModeActive)) // Esc
                {
                    ui.BeginInvoke(() => EscapePressed?.Invoke());
                    return (IntPtr)1;
                }
            }
            return CallNextHookEx(keyHook, code, wParam, lParam);
        }

        // ================= gesture thread =================
        void GestureLoop()
        {
            uint dblTime = Native.GetDoubleClickTime();
            Native.POINT lDown = default, lastClickPt = default, p0 = default;
            bool lOverDesktop = false;
            uint lastClickTime = 0;
            bool haveLastClick = false;
            bool rCandidate = false, rMoved = false, rArmed = false;
            bool lFromExplorer = false, lDragging = false;

            foreach (var e in events.GetConsumingEnumerable())
            {
                try
                {
                    switch (e.Msg)
                    {
                        case 0x0201: // left down
                            lDown = e.Pt;
                            lOverDesktop = Native.IsDesktopAt(e.Pt);
                            lDragging = false;
                            // Shift = the user's way to drop onto the Desktop normally
                            lFromExplorer = DropFolderEnabled && FencesVisible && !lOverDesktop && (Native.GetAsyncKeyState(0x10) & 0x8000) == 0 && Native.IsExplorerAt(e.Pt);
                            break;

                        case 0x0202: // left up: a click on the Desktop? two in a row = double-click
                            if (lDragging)
                            {
                                lDragging = false;
                                ui.BeginInvoke(() => ExplorerDragEnded?.Invoke());
                            }
                            lFromExplorer = false;
                            if (lOverDesktop && Near(e.Pt, lDown, 4))
                            {
                                if (haveLastClick && e.Time - lastClickTime <= dblTime && Near(e.Pt, lastClickPt, 6))
                                {
                                    haveLastClick = false;
                                    // only now ask Explorer whether that was empty space (an icon opens instead)
                                    if (QuickHideEnabled && IsEmptyDesktop(e.Pt))
                                    {
                                        var pt = e.Pt;
                                        ui.BeginInvoke(() => QuickHideRequested?.Invoke(pt));
                                    }
                                }
                                else
                                {
                                    haveLastClick = true;
                                    lastClickTime = e.Time;
                                    lastClickPt = e.Pt;
                                }
                            }
                            else
                            {
                                haveLastClick = false;
                            }
                            lOverDesktop = false;
                            break;

                        case 0x0204: // right down
                            rMoved = false;
                            rArmed = false;
                            rCandidate = DrawEnabled && FencesVisible && !PeekActive && Native.IsDesktopAt(e.Pt);
                            p0 = e.Pt;
                            break;

                        case 0x0200: // move (queued while a button is down)
                            if (lFromExplorer && !lDragging && !Near(e.Pt, lDown, 8))
                            {
                                lDragging = true; // something is being dragged out of an Explorer window
                                ui.BeginInvoke(() => ExplorerDragStarted?.Invoke());
                            }
                            if (rCandidate && !rMoved && !Near(e.Pt, p0, 12))
                            {
                                rMoved = true;
                                rCandidate = false;
                                // right-dragging an ICON keeps Windows' own copy/move menu
                                rArmed = IsEmptyDesktop(p0);
                                if (rArmed)
                                {
                                    var start = p0;
                                    ui.BeginInvoke(() => DrawStarted?.Invoke(start));
                                }
                            }
                            break;

                        case 0x0205: // right up
                            if (rArmed)
                            {
                                var end = e.Pt;
                                ui.BeginInvoke(() => DrawEnded?.Invoke(end));
                                CloseShellMenu(); // Explorer opens its Desktop menu on release: close it
                            }
                            else if (rMoved)
                            {
                                ui.BeginInvoke(() => DrawCancelled?.Invoke());
                            }
                            rCandidate = rMoved = rArmed = false;
                            break;
                    }
                }
                catch (Exception error)
                {
                    Log.Error("Gesture", error);
                }
            }
        }

        static bool Near(Native.POINT a, Native.POINT b, int tolerance) =>
            Math.Abs(a.X - b.X) <= tolerance && Math.Abs(a.Y - b.Y) <= tolerance;

        /// <summary>True on empty Desktop space; false on an icon or its label (asked via UI Automation).</summary>
        static bool IsEmptyDesktop(Native.POINT p)
        {
            try
            {
                var element = AutomationElement.FromPoint(new System.Windows.Point(p.X, p.Y));
                if (element == null) return false;
                var type = element.Current.ControlType;
                return type == ControlType.List || type == ControlType.Pane || type == ControlType.Window;
            }
            catch
            {
                return false;
            }
        }

        static void CloseShellMenu()
        {
            for (int i = 0; i < 25; i++)
            {
                IntPtr menu = Native.FindWindow("#32768", null);
                if (menu != IntPtr.Zero && Native.IsWindowVisible(menu))
                {
                    Native.keybd_event(0x1B, 0, 0, UIntPtr.Zero);
                    Native.keybd_event(0x1B, 0, 2, UIntPtr.Zero);
                    return;
                }
                Thread.Sleep(20);
            }
        }
    }
}
