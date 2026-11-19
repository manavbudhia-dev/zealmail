// Watches (Windows only) for "a folder is being dragged from File Explorer onto the bare Desktop",
// so the overlay window can briefly stop being click-through and receive the drop.
//
// Why a helper process: the overlay is click-through on empty space, and a click-through window never
// receives drag-and-drop events. Electron cannot see the mouse button state while another app owns the
// drag, so a tiny PowerShell process polls it and reports changes on stdout:
//
//   S <down> <overDesktop> <armed> <shift>
//
//   down        1 while the primary mouse button is held
//   overDesktop 1 when the cursor is over the bare Desktop (Progman / WorkerW) - only checked while down
//   armed       1 when the press STARTED inside a File Explorer window. Dragging an icon around the
//               Desktop itself (re-arranging) never arms it, so that keeps working untouched.
//   shift       1 while Shift is held (the user's way to drop onto the Desktop normally)
//   rdown       1 while the secondary (right) mouse button is held
//   rdraw       1 while a "draw a fence" gesture is in progress: the right button was pressed on EMPTY
//               Desktop space (not on an icon) and the mouse has moved since
//
// Plus two one-off event lines for the draw gesture:
//   G           the right button was released after a draw: DeskFence creates the fence (the helper
//               closes the Desktop's right-click menu that Windows opens on release)
//   X           the right button was released without drawing (a normal right-click: menu untouched)
//
//   Q           a double-click on EMPTY Desktop space: Quick-hide (hide / show every fence)
//   P           Win + Space: Peek (fences above the open windows)
//
// Each of those only happens while its flag file exists (main creates it while the feature is on).
// Main can also ask for one thing through a command file:
//   SINK <hwnd> <hwnd>...   put these (DeskFence) windows just above the Desktop, below every app window
//
// Drawing only arms while the flag file passed to buildScript exists (main creates it while the fences
// are on screen), so a hidden DeskFence never swallows the Desktop's right-click menu.
//
// The logic is separated from Electron so it can be tested with a fake spawn.
const { spawn } = require('child_process');
const { encodeCommand } = require('./desktop-icons');

