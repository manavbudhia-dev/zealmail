const { contextBridge, ipcRenderer } = require('electron');

// Subscribes to a main-process channel and returns an unsubscribe function,
// so React effects can clean up (prevents duplicate listeners in StrictMode / HMR).
function subscribe(channel, callback) {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// Channel names match IPC_CHANNELS in src/shared/types.ts
contextBridge.exposeInMainWorld('electronAPI', {
  // Fence operations
  getFences: () => ipcRenderer.invoke('get-fences'),
  saveFences: (fences, deleted, revived) => ipcRenderer.invoke('save-fences', fences, deleted || [], revived || []),

  // File operations
  getFileIcon: (filePath) => ipcRenderer.invoke('get-file-icon', filePath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  getFilesInFolder: (folderPath) => ipcRenderer.invoke('get-files-in-folder', folderPath),
  selectFolder: (defaultPath) => ipcRenderer.invoke('select-folder', defaultPath),
  moveFiles: (paths, destDir, mode) => ipcRenderer.invoke('move-files', paths, destDir, mode),
  ensureFenceFolder: (name, id) => ipcRenderer.invoke('ensure-fence-folder', name, id),
  getDesktopPath: () => ipcRenderer.invoke('get-desktop-path'),
  getKnownPath: (name) => ipcRenderer.invoke('get-known-path', name),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  runCleanup: (task) => ipcRenderer.invoke('run-cleanup', task),

  // Layout presets
  findShortcuts: (requests) => ipcRenderer.invoke('find-shortcuts', requests),
  backupFences: () => ipcRenderer.invoke('backup-fences'),

  // Drop a folder on the Desktop
  beginItemDrag: () => ipcRenderer.send('begin-item-drag'),
  endDragCapture: () => ipcRenderer.send('end-drag-capture'),
  arePathsFolders: (paths) => ipcRenderer.invoke('are-paths-folders', paths),

  // Right-click + drag on the Desktop draws a fence
  onDrawPreview: (callback) => subscribe('draw-preview', callback),
  onDrawFence: (callback) => subscribe('draw-fence', callback),

  // Peek mode
  togglePeek: () => ipcRenderer.send('toggle-peek'),
  onPeekStateChange: (callback) => subscribe('set-peek-state', callback),
  onOpenSettings: (callback) => subscribe('open-settings', callback),
  onTrayAction: (callback) => subscribe('tray-action', callback),

  // Window operations
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),

  // Monitors / multi-window
  getWindowInfo: () => ipcRenderer.invoke('get-window-info'),
  onFencesUpdated: (callback) => subscribe('fences-updated', callback),
  onDisplaysChanged: (callback) => subscribe('displays-changed', callback),
  onSettingsChanged: (callback) => subscribe('settings-changed', callback),
  setDesktopIconsHidden: (hidden) => ipcRenderer.invoke('set-desktop-icons-hidden', hidden),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // File watching
  watchFolder: (folderPath) => ipcRenderer.invoke('watch-folder', folderPath),
  unwatchFolder: (folderPath) => ipcRenderer.invoke('unwatch-folder', folderPath),
  onFolderChanged: (callback) => subscribe('folder-changed', callback),
});
