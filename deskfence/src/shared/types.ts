// Shared TypeScript types and interfaces

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface FenceStyle {
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  opacity: number;
  labelColor: string;
  labelSize: number;
  borderRadius: number;
  iconSize?: 'small' | 'medium' | 'large' | 'extra-large'; // For accessibility
  iconPx?: number; // Exact size of the item icons in px (default 32)
  itemLabelSize?: number; // Font size of the item names in px (default 12)
  columns?: number; // Fixed number of item columns (default: as many as fit)
  compactHeader?: boolean; // Folder glyph + title only; the header buttons show on hover
}

export interface FenceItem {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder' | 'shortcut' | 'app';
  icon?: string; // Base64 or path
  position: Position;
  gridPosition?: { row: number; col: number };
}

export interface FenceTab {
  id: string;
  name: string;
  items: FenceItem[];
}

export interface RuleCondition {
  type: 'extension' | 'name' | 'size' | 'date' | 'path';
  operator: 'equals' | 'contains' | 'startsWith' | 'endsWith' | 'greaterThan' | 'lessThan' | 'matches';
  value: string | number;
}

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: RuleCondition[];
  action: 'move' | 'copy' | 'organize';
  targetFenceId: string;
  schedule?: string; // Cron expression
  watchPaths?: string[];
}

export interface Fence {
  id: string;
  name: string;
  position: Position;
  size: Size;
  items: FenceItem[];
  style: FenceStyle;
  portalPath?: string; // For folder portals
  collapsed?: boolean; // Rolled up to just its title bar
  autoRollup?: boolean; // Rolls up to its title bar when the mouse leaves, drops down again on hover
  updatedAt?: number; // Last change (ms). The newer copy wins when monitor windows merge
  displayId?: number; // Monitor this fence lives on (primary monitor when missing or unplugged)
  storagePath?: string; // Real folder on disk that holds this fence's files (created on first drop)
  tabs?: FenceTab[];
  rules?: AutomationRule[];
  activeTabId?: string;
  isLocked?: boolean;
  gridSize?: number; // Icon spacing
  tags?: string[]; // Client, project, or category tags
  dueDate?: number; // Timestamp for deadline-based organization
  category?: string; // Client name, project name, research topic
}

export interface AppConfig {
  fences: Fence[];
  globalHotkey: string;
  peekMode: boolean;
  autoStart: boolean;
  theme: 'light' | 'dark' | 'auto';
  hideDesktopIcons?: boolean;
  dropFolderToFence?: boolean;
  lastModified: number;
}

export interface DragItem {
  id: string;
  type: string;
  fenceId: string;
  item: FenceItem;
}

// IPC Channel names for Electron communication
export const IPC_CHANNELS = {
  // Fence operations
  GET_FENCES: 'get-fences',
  SAVE_FENCES: 'save-fences',
  CREATE_FENCE: 'create-fence',
  UPDATE_FENCE: 'update-fence',
  DELETE_FENCE: 'delete-fence',

  // File operations
  GET_FILE_ICON: 'get-file-icon',
  OPEN_FILE: 'open-file',
  GET_FILES_IN_FOLDER: 'get-files-in-folder',

  // Peek mode
  TOGGLE_PEEK: 'toggle-peek',
  SET_PEEK_STATE: 'set-peek-state',

  // Window operations
  MINIMIZE_WINDOW: 'minimize-window',
  CLOSE_WINDOW: 'close-window',
  SET_ALWAYS_ON_TOP: 'set-always-on-top',

  // Settings
  GET_SETTINGS: 'get-settings',
  SAVE_SETTINGS: 'save-settings',

  // File watching
  WATCH_FOLDER: 'watch-folder',
  UNWATCH_FOLDER: 'unwatch-folder',
  FOLDER_CHANGED: 'folder-changed',

  // Automation
  RUN_RULE: 'run-rule',
  TEST_RULE: 'test-rule',
} as const;

export type IPCChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
