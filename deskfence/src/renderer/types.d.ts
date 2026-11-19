// Type definitions for window.electronAPI
import type { Fence } from '../shared/types';

export interface DisplayInfo {
  id: number;
  primary: boolean;
  label: string;
}

export interface WindowInfo {
  displayId: number; // the monitor this window is on
  isController: boolean; // the primary-monitor window runs rules + scheduled tasks
  primaryDisplayId: number;
  displays: DisplayInfo[];
}

export interface DesktopIconsResult {
  supported: boolean;
  success: boolean;
  hidden: boolean;
  changed?: boolean;
  error?: string;
}

declare global {
  interface Window {
    electronAPI: {
      // Fence operations
      getFences: () => Promise<Fence[]>;
      saveFences: (fences: Fence[], deleted?: string[], revived?: string[]) => Promise<{ success: boolean; fences?: Fence[]; deleted?: string[]; error?: string }>;

      // File operations
      getFileIcon: (filePath: string) => Promise<string | null>;
      openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
      getFilesInFolder: (folderPath: string) => Promise<any[]>;
      selectFolder: (defaultPath?: string) => Promise<string | null>;
      moveFiles: (
        paths: string[],
        destDir: string,
        mode?: 'move' | 'copy'
      ) => Promise<{
        moved: { from: string; to: string; unchanged?: boolean }[];
        failed: { path: string; error: string }[];
      }>;
      ensureFenceFolder: (name: string, id: string) => Promise<string>;
      getDesktopPath: () => Promise<string>;
      getKnownPath: (name: 'desktop' | 'downloads' | 'documents' | 'temp') => Promise<string>;
      showInFolder: (filePath: string) => Promise<boolean>;
      copyText: (text: string) => Promise<boolean>;
      runCleanup: (task: {
        targetPaths: string[];
        olderThanDays: number;
        action: 'delete' | 'archive' | 'move';
        destination?: string;
        dryRun?: boolean;
        extensions?: string[];
        taskId?: string;
      }) => Promise<{
        matched: { name: string; path: string; type: 'file' | 'folder'; size: number; modified: number }[];
        processed: number;
        failed: { path: string; error: string }[];
        busy?: boolean;
      }>;

      // Layout presets
      findShortcuts: (
        requests: { key: string; names: string[]; kind?: 'app' | 'folder' }[]
      ) => Promise<Record<string, { path: string; name: string; source: string; iconSource: string } | null>>;
      backupFences: () => Promise<string>;

      // Drop a folder on the Desktop
      beginItemDrag: () => void;
      endDragCapture: () => void;
      arePathsFolders: (paths: string[]) => Promise<boolean[]>;

      // Right-click + drag on the Desktop draws a fence (rect in this window's coordinates)
      onDrawPreview: (callback: (rect: DrawRect | null) => void) => () => void;
      onDrawFence: (callback: (rect: DrawRect) => void) => () => void;

      // Peek mode
      togglePeek: () => void;
      // Each subscription returns an unsubscribe function
      onPeekStateChange: (callback: (isPeekMode: boolean) => void) => () => void;
      onOpenSettings: (callback: () => void) => () => void;
      onTrayAction: (callback: (action: 'new-fence' | 'automation' | 'scheduled' | 'settings') => void) => () => void;

      // Window operations
      minimizeWindow: () => void;
      closeWindow: () => void;

      // Settings
      getSettings: () => Promise<any>;
      saveSettings: (settings: any) => Promise<{ success: boolean; desktopIcons?: DesktopIconsResult | null }>;
      onSettingsChanged: (callback: (settings: any) => void) => () => void;
      setDesktopIconsHidden: (hidden: boolean) => Promise<DesktopIconsResult>;

      // Monitors: one overlay window per monitor
      getWindowInfo: () => Promise<WindowInfo>;
      onFencesUpdated: (callback: (update: { fences: Fence[]; deleted: string[] }) => void) => () => void;
      onDisplaysChanged: (callback: () => void) => () => void;

      // File watching
      watchFolder: (folderPath: string) => Promise<{ success: boolean }>;
      unwatchFolder: (folderPath: string) => Promise<{ success: boolean }>;
      onFolderChanged: (callback: (data: any) => void) => () => void;
    };
  }
}

export interface DrawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export {};
