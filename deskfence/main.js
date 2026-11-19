const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  globalShortcut,
  screen,
  nativeImage,
  dialog,
  shell,
  clipboard,
  nativeTheme,
} = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const chokidar = require('chokidar');
const { createDesktopIcons } = require('./desktop-icons');
const { mergeDetailed } = require('./fence-merge');

const desktopIcons = createDesktopIcons();
const { createDragWatch, IDLE: IDLE_STATE } = require('./drag-watch');
const { findMatches, pickIconSource } = require('./shortcut-finder');
const { spawn: spawnProcess } = require('child_process');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  globalHotkey: '', // optional extra Peek hotkey (Win + Space always works while winSpacePeek is on)
  autoStart: false,
  theme: 'auto',
  hideDesktopIcons: false,
  dropFolderToFence: true, // drag a folder from File Explorer onto the bare Desktop => folder fence
  drawToCreate: true, // right-click + drag on empty Desktop space draws a new fence
  privacyMode: false, // every fence's contents are masked until the mouse is over it
  quickHide: true, // double-click empty Desktop space hides / shows every fence
  quickHideIcons: true, // ...and the Desktop icons with them
  winSpacePeek: true, // Win + Space shows the fences above the open windows
};
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
const DIST_INDEX = path.join(__dirname, 'dist', 'renderer', 'index.html');
const ICON_PATH = path.join(__dirname, 'build', 'icon.png');
// 32x32 fallback so the tray never silently fails when build/icon.png is missing
const FALLBACK_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAz0lEQVR4nGNkQANymtb/0cWoCR5dP8qIzGeip+XY7GDCJUEvRzDR23J0RzDislw2cjdVLXy83BWrOAsuy3FpIBfgMpOJWIWUgsfLXbGGKoYD6A0G3AFY0wA2UDrnEAq/O8WOJHlcgKgQQDccXYyQPMUOoCUYdQBRDsCWoJDFCMnjA0TnAkIGEmshOhjwKBgtBwY8CkYdMFoODI0ooKsDcLXdKAW42poD3ixnZGAYmI4JAwOkn8gEYwyE5QwMSGmAno5AtosJlwQ9LGdgYGAAAF1BY/1KuHQrAAAAAElFTkSuQmCC';

// Same channel names as src/shared/types.ts (IPC_CHANNELS)
const CH = {
  GET_FENCES: 'get-fences',
  SAVE_FENCES: 'save-fences',
  GET_FILE_ICON: 'get-file-icon',
  OPEN_FILE: 'open-file',
  GET_FILES_IN_FOLDER: 'get-files-in-folder',
  SELECT_FOLDER: 'select-folder',
  MOVE_FILES: 'move-files',
  ENSURE_FENCE_FOLDER: 'ensure-fence-folder',
  GET_DESKTOP_PATH: 'get-desktop-path',
  GET_KNOWN_PATH: 'get-known-path',
  SHOW_IN_FOLDER: 'show-in-folder',
  COPY_TEXT: 'copy-text',
  RUN_CLEANUP: 'run-cleanup',
  GET_WINDOW_INFO: 'get-window-info',
  FENCES_UPDATED: 'fences-updated',
  DISPLAYS_CHANGED: 'displays-changed',
  SETTINGS_CHANGED: 'settings-changed',
  SET_DESKTOP_ICONS: 'set-desktop-icons-hidden',
  TOGGLE_PEEK: 'toggle-peek',
  SET_PEEK_STATE: 'set-peek-state',
  OPEN_SETTINGS: 'open-settings',
  TRAY_ACTION: 'tray-action',
  MINIMIZE_WINDOW: 'minimize-window',
  CLOSE_WINDOW: 'close-window',
  GET_SETTINGS: 'get-settings',
  SAVE_SETTINGS: 'save-settings',
  WATCH_FOLDER: 'watch-folder',
  UNWATCH_FOLDER: 'unwatch-folder',
  FOLDER_CHANGED: 'folder-changed',
};

// Packaged app, or "electron . --dist" (npm start) => load the built files.
// Otherwise => load the Vite dev server.
const useDist = app.isPackaged || process.argv.includes('--dist');

// One transparent overlay window per monitor: displayId -> { win, display, clickThrough }
const windows = new Map();
let tray = null;
let iconsHiddenByUs = false;
let isHidden = false; // Quick-hide: every fence hidden
let isPeeking = false; // Peek: fences shown above the open windows
let isQuitting = false;
let currentHotkey = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function messagePage(title, body) {
  const html =
    '<body style="margin:0;display:flex;align-items:center;justify-content:center;' +
    'height:100vh;background:#0f172a;color:#e2e8f0;font-family:system-ui,sans-serif">' +
    '<div style="max-width:560px;padding:24px"><h2>' + title + '</h2><p>' + body + '</p></div></body>';
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

// ---------------------------------------------------------------------------
// JSON persistence (crash-safe: write temp file, then rename)
// ---------------------------------------------------------------------------
function dataFile(name) {
  return path.join(app.getPath('userData'), name);
}

function readJson(name, fallback) {
  const file = dataFile(name);
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (error) {
    console.error(name + ' is corrupt, keeping a backup copy:', error);
    try {
      fs.copyFileSync(file, file + '.corrupt-' + Date.now());
    } catch (_) {
      /* ignore */
    }
    return fallback;
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeJson(name, data) {
  const file = dataFile(name);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  // On Windows an antivirus / indexer / backup tool can hold the file for a moment, making the
  // rename fail with EPERM/EBUSY/EACCES. Retry briefly instead of losing the save.
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (error) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      sleepSync(50 * (attempt + 1));
    }
  }
}

const fenceTombstones = new Map(); // ids deleted this session -> time

// fences.json, falling back to the last good copy if it is damaged
function readFencesList() {
  const main = readJson('fences.json', null);
  if (Array.isArray(main)) return main.filter((f) => f && typeof f.id === 'string');
  const backup = readJson('fences.json.bak', null);
  if (Array.isArray(backup)) {
    console.warn('fences.json unreadable: restored from fences.json.bak');
    return backup.filter((f) => f && typeof f.id === 'string');
  }
  return [];
}

function writeFencesList(list) {
  const file = dataFile('fences.json');
  try {
    // keep one backup of the last good version before replacing it
    if (fs.existsSync(file) && fs.statSync(file).size > 2) fs.copyFileSync(file, file + '.bak');
  } catch (_) {
    /* backup is best effort */
  }
  writeJson('fences.json', list);
}

function getSettings() {
  const settings = { ...DEFAULT_SETTINGS, ...readJson('settings.json', {}) };
  // the old default grabbed Ctrl+Space in every app (code completion, input methods): Win + Space replaces it
  if (settings.globalHotkey === 'CommandOrControl+Space') settings.globalHotkey = '';
  return settings;
}

// ---------------------------------------------------------------------------
// Folder watching (debounced: one event per folder per burst)
// ---------------------------------------------------------------------------
const watchers = new Map(); // folderPath -> { watcher, timer, pending, refs }

function allWindows() {
  return [...windows.values()].map((entry) => entry.win).filter((win) => win && !win.isDestroyed());
}

// The window on the primary display is the "controller": it runs scheduled tasks and
// automation rules, and receives tray actions, so nothing runs twice.
function controllerWindow() {
  const primaryId = screen.getPrimaryDisplay().id;
  const entry = windows.get(primaryId) || windows.values().next().value;
  return entry && !entry.win.isDestroyed() ? entry.win : null;
}

function sendToAll(channel, payload, exceptWebContents) {
  for (const win of allWindows()) {
    if (exceptWebContents && win.webContents === exceptWebContents) continue;
    win.webContents.send(channel, payload);
  }
}

function sendToController(channel, payload) {
  const win = controllerWindow();
  if (win) win.webContents.send(channel, payload);
}

const sendToRenderer = sendToAll; // folder-changed goes to every window (each handles its own fences)

function watchFolder(folderPath) {
  // Several things can watch the same folder (portal fences, rules...). Count them, so one of
  // them letting go does not stop the others.
  const existing = watchers.get(folderPath);
  if (existing) {
    existing.refs++;
    return;
  }
  if (!fs.existsSync(folderPath)) throw new Error('Folder not found: ' + folderPath);

  const entry = { watcher: null, timer: null, pending: [], refs: 1 };
  const queue = (event, filePath) => {
    entry.pending.push({ event, path: filePath });
    clearTimeout(entry.timer);
    entry.timer = setTimeout(async () => {
      const batch = entry.pending.splice(0);
      for (const item of batch) {
        let size = 0;
        let modified = Date.now();
        if (item.event === 'add' || item.event === 'addDir') {
          try {
            const s = await fsp.stat(item.path);
            size = s.size;
            modified = s.mtimeMs;
          } catch (_) {
            /* file already gone */
          }
        }
        sendToRenderer(CH.FOLDER_CHANGED, { event: item.event, path: item.path, size, modified, folderPath });
      }
    }, 300);
  };

  entry.watcher = chokidar
    .watch(folderPath, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      depth: 0, // immediate children only
      // A file that is still being copied/downloaded must not be reported (and then moved)
      // half-written: wait until its size has stopped changing.
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 },
    })
    .on('add', (p) => queue('add', p))
    .on('unlink', (p) => queue('unlink', p))
    .on('addDir', (p) => p !== folderPath && queue('addDir', p))
    .on('unlinkDir', (p) => p !== folderPath && queue('unlinkDir', p))
    .on('error', (error) => console.error('Watcher error on ' + folderPath + ':', error));

  watchers.set(folderPath, entry);
}