// PowerShell single-quoted string: a ' is written as ''
const psQuote = (text) => "'" + String(text || '').replace(/'/g, "''") + "'";

const buildScript = (parentPid, drawFlagPath, extra = {}) => `
$ErrorActionPreference = 'Stop'
$sig = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DeskFenceDrag {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint GetDoubleClickTime();
  [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);

  static string RootClassUnderCursor() {
    POINT p;
    if (!GetCursorPos(out p)) return "";
    IntPtr h = WindowFromPoint(p);
    if (h == IntPtr.Zero) return "";
    IntPtr root = GetAncestor(h, 2); // GA_ROOT
    if (root == IntPtr.Zero) root = h;
    StringBuilder sb = new StringBuilder(64);
    GetClassName(root, sb, 64);
    return sb.ToString();
  }
  public static int Down() {
    int vk = GetSystemMetrics(23) != 0 ? 0x02 : 0x01; // SM_SWAPBUTTON: the primary button may be the right one
    return (GetAsyncKeyState(vk) & 0x8000) != 0 ? 1 : 0;
  }
  public static int Shift() { return (GetAsyncKeyState(0x10) & 0x8000) != 0 ? 1 : 0; }
  public static int RDown() {
    int vk = GetSystemMetrics(23) != 0 ? 0x01 : 0x02; // the secondary button may be the left one
    return (GetAsyncKeyState(vk) & 0x8000) != 0 ? 1 : 0;
  }
  public static POINT Pos() { POINT p; GetCursorPos(out p); return p; }
  public static int WinSpace() {
    bool win = (GetAsyncKeyState(0x5B) & 0x8000) != 0 || (GetAsyncKeyState(0x5C) & 0x8000) != 0;
    return win && (GetAsyncKeyState(0x20) & 0x8000) != 0 ? 1 : 0;
  }
  static string ClassOf(IntPtr h) { StringBuilder sb = new StringBuilder(64); GetClassName(h, sb, 64); return sb.ToString(); }
  // Puts our windows just above the Desktop: directly below the LOWEST normal app window, so the
  // fences sit on the Desktop instead of floating over apps (after Peek, after Quick-hide shows them).
  public static void Sink(long[] handles, uint ownPid) {
    IntPtr lowest = IntPtr.Zero;
    for (IntPtr h = GetTopWindow(IntPtr.Zero); h != IntPtr.Zero; h = GetWindow(h, 2)) {
      if (!IsWindowVisible(h) || IsIconic(h)) continue;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == ownPid) continue;
      long ex = GetWindowLongPtr(h, -20).ToInt64();
      if ((ex & 0x8) != 0 || (ex & 0x80) != 0) continue; // topmost / tool windows live elsewhere
      string c = ClassOf(h);
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") continue;
      lowest = h;
    }
    if (lowest == IntPtr.Zero) return; // no app windows: nothing to go below
    foreach (long v in handles) SetWindowPos(new IntPtr(v), lowest, 0, 0, 0, 0, 0x0213); // NOSIZE|NOMOVE|NOACTIVATE|NOOWNERZORDER
  }
  // After a draw, Explorer opens its Desktop right-click menu on release: close it (Escape) once it shows.
  public static void CloseShellMenu() {
    for (int i = 0; i < 25; i++) {
      IntPtr m = FindWindow("#32768", null);
      if (m != IntPtr.Zero && IsWindowVisible(m)) {
        keybd_event(0x1B, 0, 0, UIntPtr.Zero);
        keybd_event(0x1B, 0, 2, UIntPtr.Zero);
        return;
      }
      System.Threading.Thread.Sleep(20);
    }
  }
  public static int OverDesktop() { string c = RootClassUnderCursor(); return (c == "Progman" || c == "WorkerW") ? 1 : 0; }
  public static int OverExplorer() { string c = RootClassUnderCursor(); return (c == "CabinetWClass" || c == "ExploreWClass") ? 1 : 0; }
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int pid);
}

// Win + Space for Peek. Windows itself uses Win + Space (keyboard language switcher), which would pop
// up and take the focus away, so a low-level keyboard hook takes the key combination for DeskFence.
// The callback only flips a counter: anything slow here would delay every key press on the PC.
public static class DeskFenceKeys {
  delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr hMod, uint threadId);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

  static HookProc proc = Hook; // kept in a static field: the GC must never collect the callback
  static IntPtr hook = IntPtr.Zero;
  static int presses = 0;
  static bool swallowing = false;
  public static volatile bool Enabled = false;
  public static bool Active { get { return hook != IntPtr.Zero; } }
  public static int TakePresses() { return System.Threading.Interlocked.Exchange(ref presses, 0); }

  static IntPtr Hook(int code, IntPtr wParam, IntPtr lParam) {
    if (code >= 0 && Enabled) {
      KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
      if (k.vkCode == 0x20 && (k.flags & 0x10) == 0) { // Space, typed by the user (not injected)
        int msg = wParam.ToInt32();
        bool down = msg == 0x100 || msg == 0x104;
        bool up = msg == 0x101 || msg == 0x105;
        bool win = (GetAsyncKeyState(0x5B) & 0x8000) != 0 || (GetAsyncKeyState(0x5C) & 0x8000) != 0;
        if (down && win) {
          if (!swallowing) {
            swallowing = true; // key repeat while held is swallowed but counts once
            System.Threading.Interlocked.Increment(ref presses);
            // a harmless unassigned key while Win is held, so letting go of Win does not open Start
            keybd_event(0xE8, 0, 0, UIntPtr.Zero);
            keybd_event(0xE8, 0, 2, UIntPtr.Zero);
          }
          return (IntPtr)1;
        }
        if (up && swallowing) {
          swallowing = false;
          return (IntPtr)1;
        }
      }
    }
    return CallNextHookEx(hook, code, wParam, lParam);
  }

  public static void Start() {
    System.Threading.Thread t = new System.Threading.Thread(() => {
      hook = SetWindowsHookEx(13, proc, GetModuleHandle(null), 0); // WH_KEYBOARD_LL
      if (hook == IntPtr.Zero) return;
      MSG m;
      while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { } // a low-level hook needs a message loop
    });
    t.IsBackground = true;
    t.Start();
  }
}
'@
Add-Type -TypeDefinition $sig
$uia = $null

# True only on EMPTY Desktop space: an icon (or its label) keeps its own right-drag / double-click.
# This asks Explorer (UI Automation), so it is only called once a gesture really happened, never on
# every click: asking on every click made the Desktop itself sluggish.
function Test-EmptyDesktop($pt) {
  if ($uia -eq $null) {
    try { Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase; $uia = $true } catch { $uia = $false }
    $script:uia = $uia
  }
  if (-not $uia) { return $false }
  try {
    $el = [System.Windows.Automation.AutomationElement]::FromPoint((New-Object System.Windows.Point($pt.X, $pt.Y)))
    if ($el -eq $null) { return $false }
    $type = $el.Current.ControlType
    return ($type -eq [System.Windows.Automation.ControlType]::List -or $type -eq [System.Windows.Automation.ControlType]::Pane -or $type -eq [System.Windows.Automation.ControlType]::Window)
  } catch { return $false }
}

$parent = ${Number(parentPid) || 0}
$drawFlag = ${psQuote(drawFlagPath)}
$qhFlag = ${psQuote(extra.quickHideFlagPath)}
$peekFlag = ${psQuote(extra.peekFlagPath)}
$cmdFile = ${psQuote(extra.commandPath)}
$dblMs = [DeskFenceDrag]::GetDoubleClickTime()
$clock = [Diagnostics.Stopwatch]::StartNew()
$lP0 = [DeskFenceDrag]::Pos()
$lastClickAt = -100000
$lastClickPos = $lP0
$prevWs = 0
$peekOn = $false
[DeskFenceKeys]::Start()
$rCandidate = $false
$lOver = $false
$armed = $false
$prevDown = 0
$prevR = 0
$rArmed = $false
$rMoved = $false
$p0 = [DeskFenceDrag]::Pos()
$last = ''
$tick = 0
while ($true) {
  $rd = [DeskFenceDrag]::RDown()
  if ($rd -eq 1 -and $prevR -eq 0) {
    $rArmed = $false
    $rMoved = $false
    $rCandidate = $false
    if ($drawFlag -ne '' -and (Test-Path -LiteralPath $drawFlag) -and [DeskFenceDrag]::OverDesktop() -eq 1) {
      $p0 = [DeskFenceDrag]::Pos()
      $rCandidate = $true
    }
  }
  if ($rd -eq 1 -and $rCandidate -and -not $rMoved) {
    $p = [DeskFenceDrag]::Pos()
    if ([Math]::Abs($p.X - $p0.X) -gt 12 -or [Math]::Abs($p.Y - $p0.Y) -gt 12) {
      $rMoved = $true
      $rCandidate = $false
      $rArmed = (Test-EmptyDesktop $p0) # an icon being right-dragged keeps its own copy/move menu
    }
  }
  if ($rd -eq 0 -and $prevR -eq 1 -and $rArmed) {
    if ($rMoved) {
      [Console]::Out.WriteLine('G')
      [Console]::Out.Flush()
      [DeskFenceDrag]::CloseShellMenu()
    } else {
      [Console]::Out.WriteLine('X')
      [Console]::Out.Flush()
    }
    $rArmed = $false
    $rMoved = $false
  }
  $prevR = $rd
  $rdraw = 0
  if ($rArmed -and $rMoved) { $rdraw = 1 }

  $d = [DeskFenceDrag]::Down()
  $o = 0
  $sh = 0
  if ($d -eq 1) {
    $o = [DeskFenceDrag]::OverDesktop()
    $sh = [DeskFenceDrag]::Shift()
    if ($prevDown -eq 0) { $armed = ([DeskFenceDrag]::OverExplorer() -eq 1) }
  } else {
    $armed = $false
  }
  # ---- Quick-hide: double-click on EMPTY Desktop space ----
  if ($d -eq 1 -and $prevDown -eq 0) {
    $lOver = ([DeskFenceDrag]::OverDesktop() -eq 1)
    $lP0 = [DeskFenceDrag]::Pos()
  }
  if ($d -eq 0 -and $prevDown -eq 1) {
    if ($lOver) {
      $p = [DeskFenceDrag]::Pos()
      if ([Math]::Abs($p.X - $lP0.X) -le 4 -and [Math]::Abs($p.Y - $lP0.Y) -le 4) {
        $now = $clock.ElapsedMilliseconds
        if ($now - $lastClickAt -le $dblMs -and [Math]::Abs($p.X - $lastClickPos.X) -le 6 -and [Math]::Abs($p.Y - $lastClickPos.Y) -le 6) {
          # a double-click on the Desktop: only now ask whether it was on empty space (not an icon)
          if ($qhFlag -ne '' -and (Test-Path -LiteralPath $qhFlag) -and (Test-EmptyDesktop $p)) {
            [Console]::Out.WriteLine('Q')
            [Console]::Out.Flush()
          }
          $lastClickAt = -100000
        } else {
          $lastClickAt = $now
          $lastClickPos = $p
        }
      } else {
        $lastClickAt = -100000 # a drag, not a click
      }
    }
    $lOver = $false
  }
  $prevDown = $d

  # ---- Peek: Win + Space ----
  if (($tick % 33) -eq 0) {
    # about once a second: is Peek wanted? (never read a file inside the keyboard hook)
    $peekOn = ($peekFlag -ne '' -and (Test-Path -LiteralPath $peekFlag))
    [DeskFenceKeys]::Enabled = $peekOn
  }
  $peekPress = $false
  if ([DeskFenceKeys]::Active) {
    $peekPress = ([DeskFenceKeys]::TakePresses() -gt 0)
  } else {
    $ws = [DeskFenceDrag]::WinSpace()
    $peekPress = ($ws -eq 1 -and $prevWs -eq 0 -and $peekOn)
    $prevWs = $ws
  }
  if ($peekPress) {
    # this process saw the key press, so it may let DeskFence take the foreground (focus for Esc)
    [void][DeskFenceDrag]::AllowSetForegroundWindow(-1)
    [Console]::Out.WriteLine('P')
    [Console]::Out.Flush()
  }

  # ---- commands from DeskFence ----
  if (($tick % 5) -eq 0 -and $cmdFile -ne '' -and (Test-Path -LiteralPath $cmdFile)) {
    try {
      $cmd = [IO.File]::ReadAllText($cmdFile)
      Remove-Item -LiteralPath $cmdFile -Force -ErrorAction SilentlyContinue
      $parts = @($cmd.Trim() -split '\\s+')
      if ($parts[0] -eq 'SINK' -and $parts.Count -gt 1) {
        [long[]]$hs = @($parts[1..($parts.Count - 1)] | ForEach-Object { [long]$_ })
        [DeskFenceDrag]::Sink($hs, [uint32]$parent)
      }
    } catch { }
  }

  $a = 0
  if ($armed) { $a = 1 }
  $tick++
  $s = "S $d $o $a $sh $rd $rdraw"
  if ($s -ne $last -or ($tick % 20) -eq 0) {   # also a heartbeat every ~0.6 s
    [Console]::Out.WriteLine($s)
    [Console]::Out.Flush()
    $last = $s
  }
  if ($parent -gt 0 -and ($tick % 80) -eq 0) {
    if (-not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { exit }
  }
  Start-Sleep -Milliseconds 30 # fast enough to see both clicks of a double-click
}
`;

const IDLE = Object.freeze({ down: false, over: false, armed: false, shift: false, rdown: false, rdraw: false });

/**
 * "S 1 1 1 0 0 0" -> { down, over, armed, shift, rdown, rdraw } (the last two are optional);
 * "G" / "X" -> { event: 'draw-end' } / { event: 'draw-cancel' }; anything else -> null.
 */
function parseLine(line) {
  const text = String(line || '').trim();
  if (text === 'G') return { event: 'draw-end' };
  if (text === 'X') return { event: 'draw-cancel' };
  if (text === 'Q') return { event: 'quick-hide' };
  if (text === 'P') return { event: 'peek' };
  const match = /^S ([01]) ([01]) ([01]) ([01])(?: ([01]) ([01]))?$/.exec(text);
  if (!match) return null;
  return {
    down: match[1] === '1',
    over: match[2] === '1',
    armed: match[3] === '1',
    shift: match[4] === '1',
    rdown: match[5] === '1',
    rdraw: match[6] === '1',
  };
}

function createDragWatch(options = {}) {
  const platform = options.platform || process.platform;
  const spawnFn = options.spawn || spawn;
  const onState = options.onState || (() => {});
  const retryDelayMs = options.retryDelayMs == null ? 3000 : options.retryDelayMs;
  const maxRestarts = options.maxRestarts == null ? 3 : options.maxRestarts;
  const drawFlagPath = options.drawFlagPath || '';
  const extraPaths = {
    quickHideFlagPath: options.quickHideFlagPath || '',
    peekFlagPath: options.peekFlagPath || '',
    commandPath: options.commandPath || '',
  };

  let child = null;
  let stopped = true;
  let restarts = 0;
  let retryTimer = null;

  function launch() {
    let proc;
    try {
      proc = spawnFn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodeCommand(buildScript(process.pid, drawFlagPath, extraPaths))],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch (error) {
      console.warn('Drop-to-fence helper could not start:', error.message);
      return;
    }
    child = proc;

    let buffer = '';
    proc.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const state = parseLine(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        if (state) {
          restarts = 0; // it is clearly working
          onState(state);
        }
      }
    });
    proc.stderr.on('data', () => {}); // errors end the process; the exit handler deals with it
    proc.on('error', (error) => console.warn('Drop-to-fence helper error:', error.message));
    proc.on('exit', () => {
      if (child === proc) child = null;
      onState(IDLE); // never leave the overlay capturing the mouse because the helper died
      if (!stopped && restarts < maxRestarts) {
        restarts += 1;
        retryTimer = setTimeout(() => { if (!stopped) launch(); }, retryDelayMs);
      }
    });
  }

  function start() {
    if (platform !== 'win32') return false;
    if (!stopped) return true;
    stopped = false;
    restarts = 0;
    launch();
    return true;
  }

  function stop() {
    stopped = true;
    clearTimeout(retryTimer);
    if (child) {
      try { child.kill(); } catch (_) { /* already gone */ }
      child = null;
    }
    onState(IDLE);
  }

  return { start, stop, isRunning: () => !stopped };
}

module.exports = { createDragWatch, parseLine, buildScript, IDLE };
