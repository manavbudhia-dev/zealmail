// Shows / hides the real Windows Desktop icons (same as right-click Desktop > View > Show desktop icons).
// Windows only. Logic is separated from Electron so it can be tested with a fake exec.
const { execFile } = require('child_process');

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced';

// Sends the "toggle desktop icons" command (WM_COMMAND 0x7402) to the desktop's SHELLDLL_DefView window.
const TOGGLE_SCRIPT = `
$sig = @'
using System;
using System.Runtime.InteropServices;
public static class DeskFenceNative {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
'@
Add-Type -TypeDefinition $sig -ErrorAction Stop
$view = [IntPtr]::Zero
$progman = [DeskFenceNative]::FindWindow('Progman', $null)
if ($progman -ne [IntPtr]::Zero) { $view = [DeskFenceNative]::FindWindowEx($progman, [IntPtr]::Zero, 'SHELLDLL_DefView', $null) }
if ($view -eq [IntPtr]::Zero) {
  $w = [IntPtr]::Zero
  do {
    $w = [DeskFenceNative]::FindWindowEx([IntPtr]::Zero, $w, 'WorkerW', $null)
    if ($w -ne [IntPtr]::Zero) { $view = [DeskFenceNative]::FindWindowEx($w, [IntPtr]::Zero, 'SHELLDLL_DefView', $null) }
  } while ($view -eq [IntPtr]::Zero -and $w -ne [IntPtr]::Zero)
}
if ($view -eq [IntPtr]::Zero) { Write-Error 'Desktop window not found'; exit 2 }
[void][DeskFenceNative]::SendMessage($view, 0x111, [IntPtr]0x7402, [IntPtr]::Zero)
`;

/** "HideIcons    REG_DWORD    0x1" -> true. A missing value means the icons are shown. */
function parseHideIcons(output) {
  const match = /HideIcons\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(String(output || ''));
  return match ? parseInt(match[1], 16) === 1 : false;
}

function encodeCommand(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function createDesktopIcons(options = {}) {
  const platform = options.platform || process.platform;
  const exec = options.exec || execFile;
  const delay = options.delay || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  const run = (file, args) =>
    new Promise((resolve, reject) => {
      exec(file, args, { windowsHide: true, timeout: 10000 }, (error, stdout) => {
        if (error) reject(error);
        else resolve(String(stdout));
      });
    });

  async function isHidden() {
    if (platform !== 'win32') return false;
    try {
      return parseHideIcons(await run('reg', ['query', REG_KEY, '/v', 'HideIcons']));
    } catch (_) {
      return false; // value not present => icons are shown
    }
  }

  async function toggle() {
    await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodeCommand(TOGGLE_SCRIPT),
    ]);
  }

  async function applyHidden(hidden) {
    if (platform !== 'win32') {
      return { supported: false, success: false, hidden: false, error: 'Hiding Desktop icons is only supported on Windows' };
    }
    const before = await isHidden();
    if (before === hidden) return { supported: true, success: true, hidden: before, changed: false };

    try {
      await toggle();
      await delay(700); // Explorer writes the registry value shortly after the command
    } catch (error) {
      return { supported: true, success: false, hidden: before, changed: false, error: error.message };
    }
    const after = await isHidden();
    return {
      supported: true,
      success: after === hidden,
      hidden: after,
      changed: after !== before,
      error: after === hidden ? undefined : 'Windows did not confirm the change. Check Desktop > right-click > View > Show desktop icons.',
    };
  }

  // One change at a time. Two quick requests (checkbox clicked twice) used to read the same
  // "before" state, so the second one saw "nothing to do" and the end state was wrong.
  let queue = Promise.resolve();
  /** Makes the Desktop icons hidden/shown. Idempotent: only toggles when the state differs. */
  function setHidden(hidden) {
    const run = queue.then(() => applyHidden(hidden));
    queue = run.catch(() => {});
    return run;
  }

  return { isHidden, setHidden };
}

module.exports = { createDesktopIcons, parseHideIcons, encodeCommand, TOGGLE_SCRIPT, REG_KEY };