// Which window holds which watches. A window that is closed (monitor unplugged) or reloaded
// never sends its unwatch calls, so its holds are released here instead of leaking forever.
const watchOwners = new Map(); // webContents.id -> Map(folderPath -> count)
const trackedSenders = new WeakSet();

function releaseAllWatches(contentsId) {
  const held = watchOwners.get(contentsId);
  if (!held) return;
  watchOwners.delete(contentsId);
  for (const [folderPath, count] of held) {
    for (let i = 0; i < count; i++) unwatchFolder(folderPath);
  }
}

function watchFolderFor(sender, folderPath) {
  if (typeof folderPath !== 'string' || !folderPath) throw new Error('No folder given');
  watchFolder(folderPath); // throws for a missing folder: nothing is recorded then
  if (!trackedSenders.has(sender)) {
    trackedSenders.add(sender);
    const id = sender.id;
    sender.once('destroyed', () => releaseAllWatches(id));
    // a reload starts a fresh page that knows nothing about the old page's watches
    sender.on('did-navigate', () => releaseAllWatches(id));
  }
  let held = watchOwners.get(sender.id);
  if (!held) {
    held = new Map();
    watchOwners.set(sender.id, held);
  }
  held.set(folderPath, (held.get(folderPath) || 0) + 1);
}

function unwatchFolderFor(sender, folderPath) {
  const held = watchOwners.get(sender.id);
  const count = held ? held.get(folderPath) || 0 : 0;
  if (count === 0) return; // this window never held it: releasing would stop someone else's watch
  if (count === 1) held.delete(folderPath);
  else held.set(folderPath, count - 1);
  unwatchFolder(folderPath);
}

function unwatchFolder(folderPath, force) {
  const entry = watchers.get(folderPath);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0 && !force) return; // someone else still needs it
  clearTimeout(entry.timer);
  entry.watcher.close();
  watchers.delete(folderPath);
}

