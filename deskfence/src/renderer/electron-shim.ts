import type { Fence } from '../shared/types';

/**
 * Lets the same UI run in a plain browser (npm run dev:renderer).
 * Fences/settings go to localStorage; features that need the desktop app
 * degrade gracefully instead of throwing "undefined is not a function".
 * In the Electron app the real window.electronAPI from preload.js is used.
 */
const FENCES_KEY = 'deskfence-fences';
const SETTINGS_KEY = 'deskfence-settings';

const DEFAULT_SETTINGS = {
  globalHotkey: 'CommandOrControl+Space',
  autoStart: false,
  theme: 'auto' as 'light' | 'dark' | 'auto',
  hideDesktopIcons: false,
  dropFolderToFence: true,
  drawToCreate: true,
  privacyMode: false,
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): { success: boolean } {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return { success: true };
  } catch {
    return { success: false };
  }
}

const noSubscription = () => () => {};

export function installBrowserShim(): void {
  if (typeof window === 'undefined' || window.electronAPI) return;

  window.electronAPI = {
    getFences: async () => readJson<Fence[]>(FENCES_KEY, []),
    saveFences: async (fences, deleted = []) => {
      const result = writeJson(FENCES_KEY, fences.filter((f) => !deleted.includes(f.id)));
      return { ...result, fences };
    },

    getFileIcon: async () => null,
    openFile: async (filePath) => {
      console.info('[browser mode] cannot open files, use the desktop app:', filePath);
      return { success: false };
    },
    getFilesInFolder: async () => {
      throw new Error('Reading folders needs the desktop app (npm start / npm run dev).');
    },
    selectFolder: async (defaultPath) => window.prompt('Enter folder path:', defaultPath || '') || null,

    // Browser mode cannot touch the file system: dropped files stay as references
    moveFiles: async (paths) => ({
      moved: [],
      failed: paths.map((path) => ({ path, error: 'Moving files needs the desktop app' })),
    }),
    ensureFenceFolder: async () => '',
    getDesktopPath: async () => '',
    getKnownPath: async () => '',
    showInFolder: async () => false,
    copyText: async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    },
    runCleanup: async () => ({ matched: [], processed: 0, failed: [{ path: '', error: 'Cleanup needs the desktop app' }] }),

    findShortcuts: async () => ({}),
    backupFences: async () => '',
    beginItemDrag: () => {},
    endDragCapture: () => {},
    arePathsFolders: async (paths) => paths.map(() => false),
    onDrawPreview: noSubscription,
    onDrawFence: noSubscription,

    togglePeek: () => {},
    onPeekStateChange: noSubscription,
    onOpenSettings: noSubscription,
    onTrayAction: noSubscription,

    minimizeWindow: () => {},
    closeWindow: () => {},

    getWindowInfo: async () => ({
      displayId: 1,
      isController: true,
      primaryDisplayId: 1,
      displays: [{ id: 1, primary: true, label: 'Monitor 1 (main)' }],
    }),
    onFencesUpdated: noSubscription,
    onDisplaysChanged: noSubscription,
    onSettingsChanged: noSubscription,
    setDesktopIconsHidden: async () => ({
      supported: false,
      success: false,
      hidden: false,
      error: 'Hiding Desktop icons needs the desktop app on Windows',
    }),

    getSettings: async () => ({ ...DEFAULT_SETTINGS, ...readJson(SETTINGS_KEY, {}) }),
    saveSettings: async (settings) => writeJson(SETTINGS_KEY, settings),

    watchFolder: async () => ({ success: false }),
    unwatchFolder: async () => ({ success: true }),
    onFolderChanged: noSubscription,
  };
}