async function getFilesInFolder(folderPath) {
  let stat;
  try {
    stat = await fsp.stat(folderPath);
  } catch (_) {
    throw new Error('Folder not found: ' + folderPath);
  }
  if (!stat.isDirectory()) throw new Error('Not a folder: ' + folderPath);

  const entries = await fsp.readdir(folderPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // same dotfile rule as the watcher
    const fullPath = path.join(folderPath, entry.name);
    try {
      const s = await fsp.stat(fullPath);
      files.push({
        name: entry.name,
        path: fullPath,
        type: s.isDirectory() ? 'folder' : 'file',
        size: s.size,
        modified: s.mtimeMs,
      });
    } catch (_) {
      /* broken link / permission denied: skip it instead of failing the whole folder */
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Real file moves / copies (what a fence actually does when you drop something on it)
// ---------------------------------------------------------------------------
const samePath = (a, b) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

// All moves/copies run one at a time. "Pick a free name, then rename" is two steps; if two
// transfers did it at once they would pick the same name and one file would silently
// overwrite the other (rename replaces an existing file).
let transferQueue = Promise.resolve();
function withTransferLock(task) {
  const run = transferQueue.then(task, task);
  transferQueue = run.catch(() => {});
  return run;
}

// Atomically claims a name that does not exist yet by creating it (exclusive create).
// "report.pdf" -> "report (1).pdf" -> "report (2).pdf" ... never overwrites anything.
async function reserveTarget(destDir, name, isDirectory) {
  const ext = isDirectory ? '' : path.extname(name);
  const base = isDirectory ? name : path.basename(name, ext);
  for (let i = 0; ; i++) {
    const candidate = path.join(destDir, i === 0 ? name : base + ' (' + i + ')' + ext);
    try {
      if (isDirectory) {
        await fsp.mkdir(candidate); // fails with EEXIST if it exists
      } else {
        const handle = await fsp.open(candidate, 'wx'); // fails with EEXIST if it exists
        await handle.close();
      }
      return candidate;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}

function friendlyFsError(error) {
  switch (error && error.code) {
    case 'ENOENT':
      return 'File no longer exists';
    case 'EPERM':
    case 'EACCES':
      return 'Permission denied (it may belong to all users or need administrator rights)';
    case 'EBUSY':
      return 'File is in use by another program';
    case 'ENOSPC':
      return 'Not enough disk space';
    default:
      return (error && error.message) || 'Unknown error';
  }
}

async function transferOne(source, destDir, mode) {
  const src = path.resolve(source);
  const dest = path.resolve(destDir);
  const stat = await fsp.lstat(src); // throws ENOENT if it is gone

  if (path.parse(src).root === src) throw new Error('Cannot move a whole drive');
  if (mode === 'move' && samePath(path.dirname(src), dest)) return { from: source, to: source, unchanged: true };

  const srcWithSep = src + path.sep;
  const destWithSep = dest + path.sep;
  const inside = process.platform === 'win32'
    ? destWithSep.toLowerCase().startsWith(srcWithSep.toLowerCase())
    : destWithSep.startsWith(srcWithSep);
  if (stat.isDirectory() && inside) throw new Error('Cannot put a folder inside itself');

  await fsp.mkdir(dest, { recursive: true });
  const isDirectory = stat.isDirectory();
  const target = await reserveTarget(dest, path.basename(src), isDirectory);

  // Once the data is complete at `target`, it must never be removed again: for a cross-drive
  // move the source may already be partly deleted, so `target` can be the only full copy left.
  let targetComplete = false;
  try {
    // `target` is our own empty placeholder, so replacing it is safe
    if (isDirectory && mode !== 'copy') await fsp.rmdir(target);

    if (mode === 'copy') {
      await fsp.cp(src, target, { recursive: true, force: true });
      targetComplete = true;
    } else {
      try {
        await fsp.rename(src, target);
        targetComplete = true;
      } catch (error) {
        if (error.code !== 'EXDEV') throw error;
        // different drive: copy, and only delete the original once the copy succeeded
        await fsp.cp(src, target, { recursive: true, force: true });
        targetComplete = true;
        try {
          await fsp.rm(src, { recursive: true, force: true });
        } catch (removeError) {
          // The copy is complete; part of the original may be left behind (a file in use...).
          // Report it, but keep the copy: deleting it now could lose the only full version.
          removeError.copiedTo = target;
          throw removeError;
        }
      }
    }
  } catch (error) {
    // do not leave our empty placeholder (or a half-finished copy) behind
    if (!targetComplete) await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return { from: source, to: target };
}

const lockedTransfer = (source, destDir, mode) => withTransferLock(() => transferOne(source, destDir, mode));

async function transferFiles(paths, destDir, mode) {
  const moved = [];
  const failed = [];
  const list = Array.isArray(paths) ? paths : [];

  // A missing/blank destination would resolve to the app's own working folder
  if (typeof destDir !== 'string' || !destDir.trim() || !path.isAbsolute(destDir)) {
    for (const source of list) failed.push({ path: String(source), error: 'No valid destination folder' });
    return { moved, failed };
  }

  for (const source of list) {
    if (typeof source !== 'string' || !source) continue;
    try {
      moved.push(await lockedTransfer(source, destDir, mode === 'copy' ? 'copy' : 'move'));
    } catch (error) {
      const message = friendlyFsError(error);
      failed.push({
        path: source,
        error: error && error.copiedTo ? 'Copied to ' + error.copiedTo + ', but the original could not be fully removed: ' + message : message,
      });
    }
  }
  return { moved, failed };
}

// ---------------------------------------------------------------------------
// Scheduled cleanup (preview first, Recycle Bin for deletes, system folders protected)
// ---------------------------------------------------------------------------
function protectedRoots() {
  if (process.platform === 'win32') {
    return [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData]
      .filter(Boolean)
      .map((p) => path.resolve(p));
  }
  return ['/usr', '/bin', '/sbin', '/etc', '/var', '/System', '/Library', '/boot'].map((p) => path.resolve(p));
}

function isInsidePath(child, parent) {
  const c = path.resolve(child) + path.sep;
  const p = path.resolve(parent) + path.sep;
  return process.platform === 'win32' ? c.toLowerCase().startsWith(p.toLowerCase()) : c.startsWith(p);
}

function isProtectedFolder(folder) {
  const resolved = path.resolve(folder);
  if (path.parse(resolved).root === resolved) return true; // a whole drive
  return protectedRoots().some((root) => isInsidePath(resolved, root));
}

async function runCleanup(task) {
  const { targetPaths, olderThanDays, action, destination, dryRun, extensions } = task || {};
  // "older than 0 days" matches every item in the folder. The form never allows it, but a
  // damaged / hand-edited task must not be able to trash or move a whole folder.
  if (!dryRun && !(Number(olderThanDays) >= 1)) {
    return { matched: [], processed: 0, failed: [{ path: '', error: 'Refused: "older than" must be at least 1 day' }] };
  }
  const wantedExtensions = (Array.isArray(extensions) ? extensions : [])
    .map((e) => String(e).trim().replace(/^\./, '').toLowerCase())
    .filter(Boolean);
  const cutoff = Date.now() - Math.max(0, Number(olderThanDays) || 0) * 86400000;
  const matched = [];
  const failed = [];

  for (const folder of Array.isArray(targetPaths) ? targetPaths : []) {
    if (typeof folder !== 'string' || !folder) continue;
    // Resolve symlinks / junctions first: a link to C:\\Windows must not get past the check
    let real = folder;
    try {
      real = await fsp.realpath(folder);
    } catch (_) {
      /* folder missing: reported below */
    }
    if (isProtectedFolder(folder) || isProtectedFolder(real)) {
      failed.push({ path: folder, error: 'Protected system folder, skipped' });
      continue;
    }
    let files;
    try {
      files = await getFilesInFolder(real);
    } catch (error) {
      failed.push({ path: folder, error: friendlyFsError(error) });
      continue;
    }
    for (const file of files) {
      if (file.modified >= cutoff) continue; // too new
      if (wantedExtensions.length > 0) {
        // extension filter applies to files only (folders have no extension)
        const ext = path.extname(file.name).replace(/^\./, '').toLowerCase();
        if (file.type === 'folder' || !wantedExtensions.includes(ext)) continue;
      }
      // never touch the archive folder itself (or anything containing it)
      if (destination && (samePath(path.resolve(file.path), path.resolve(destination)) || isInsidePath(destination, file.path))) continue;
      matched.push(file);
    }
  }

  if (dryRun) return { matched, processed: 0, failed };

  let processed = 0;
  for (const file of matched) {
    try {
      if (action === 'delete') {
        await shell.trashItem(file.path); // Recycle Bin, so it can be restored
      } else {
        if (!destination) throw new Error('No destination folder set');
        await lockedTransfer(file.path, destination, 'move');
      }
      processed++;
    } catch (error) {
      failed.push({ path: file.path, error: friendlyFsError(error) });
    }
  }
  return { matched, processed, failed };
}

// ---------------------------------------------------------------------------
// IPC (registered ONCE, not per window)
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle(CH.GET_FENCES, () => readFencesList());

  ipcMain.handle(CH.SAVE_FENCES, (event, fences, deleted, revived) => {
    if (!Array.isArray(fences)) {
      console.error('save-fences refused: payload is not a list');
      return { success: false, error: 'Invalid fences payload' };
    }
    try {
      const removed = Array.isArray(deleted) ? deleted.filter((id) => typeof id === 'string') : [];
      // Fences the user deliberately brought back (import, restoring a backup) may reuse ids that
      // were deleted earlier this session: their tombstones must not reject them.
      if (Array.isArray(revived)) for (const id of revived) if (typeof id === 'string') fenceTombstones.delete(id);
      const { fences: merged, rejected } = mergeDetailed(readFencesList(), fences, removed, fenceTombstones);
      writeFencesList(merged);
      // other monitors' windows take over the merged result (the sender gets it as the reply)
      sendToAll(CH.FENCES_UPDATED, { fences: merged, deleted: removed }, event.sender);
      // `deleted` in the reply = fences the sender still had that were deleted elsewhere
      return { success: true, fences: merged, deleted: rejected };
    } catch (error) {
      console.error('Error saving fences:', error);
      return { success: false, error: String(error && error.message) };
    }
  });

  ipcMain.handle(CH.GET_SETTINGS, () => getSettings());

  ipcMain.handle(CH.SAVE_SETTINGS, async (_e, settings) => {
    try {
      const merged = { ...getSettings(), ...settings };
      writeJson('settings.json', merged);
      const iconResult = await applySettings(merged);
      sendToAll(CH.SETTINGS_CHANGED, merged);
      syncTrayPrivacy(merged);
      return { success: true, desktopIcons: iconResult };
    } catch (error) {
      console.error('Error saving settings:', error);
      return { success: false };
    }
  });

  // Which monitor this window is on, and which monitors exist
  ipcMain.handle(CH.GET_WINDOW_INFO, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const entry = [...windows.entries()].find(([, e]) => e.win === win);
    const primaryId = screen.getPrimaryDisplay().id;
    const displays = screen.getAllDisplays().map((d, index) => ({
      id: d.id,
      primary: d.id === primaryId,
      label: 'Monitor ' + (index + 1) + (d.id === primaryId ? ' (main)' : '') + ' • ' + d.size.width + '×' + d.size.height,
    }));
    return {
      displayId: entry ? entry[0] : primaryId,
      isController: !!win && win === controllerWindow(),
      primaryDisplayId: primaryId,
      displays,
    };
  });

  ipcMain.handle(CH.SET_DESKTOP_ICONS, async (_e, hidden) => {
    const result = await desktopIcons.setHidden(!!hidden);
    if (result.success && result.changed) iconsHiddenByUs = !!hidden;
    return result;
  });

  ipcMain.handle(CH.GET_FILE_ICON, async (_e, filePath) => {
    // Windows hands back a DRIVE icon for folders, so folders get the page's own folder icon
    if (typeof filePath === 'string' && filePath && !/^shell:/i.test(filePath)) {
      try {
        if ((await fsp.stat(filePath)).isDirectory()) return 'folder';
      } catch (_) {
        /* missing / no access: fall through to the normal lookup */
      }
    }
    // Windows returns a blank page for a shortcut's own file: draw the icon of what it opens instead
    // (the program, or the .ico the shortcut names), the way the Desktop shows it.
    let source = filePath;
    if (typeof filePath === 'string' && /\.lnk$/i.test(filePath) && process.platform === 'win32') {
      try {
        const link = shell.readShortcutLink(filePath);
        if (link.target) {
          try {
            if ((await fsp.stat(link.target)).isDirectory()) return 'folder';
          } catch (_) {
            /* target missing: use the shortcut's own icon */
          }
        }
        source = pickIconSource(filePath, link);
      } catch (_) {
        /* unreadable shortcut: keep its own icon */
      }
    } else if (typeof filePath === 'string' && /\.url$/i.test(filePath)) {
      // Internet shortcut: "IconFile=C:\...\app.exe" names the icon to show
      try {
        const match = /^IconFile=(.+)$/im.exec(await fsp.readFile(filePath, 'utf8'));
        const iconFile = match && match[1].trim();
        if (iconFile && fs.existsSync(iconFile)) source = iconFile;
      } catch (_) {
        /* keep its own icon */
      }
    }
    try {
      const icon = await app.getFileIcon(source, { size: 'large' });
      return icon.toDataURL();
    } catch (_) {
      return null;
    }
  });

  ipcMain.handle(CH.OPEN_FILE, async (_e, filePath) => {
    // Windows special folders ("This PC", "Recycle Bin"...) are shell: addresses, not files
    if (typeof filePath === 'string' && /^shell:[\w .\\-]+$/i.test(filePath)) {
      try {
        spawnProcess('explorer.exe', [filePath], { detached: true, stdio: 'ignore' }).unref();
        if (isPeeking) setPeek(false);
        return { success: true };
      } catch (error) {
        return { success: false, error: String((error && error.message) || error) };
      }
    }
    const error = await shell.openPath(filePath); // returns '' on success
    if (!error && isPeeking) setPeek(false); // what you opened comes to the front, the fences go back down
    return { success: !error, error: error || undefined };
  });

  // Layout presets: look up the user's own shortcuts/folders by name (Desktop first, then Start Menu)
  ipcMain.handle('find-shortcuts', (_e, requests) => {
    const list = (Array.isArray(requests) ? requests : [])
      .filter((r) => r && typeof r.key === 'string' && Array.isArray(r.names))
      .slice(0, 100);
    const desktops = [app.getPath('desktop')];
    if (process.env.PUBLIC) desktops.push(path.join(process.env.PUBLIC, 'Desktop'));
    const startMenus = [path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')];
    if (process.env.ProgramData) startMenus.push(path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
    const roots = [
      ...desktops.map((dir) => ({ dir, source: 'desktop', depth: 1, dirs: true, files: true, exts: ['.lnk', '.url'] })),
      ...startMenus.map((dir) => ({ dir, source: 'start', depth: 4, dirs: false, files: true, exts: ['.lnk'] })),
      { dir: app.getPath('documents'), source: 'docs', depth: 1, dirs: true, files: false },
    ];
    const matches = findMatches(list, roots);
    for (const match of Object.values(matches)) {
      if (!match) continue;
      match.iconSource = match.path;
      if (/\.lnk$/i.test(match.path)) {
        try {
          match.iconSource = pickIconSource(match.path, shell.readShortcutLink(match.path));
        } catch (_) {
          /* keep the shortcut's own icon */
        }
      }
    }
    return matches;
  });

  // A copy of the fence list before a layout replaces it
  ipcMain.handle('backup-fences', () => {
    try {
      const file = dataFile('fences.json');
      if (!fs.existsSync(file)) return '';
      const copy = dataFile('fences.before-layout-' + Date.now() + '.json');
      fs.copyFileSync(file, copy);
      return copy;
    } catch (_) {
      return '';
    }
  });

  ipcMain.handle(CH.GET_FILES_IN_FOLDER, (_e, folderPath) => getFilesInFolder(folderPath));

  ipcMain.handle(CH.SELECT_FOLDER, async (event, defaultPath) => {
    const options = { properties: ['openDirectory'], defaultPath: defaultPath || undefined };
    const parent = BrowserWindow.fromWebContents(event.sender);
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths.length ? null : result.filePaths[0];
  });

  ipcMain.handle(CH.MOVE_FILES, (_e, paths, destDir, mode) => transferFiles(paths, destDir, mode));

  ipcMain.handle(CH.GET_DESKTOP_PATH, () => app.getPath('desktop'));

  ipcMain.handle(CH.GET_KNOWN_PATH, (_e, name) => {
    const allowed = ['desktop', 'downloads', 'documents', 'temp'];
    return allowed.includes(name) ? app.getPath(name) : '';
  });

  ipcMain.handle(CH.SHOW_IN_FOLDER, (_e, filePath) => {
    if (typeof filePath === 'string' && filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
      return true;
    }
    return false;
  });

  ipcMain.handle(CH.COPY_TEXT, (_e, text) => {
    clipboard.writeText(String(text ?? ''));
    return true;
  });

  // The same task can be started by the scheduler and by "Run now" (possibly from another
  // monitor's window) at the same moment: only one run at a time per task.
  const runningCleanups = new Set();
  ipcMain.handle(CH.RUN_CLEANUP, async (_e, task) => {
    const id = task && !task.dryRun && typeof task.taskId === 'string' ? task.taskId : null;
    if (id) {
      if (runningCleanups.has(id)) return { matched: [], processed: 0, failed: [], busy: true };
      runningCleanups.add(id);
    }
    try {
      return await runCleanup(task);
    } finally {
      if (id) runningCleanups.delete(id);
    }
  });

  // Every fence that is not linked to a folder gets its own real folder in Documents\DeskFence
  ipcMain.handle(CH.ENSURE_FENCE_FOLDER, async (_e, name, id) => {
    const safe =
      String(name || 'Fence').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim() || 'Fence';
    const suffix = String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-6);
    const dir = path.join(app.getPath('documents'), 'DeskFence', suffix ? safe + '-' + suffix : safe);
    await fsp.mkdir(dir, { recursive: true });
    return dir;
  });

  ipcMain.handle(CH.WATCH_FOLDER, (event, folderPath) => {
    watchFolderFor(event.sender, folderPath);
    return { success: true };
  });

  ipcMain.handle(CH.UNWATCH_FOLDER, (event, folderPath) => {
    unwatchFolderFor(event.sender, folderPath);
    return { success: true };
  });

  // The page tells us a drop happened: stop capturing the mouse right away
  ipcMain.on('end-drag-capture', () => setDragLatch(false));
  // A fence item is being dragged inside the app: every monitor's window must accept the drop
  ipcMain.on('begin-item-drag', () => setDragLatch(true, 'item'));
  // Authoritative folder test for dropped paths (the browser's own test can be wrong)
  ipcMain.handle('are-paths-folders', async (_e, paths) =>
    Promise.all(
      (Array.isArray(paths) ? paths : []).map(async (p) => {
        try {
          return (await fsp.stat(String(p))).isDirectory();
        } catch (_) {
          return false;
        }
      })
    )
  );
  ipcMain.on(CH.TOGGLE_PEEK, () => togglePeek());
  ipcMain.on('toggle-quick-hide', () => toggleQuickHide());
  ipcMain.on('end-peek', () => setPeek(false));
  ipcMain.on(CH.MINIMIZE_WINDOW, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.minimize();
  });
  ipcMain.on(CH.CLOSE_WINDOW, () => hideAllWindows());
}

// ---------------------------------------------------------------------------
// Settings that need the OS (hotkey, start on boot)
// ---------------------------------------------------------------------------
function registerHotkey(hotkey) {
  if (currentHotkey) {
    globalShortcut.unregister(currentHotkey);
    currentHotkey = null;
  }
  if (!hotkey) return true; // no extra hotkey wanted
  try {
    if (globalShortcut.register(hotkey, () => togglePeek())) {
      currentHotkey = hotkey;
      return true;
    }
  } catch (error) {
    console.warn('Invalid hotkey "' + hotkey + '":', error.message);
  }
  console.warn('Could not register global shortcut ' + hotkey + ' (already used or invalid).');
  return false;
}

async function applySettings(settings) {
  // native menus/dialogs and prefers-color-scheme follow the chosen theme
  nativeTheme.themeSource = settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'system';

  if ((settings.globalHotkey || null) !== currentHotkey) registerHotkey(settings.globalHotkey);
  applyDesktopGestures(settings);
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: !!settings.autoStart });
  }

  // Hide / show the real Desktop icons (Windows). We always restore them when DeskFence quits.
  const wanted = !!settings.hideDesktopIcons;
  if (wanted !== iconsHiddenByUs) {
    const result = await desktopIcons.setHidden(wanted);
    if (result.success && result.changed) iconsHiddenByUs = wanted;
    if (!result.success) console.warn('Desktop icons: ' + (result.error || 'could not change'));
    return result;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
async function loadRenderer(win) {
  if (useDist) {
    if (fs.existsSync(DIST_INDEX)) {
      await win.loadFile(DIST_INDEX);
    } else {
      await win.loadURL(
        messagePage('DeskFence is not built yet', 'Run <code>npm run build</code> first, then <code>npm start</code>.')
      );
    }
    return;
  }

  // Dev: the Vite server may still be starting, so retry for ~20 seconds.
  for (let attempt = 1; attempt <= 40; attempt++) {
    if (win.isDestroyed()) return;
    try {
      await win.loadURL(DEV_URL);
      return;
    } catch (_) {
      await sleep(500);
    }
  }
  if (win.isDestroyed()) return;
  if (fs.existsSync(DIST_INDEX)) {
    await win.loadFile(DIST_INDEX);
  } else {
    await win.loadURL(
      messagePage(
        'Could not reach the dev server',
        'Start it with <code>npm run dev:renderer</code> (or just use <code>npm run dev</code>).'
      )
    );
  }
}

// ---------------------------------------------------------------------------
// Click-through: each window covers a whole monitor, so empty areas must let
// clicks fall through to the desktop / other apps. Only fences, dialogs and
// buttons (anything the renderer's hit-test reports as interactive) catch the mouse.
// ---------------------------------------------------------------------------
let hitTestTimer = null;

// ---- Drop a folder on the Desktop => new fence ------------------------------------------------
// A click-through window never receives drag-and-drop. While the user drags something out of a File
// Explorer window over the bare Desktop (see drag-watch.js) every overlay window stops being
// click-through until the mouse button is released, so the drop lands in the page.
// Shift held = normal Windows drop (the overlay stays out of the way).
let dragWatch = null;
let dragLatched = false;
let dragLatchTimer = null;
const DRAG_LATCH_MAX_MS = 15000; // safety: never keep the screen captured longer than this
const DRAG_HEARTBEAT_TIMEOUT_MS = 2500; // the helper reports about every 0.6 s; silence = it is stuck
let lastDragHeartbeat = 0;
let dragLatchSource = null; // 'external' (a folder from Explorer) | 'item' (a fence item dragged in the app)
let dragLatchedAt = 0;
const ITEM_DRAG_LATCH_MAX_MS = 60000;
let dragWatchdog = null;

function setDragLatch(on, source = 'external') {
  if (!on && !dragLatched) return;
  dragLatched = on;
  dragLatchSource = on ? source : null;
  dragLatchedAt = on ? Date.now() : 0;
  clearTimeout(dragLatchTimer);
  clearInterval(dragWatchdog);
  dragWatchdog = null;
  if (on) {
    for (const entry of [...windows.values()]) setClickThrough(entry, false);
    dragLatchTimer = setTimeout(() => setDragLatch(false), source === 'item' ? ITEM_DRAG_LATCH_MAX_MS : DRAG_LATCH_MAX_MS);
    if (source === 'external') {
      // if the helper goes quiet while we are capturing, give the screen back
      dragWatchdog = setInterval(() => {
        if (Date.now() - lastDragHeartbeat > DRAG_HEARTBEAT_TIMEOUT_MS) setDragLatch(false);
      }, 500);
    }
  }
  // when switching off, the normal click-through polling takes over again within ~60 ms
}

// ---- Right-click + drag on empty Desktop space => draw a new fence ------------------------------
// The helper (drag-watch.js) sees the right button and tells us when a draw starts/ends; the
// rectangle itself is measured here with Electron's cursor position (DIP, correct on every monitor).
let dropFolderEnabled = true;
let drawEnabled = true;
let draw = null; // { start, entry, timer } while a fence is being drawn
let rightPressPoint = null;
const DRAW_FLAG_PATH = path.join(os.tmpdir(), 'deskfence-draw-' + process.pid + '.on');
const QUICK_HIDE_FLAG_PATH = path.join(os.tmpdir(), 'deskfence-quickhide-' + process.pid + '.on');
const PEEK_FLAG_PATH = path.join(os.tmpdir(), 'deskfence-peek-' + process.pid + '.on');
const HELPER_COMMAND_PATH = path.join(os.tmpdir(), 'deskfence-command-' + process.pid + '.txt');
let quickHideEnabled = true;
let winSpaceEnabled = true;

function setFlagFile(file, on) {
  try {
    if (on && !isQuitting) fs.writeFileSync(file, '1');
    else fs.rmSync(file, { force: true });
  } catch (_) {
    /* best effort */
  }
}

// Tells the helper to put our windows just above the Desktop (below every app window)
function sinkWindows() {
  if (process.platform !== 'win32' || !dragWatch) return;
  const handles = allWindows()
    .filter((win) => win.isVisible())
    .map((win) => {
      const buf = win.getNativeWindowHandle();
      return buf.length >= 8 ? buf.readBigUInt64LE(0).toString() : String(buf.readUInt32LE(0));
    });
  if (handles.length === 0) return;
  try {
    fs.writeFileSync(HELPER_COMMAND_PATH + '.tmp', 'SINK ' + handles.join(' '));
    fs.renameSync(HELPER_COMMAND_PATH + '.tmp', HELPER_COMMAND_PATH);
  } catch (_) {
    /* the fences simply stay where they are */
  }
}

// The helper only arms the gesture while this file exists, so while the fences are hidden (Peek,
// "Hide") the Desktop's own right-click menu is never swallowed.
function updateDrawFlag() {
  const on = drawEnabled && !isHidden && !isPeeking && !isQuitting && allWindows().some((win) => win.isVisible());
  try {
    if (on) fs.writeFileSync(DRAW_FLAG_PATH, '1');
    else fs.rmSync(DRAW_FLAG_PATH, { force: true });
  } catch (_) {
    /* best effort: without the flag the gesture simply stays off */
  }
}

function entryAt(point) {
  for (const entry of windows.values()) {
    if (entry.win.isDestroyed()) continue;
    const b = entry.win.getBounds();
    if (point.x >= b.x && point.y >= b.y && point.x < b.x + b.width && point.y < b.y + b.height) return entry;
  }
  return null;
}

// Rectangle from the press point to `end`, in the window's own coordinates, kept on that monitor
function drawRect(entry, start, end) {
  const b = entry.win.getBounds();
  const clampX = (v) => Math.min(Math.max(v - b.x, 0), b.width);
  const clampY = (v) => Math.min(Math.max(v - b.y, 0), b.height);
  const x1 = clampX(start.x), y1 = clampY(start.y), x2 = clampX(end.x), y2 = clampY(end.y);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

function sendTo(entry, channel, payload) {
  if (entry && !entry.win.isDestroyed()) entry.win.webContents.send(channel, payload);
}

function beginDraw() {
  const start = rightPressPoint || screen.getCursorScreenPoint();
  const entry = entryAt(start);
  if (!entry || !entry.win.isVisible()) return;
  draw = { start, entry, timer: null };
  const tick = () => {
    if (!draw) return;
    sendTo(draw.entry, 'draw-preview', drawRect(draw.entry, draw.start, screen.getCursorScreenPoint()));
  };
  tick();
  draw.timer = setInterval(tick, 30);
}

function endDraw(create) {
  if (!draw) return;
  const { start, entry, timer } = draw;
  draw = null;
  clearInterval(timer);
  sendTo(entry, 'draw-preview', null);
  if (create && !entry.win.isDestroyed() && entry.win.isVisible()) {
    sendTo(entry, 'draw-fence', drawRect(entry, start, screen.getCursorScreenPoint()));
    entry.win.focus(); // so the new fence's name can be typed right away
  }
}

function onDrawState(state) {
  if (state.rdown && !rightPressPoint) rightPressPoint = screen.getCursorScreenPoint();
  if (!state.rdown && !draw) rightPressPoint = null;
  if (state.rdraw && !draw && drawEnabled) beginDraw();
  // helper died / restarted mid-draw (IDLE): drop the preview, create nothing
  if (!state.rdown && draw && state === IDLE_STATE) endDraw(false);
}

function onDragState(state) {
  lastDragHeartbeat = Date.now();
  if (state.event) {
    if (state.event === 'quick-hide') toggleQuickHide();
    else if (state.event === 'peek') togglePeek();
    else {
      endDraw(state.event === 'draw-end');
      rightPressPoint = null;
    }
    return;
  }
  onDrawState(state);
  if (!dropFolderEnabled) return;
  if (dragLatchSource === 'item') {
    // an in-app item drag ends with the page's dragend/drop message; the helper is only a backup
    if (!state.down && Date.now() - dragLatchedAt > 1500) setDragLatch(false);
    return;
  }
  if (!state.down || !state.armed || state.shift) {
    setDragLatch(false);
    return;
  }
  // once latched stay latched: over the capturing overlay the helper no longer sees "the Desktop"
  if (dragLatched || state.over) setDragLatch(true);
}

// One helper serves both "drop a folder on the Desktop" and "draw a fence"; it runs while either is on.
function applyDesktopGestures(settings) {
  const dropFolder = settings.dropFolderToFence !== false;
  const drawFence = settings.drawToCreate !== false;
  quickHideEnabled = settings.quickHide !== false;
  winSpaceEnabled = settings.winSpacePeek !== false;
  dropFolderEnabled = dropFolder;
  drawEnabled = drawFence;
  if (!dropFolder) setDragLatch(false);
  if (!drawFence) endDraw(false);
  updateDrawFlag();
  setFlagFile(QUICK_HIDE_FLAG_PATH, quickHideEnabled);
  setFlagFile(PEEK_FLAG_PATH, winSpaceEnabled);
  const needed = dropFolder || drawFence || quickHideEnabled || winSpaceEnabled;
  if (needed && !dragWatch) {
    dragWatch = createDragWatch({
      onState: onDragState,
      drawFlagPath: DRAW_FLAG_PATH,
      quickHideFlagPath: QUICK_HIDE_FLAG_PATH,
      peekFlagPath: PEEK_FLAG_PATH,
      commandPath: HELPER_COMMAND_PATH,
    });
    if (!dragWatch.start()) dragWatch = null; // not Windows
  } else if (!needed && dragWatch) {
    dragWatch.stop();
    dragWatch = null;
  }
}
const HIT_TEST_TIMEOUT_MS = 250;

function setClickThrough(entry, value) {
  if (!entry || entry.win.isDestroyed() || value === entry.clickThrough) return;
  entry.clickThrough = value;
  // forward: mouse moves still reach the page while clicks pass through, so hover (auto roll-up) works
  if (value) entry.win.setIgnoreMouseEvents(true, { forward: true });
  else entry.win.setIgnoreMouseEvents(false);
}

// Asks one window "is something clickable at x,y?". A window that does not answer in time
// (hung or crashed page) counts as NOT interactive, so it can never keep the whole monitor blocked.
async function hitTestWindow(entry, x, y) {
  const win = entry.win;
  if (win.webContents.isCrashed()) return false;
  if (entry.pendingHitTest) return false; // still waiting for an earlier, unanswered question

  const asked = win.webContents
    .executeJavaScript('window.__deskfenceHitTest ? window.__deskfenceHitTest(' + x + ',' + y + ') : false')
    .then((answer) => answer === true, () => false);
  entry.pendingHitTest = asked.finally(() => {
    entry.pendingHitTest = null;
  });

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), HIT_TEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([asked, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function updateClickThroughFor(entry, point) {
  const win = entry.win;
  if (win.isDestroyed() || !win.isVisible() || entry.checking) return;
  if (dragLatched) return; // a folder is being dragged in: stay interactive so the drop reaches the page
  entry.checking = true;
  try {
    const bounds = win.getBounds();
    const x = point.x - bounds.x;
    const y = point.y - bounds.y;
    if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) {
      setClickThrough(entry, true); // cursor is on another monitor
      return;
    }
    setClickThrough(entry, !(await hitTestWindow(entry, x, y)));
  } catch (_) {
    setClickThrough(entry, true); // when in doubt never block the user's desktop
  } finally {
    entry.checking = false;
  }
}

function updateClickThrough() {
  const point = screen.getCursorScreenPoint();
  // every window independently, so one slow window cannot hold up the others
  for (const entry of [...windows.values()]) updateClickThroughFor(entry, point);
}

function startClickThrough() {
  if (hitTestTimer) return;
  hitTestTimer = setInterval(updateClickThrough, 60);
}

// ---------------------------------------------------------------------------
// Windows (one per monitor)
// ---------------------------------------------------------------------------
function createWindowFor(display) {
  const area = display.workArea;

  const win = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const entry = { win, display, clickThrough: null };
  windows.set(display.id, entry);
  win.setIgnoreMouseEvents(true, { forward: true }); // start pass-through so the desktop is never blocked while loading
  entry.clickThrough = true;

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.setBounds(area); // re-apply after creation: fixes size on mixed-DPI monitors
    if (!isHidden) win.showInactive(); // a monitor plugged in during Quick-hide stays hidden until it ends
    sinkWindows();
    updateDrawFlag();
  });

  // DevTools only on the controller window, otherwise every monitor opens one
  if (!useDist && display.id === screen.getPrimaryDisplay().id) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  loadRenderer(win).catch((error) => console.error('Failed to load renderer:', error));

  // Hide instead of close ONLY when a tray icon exists to bring it back / quit.
  win.on('close', (event) => {
    if (!isQuitting && tray) {
      event.preventDefault();
      hideAllWindows();
    }
  });

  win.on('blur', endPeekIfFocusLeft);

  win.on('closed', () => {
    for (const [id, e] of windows) if (e.win === win) windows.delete(id);
  });

  return entry;
}

let syncTimer = null;
function syncDisplaysSoon() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncDisplays, 300); // monitors report several events when (un)plugged
}

function syncDisplays() {
  const displays = screen.getAllDisplays();
  // Windows can briefly report no monitors (lock screen, docking, remote desktop).
  // Keep what we have; tearing everything down would also quit the app.
  if (displays.length === 0) return;
  const ids = new Set(displays.map((d) => d.id));

  // create/resize first, then remove: there is always at least one window
  for (const display of displays) {
    const entry = windows.get(display.id);
    if (entry) {
      entry.display = display;
      if (!entry.win.isDestroyed()) entry.win.setBounds(display.workArea);
    } else {
      createWindowFor(display);
    }
  }
  for (const [id, entry] of [...windows]) {
    if (!ids.has(id)) {
      windows.delete(id);
      entry.win.destroy(); // monitor unplugged
    }
  }
  sendToAll(CH.DISPLAYS_CHANGED);
}

let screenListenersAdded = false;
function createWindows() {
  for (const display of screen.getAllDisplays()) {
    if (!windows.has(display.id)) createWindowFor(display);
  }
  startClickThrough();
  // createWindows() can run again (activate / peek with no windows): never stack listeners
  if (!screenListenersAdded) {
    screenListenersAdded = true;
    screen.on('display-added', syncDisplaysSoon);
    screen.on('display-removed', syncDisplaysSoon);
    screen.on('display-metrics-changed', syncDisplaysSoon);
  }
}

function hideAllWindows() {
  for (const win of allWindows()) win.hide();
  endDraw(false);
  updateDrawFlag();
}

function showWindow() {
  // Anything that explicitly brings the app back (tray, second launch, activate) ends Peek
  if (isHidden) {
    isHidden = false;
    sendToAll(CH.SET_PEEK_STATE, false);
    syncQuickHideIcons(false);
  }
  if (windows.size === 0) {
    createWindows();
    return;
  }
  for (const win of allWindows()) if (!win.isVisible()) win.show();
  const controller = controllerWindow();
  if (controller) controller.focus();
  updateDrawFlag();
}

// ---------------------------------------------------------------------------
// Quick-hide: every fence (and, if wanted, the Desktop icons) disappears; the wallpaper is left.
// Double-click empty Desktop space, the tray, or the page's menu toggles it.
// ---------------------------------------------------------------------------
let iconsHiddenByQuickHide = false;
let quickHideIconsWanted = false;
let quickHideIconsQueue = Promise.resolve();

// Icons follow the LATEST wish, so a fast double toggle can never leave them hidden
function syncQuickHideIcons(hidden) {
  quickHideIconsWanted = hidden;
  quickHideIconsQueue = quickHideIconsQueue
    .then(async () => {
      const settings = getSettings();
      const want = quickHideIconsWanted && settings.quickHideIcons !== false && !settings.hideDesktopIcons;
      if (want && !iconsHiddenByQuickHide) {
        const result = await desktopIcons.setHidden(true);
        if (result.success && result.changed) iconsHiddenByQuickHide = true;
      } else if (!want && iconsHiddenByQuickHide) {
        const result = await desktopIcons.setHidden(false);
        if (result.success) iconsHiddenByQuickHide = false;
      }
    })
    .catch(() => {});
}

function setQuickHidden(value) {
  if (value && isPeeking) setPeek(false);
  isHidden = value;
  syncQuickHideIcons(value);
  if (windows.size === 0) {
    if (!isHidden) createWindows();
    return;
  }

  for (const win of allWindows()) {
    win.setAlwaysOnTop(false); // never leave a window pinned above other apps
    if (isHidden) {
      win.hide();
    } else if (!win.isVisible()) {
      win.showInactive(); // back without stealing focus from the app you are using
    }
  }
  if (!isHidden) sinkWindows(); // back ON the Desktop, not over the apps
  sendToAll(CH.SET_PEEK_STATE, isHidden);
  if (isHidden) endDraw(false);
  updateDrawFlag();
}

function toggleQuickHide() {
  // Decide from what is actually on screen, so it also works after "Hide" (X button)
  const anyVisible = allWindows().some((win) => win.isVisible());
  setQuickHidden(anyVisible);
}

// ---------------------------------------------------------------------------
// Peek (Win + Space): the fences come up ABOVE the open windows over a dimmed screen, so Desktop
// files are reachable without minimizing anything. Esc, the hotkey again, a click on the dimmed
// part, opening an item or switching to another app ends it.
// ---------------------------------------------------------------------------
function setPeek(on) {
  if (on === isPeeking) return;
  if (on && windows.size === 0) createWindows();
  isPeeking = on;
  if (on) {
    if (isHidden) {
      isHidden = false;
      syncQuickHideIcons(false);
      sendToAll(CH.SET_PEEK_STATE, false);
    }
    for (const win of allWindows()) {
      win.setAlwaysOnTop(true, 'pop-up-menu');
      if (!win.isVisible()) win.showInactive();
      win.moveTop();
    }
    // keyboard focus where the mouse is, so Esc works there
    const entry = entryAt(screen.getCursorScreenPoint());
    const target = entry && !entry.win.isDestroyed() ? entry.win : controllerWindow();
    if (target) target.focus();
  } else {
    for (const win of allWindows()) win.setAlwaysOnTop(false);
    sinkWindows(); // back down onto the Desktop, below the apps
  }
  sendToAll('peek-changed', isPeeking);
  endDraw(false);
  updateDrawFlag();
}

function togglePeek() {
  setPeek(!isPeeking);
}

// Switching to another app ends Peek (focus moving between our own monitor windows does not)
function endPeekIfFocusLeft() {
  if (!isPeeking) return;
  setTimeout(() => {
    const focused = BrowserWindow.getFocusedWindow();
    if (!focused || !allWindows().includes(focused)) setPeek(false);
  }, 80);
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function trayAction(action) {
  showWindow();
  sendToController(CH.TRAY_ACTION, action);
}

// ---- Privacy mode: one switch for all monitors (tray, the page's menu); kept in settings.json -----
let trayMenu = null;

function syncTrayPrivacy(settings) {
  const item = trayMenu && trayMenu.getMenuItemById('privacy');
  if (item) item.checked = !!settings.privacyMode;
}

function setPrivacyMode(on) {
  try {
    const merged = { ...getSettings(), privacyMode: !!on };
    writeJson('settings.json', merged);
    sendToAll(CH.SETTINGS_CHANGED, merged);
    syncTrayPrivacy(merged);
  } catch (error) {
    console.error('Could not change privacy mode:', error);
  }
}

function createTray() {
  let icon = nativeImage.createFromPath(ICON_PATH);
  if (icon.isEmpty()) icon = nativeImage.createFromDataURL(FALLBACK_ICON);

  try {
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
  } catch (error) {
    console.error('Could not create tray:', error.message);
    tray = null;
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show/Hide Fences (double-click Desktop)', click: () => toggleQuickHide() },
    { label: 'Peek: fences above windows (Win+Space)', click: () => setPeek(true) },
    {
      id: 'privacy',
      label: 'Privacy mode (mask fence contents)',
      type: 'checkbox',
      checked: !!getSettings().privacyMode,
      click: (menuItem) => setPrivacyMode(menuItem.checked),
    },
    { label: 'New Fence', click: () => trayAction('new-fence') },
    { type: 'separator' },
    { label: 'Automation Rules', click: () => trayAction('automation') },
    { label: 'Scheduled Tasks', click: () => trayAction('scheduled') },
    { label: 'Settings', click: () => trayAction('settings') },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  trayMenu = contextMenu;
  tray.setToolTip('DeskFence - Desktop Organizer');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => toggleQuickHide());
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  // another DeskFence is already running
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    registerIpc();
    createTray();
    createWindows();
    applySettings(getSettings()).catch((error) => console.warn('Settings could not be applied:', error));
  });

  app.on('window-all-closed', () => {
    // With a tray icon the windows are only ever hidden; "no windows" (e.g. while monitors are
    // being re-detected) must not end the app. Quitting is the tray's Quit.
    if (isQuitting || !tray) {
      if (process.platform !== 'darwin') app.quit();
    }
  });

  app.on('activate', () => {
    if (windows.size === 0) createWindows();
    else showWindow();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    endDraw(false);
    updateDrawFlag(); // removes the flag file
    setFlagFile(QUICK_HIDE_FLAG_PATH, false);
    setFlagFile(PEEK_FLAG_PATH, false);
    try { fs.rmSync(HELPER_COMMAND_PATH, { force: true }); } catch (_) { /* gone */ }
    if (dragWatch) dragWatch.stop();
    for (const folderPath of [...watchers.keys()]) unwatchFolder(folderPath, true);
  });

  let restoringIcons = false;
  app.on('will-quit', (event) => {
    globalShortcut.unregisterAll();
    // Never leave the user's Desktop icons hidden after DeskFence has closed
    if ((iconsHiddenByUs || iconsHiddenByQuickHide) && !restoringIcons) {
      restoringIcons = true;
      event.preventDefault();
      desktopIcons
        .setHidden(false)
        .catch(() => {})
        .finally(() => {
          iconsHiddenByUs = false;
          iconsHiddenByQuickHide = false;
          app.quit();
        });
    }
  });
}
