import type { Fence, FenceItem, FenceStyle } from '../../shared/types';
import { useFenceStore } from '../store/fenceStore';
import { useDisplayStore, fenceBelongsHere } from '../store/displayStore';
import { allFenceItems } from './fence-tabs';
import { isManagedItem, unwatchForFence } from './fence-files';

/**
 * The "Focus" desktop: ten dark, rounded fences in two columns (six on the left, four on the right) with the
 * wallpaper left free in the middle, each showing a folder glyph + title and a row of four big icons.
 *
 * Geometry is stored in the pixel space of the design (a 1672 x 893 desktop work area) and scaled to the
 * real screen, so it looks the same on 1366, 1920 or 2560 wide monitors.
 */
export const DESIGN = { width: 1672, height: 893 };
const LEFT = { x: 12, w: 396 };
const RIGHT = { x: 1339, w: 321 };

type Special = 'thispc' | 'recycle' | 'control';

interface PresetItem {
  label: string;
  names?: string[]; // what to look for in the user's Desktop / Start Menu / Documents
  kind?: 'app' | 'folder';
  known?: 'downloads';
  special?: Special;
}

interface PresetFence {
  name: string;
  column: typeof LEFT;
  y: number;
  h: number;
  items: PresetItem[];
}

const app = (label: string, ...names: string[]): PresetItem => ({ label, names: names.length ? names : [label], kind: 'app' });
const folder = (label: string, ...names: string[]): PresetItem => ({ label, names: names.length ? names : [label], kind: 'folder' });

export const FOCUS_PRESET: PresetFence[] = [
  {
    name: 'System & Tools', column: LEFT, y: 13, h: 127,
    items: [
      { label: 'This PC', special: 'thispc' },
      { label: 'Recycle Bin', special: 'recycle' },
      { label: 'Control Panel', special: 'control' },
    ],
  },
  {
    name: 'Work & Projects', column: LEFT, y: 152, h: 140,
    items: [
      app('Chrome', 'google chrome', 'chrome'),
      app('Brave', 'brave'),
      app('Visual Studio Code', 'visual studio code', 'vs code', 'vscode'),
      app('Docker Desktop', 'docker desktop', 'docker'),
    ],
  },
  {
    name: 'Communication', column: LEFT, y: 304, h: 131,
    items: [
      app('Telegram'),
      app('Outlook', 'outlook', 'outlook classic', 'new outlook'),
      app('Zoom', 'zoom workplace', 'zoom'),
      app('WhatsApp'),
    ],
  },
  {
    name: 'Creative & Design', column: LEFT, y: 447, h: 139,
    items: [
      app('Adobe Acrobat', 'adobe acrobat', 'acrobat'),
      app('Adobe Express', 'adobe express', 'express'),
      app('Screenshot', 'screenshot', 'snipping tool', 'snip'),
      app('OBS Studio', 'obs studio', 'obs'),
    ],
  },
  {
    name: 'Productivity & Utilities', column: LEFT, y: 598, h: 130,
    items: [
      app('Notion'),
      app('Calendar', 'google calendar', 'calendar'),
      app('Everything'),
      app('Snipboard Pro', 'snipboard pro', 'snipboard'),
    ],
  },
  {
    name: 'Files & Documents', column: LEFT, y: 740, h: 129,
    items: [
      folder('Project Files', 'project files'),
      folder('Work Docs', 'work docs', 'work documents'),
      { label: 'Downloads', known: 'downloads', kind: 'folder' },
      folder('Outputs', 'outputs'),
    ],
  },
  {
    name: 'Learning & Reference', column: RIGHT, y: 13, h: 149,
    items: [
      app('Flash Calculation'),
      app('Keychron'),
      app('OpenCode', 'opencode', 'open code'),
      app('NVIDIA App'),
    ],
  },
  {
    name: 'Media & Entertainment', column: RIGHT, y: 174, h: 132,
    items: [
      app('YouTube'),
      app('UltraViewer'),
      app('VLC', 'vlc media player', 'vlc'),
      app('Photos'),
    ],
  },
  {
    name: 'Utilities', column: RIGHT, y: 320, h: 127,
    items: [app('FXSound'), app('WinSCP'), app('Hue Sync'), app('Antigravity')],
  },
  {
    name: 'Personal', column: RIGHT, y: 461, h: 139,
    items: [folder('School Materials'), folder('Finance'), folder('Health'), folder('Misc')],
  },
];

// ---- icons for the three Windows system places (they are not files, so Windows cannot give us an icon) --------
const svg = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${body}</svg>`)}`;

const SPECIAL: Record<Special, { path: string; icon: string }> = {
  thispc: {
    path: 'shell:MyComputerFolder',
    icon: svg(
      `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#46b8ff"/><stop offset="1" stop-color="#0b66cc"/></linearGradient></defs>` +
        `<rect x="4" y="6" width="40" height="27" rx="3" fill="#cdd7e3"/><rect x="6.5" y="8.5" width="35" height="22" rx="1.5" fill="url(#s)"/>` +
        `<rect x="20" y="33" width="8" height="5" fill="#97a5b8"/><rect x="12" y="38" width="24" height="3.6" rx="1.8" fill="#b8c3d1"/>`
    ),
  },
  recycle: {
    path: 'shell:RecycleBinFolder',
    icon: svg(
      `<path d="M10.5 15h27l-2.3 27a2.2 2.2 0 0 1-2.2 2H15a2.2 2.2 0 0 1-2.2-2z" fill="#dcebf8" fill-opacity=".9" stroke="#9db8d4" stroke-width="1.5"/>` +
        `<rect x="7.5" y="10" width="33" height="5.5" rx="2.4" fill="#c4d5e9" stroke="#9db8d4" stroke-width="1.2"/><rect x="18" y="5.5" width="12" height="4.5" rx="1.8" fill="#c4d5e9" stroke="#9db8d4" stroke-width="1.2"/>` +
        `<path d="M24 21.5l5 8.5h-3.6v5h-2.8v-5H19z" fill="#2f8fe8"/><path d="M17.5 33.5a7 7 0 0 0 13 0" fill="none" stroke="#2f8fe8" stroke-width="2.2" stroke-linecap="round"/>`
    ),
  },
  control: {
    path: 'shell:ControlPanelFolder',
    icon: svg(
      `<rect x="5" y="7" width="38" height="34" rx="3.5" fill="#eef3f9" stroke="#8ea6c4" stroke-width="1.5"/><rect x="5" y="7" width="38" height="8" rx="3.5" fill="#3d8fe3"/>` +
        `<rect x="11" y="21" width="26" height="3" rx="1.5" fill="#b3c5db"/><rect x="11" y="28" width="26" height="3" rx="1.5" fill="#b3c5db"/><rect x="11" y="35" width="26" height="3" rx="1.5" fill="#b3c5db"/>` +
        `<circle cx="29" cy="22.5" r="3.6" fill="#f0a22b"/><circle cx="18" cy="29.5" r="3.6" fill="#3d8fe3"/><circle cx="26" cy="36.5" r="3.6" fill="#47b36b"/>`
    ),
  },
};

export function focusStyle(scale: number): FenceStyle {
  return {
    backgroundColor: 'rgba(16, 25, 46, 0.82)',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderWidth: 1,
    opacity: 1,
    labelColor: '#ffffff',
    labelSize: Math.round(16 * scale),
    borderRadius: 14,
    iconPx: Math.round(46 * scale),
    itemLabelSize: Math.round(12.5 * scale * 2) / 2,
    columns: 4,
    compactHeader: true,
  };
}

/** Position and size of a preset fence for a screen of this size. */
export function fenceBounds(def: PresetFence, screenW: number, screenH: number) {
  const sx = screenW / DESIGN.width;
  const sy = screenH / DESIGN.height;
  return {
    position: { x: Math.round(def.column.x * sx), y: Math.round(def.y * sy) },
    size: { width: Math.round(def.column.w * sx), height: Math.round(def.h * sy) },
  };
}

export interface LayoutResult {
  fences: number;
  items: number;
  missing: string[]; // "Finance (in Personal)" - nothing like it was found on this PC
  kept: string[]; // old fences that could not be removed (their files could not be moved back)
  backup: string;
}

/** Fences on this monitor, i.e. what the layout replaces. */
export function fencesOnThisMonitor(): Fence[] {
  const info = useDisplayStore.getState().info;
  return useFenceStore.getState().fences.filter((f) => !info || fenceBelongsHere(f, info));
}

/**
 * Replaces the fences on this monitor with the Focus layout, filled with the user's own shortcuts.
 * Files that were moved INTO an old fence go back to the Desktop first (same as deleting a fence);
 * a fence whose files cannot be moved back is left alone.
 */
export async function applyFocusLayout(): Promise<LayoutResult> {
  const result: LayoutResult = { fences: 0, items: 0, missing: [], kept: [], backup: '' };
  const info = useDisplayStore.getState().info;
  result.backup = (await window.electronAPI.backupFences().catch(() => '')) || '';

  // 1. clear this monitor
  for (const old of fencesOnThisMonitor()) {
    const managed = allFenceItems(old).filter((item) => isManagedItem(old, item));
    if (managed.length > 0) {
      const desktop = await window.electronAPI.getDesktopPath();
      const { moved, failed } = desktop
        ? await window.electronAPI.moveFiles(managed.map((i) => i.path), desktop)
        : { moved: [], failed: managed.map((i) => ({ path: i.path, error: 'No Desktop folder' })) };
      if (failed.length > 0) {
        // keep this fence, minus the files that did make it back
        const gone = new Set(moved.map((m) => m.from));
        const latest = useFenceStore.getState().fences.find((f) => f.id === old.id);
        if (latest) {
          useFenceStore.getState().updateFence(old.id, {
            items: latest.items.filter((i) => !gone.has(i.path)),
            ...(latest.tabs ? { tabs: latest.tabs.map((t) => ({ ...t, items: t.items.filter((i) => !gone.has(i.path)) })) } : {}),
          });
        }
        result.kept.push(old.name);
        continue;
      }
    }
    unwatchForFence(old.id).catch(() => {}); // a linked fence's folder watch goes with it
    useFenceStore.getState().deleteFence(old.id);
  }

  // 2. find the user's shortcuts and folders
  const requests = FOCUS_PRESET.flatMap((fence, f) =>
    fence.items.filter((i) => i.names).map((i, n) => ({ key: `${f}:${i.label}:${n}`, names: i.names!, kind: i.kind })),
  );
  const found = await window.electronAPI.findShortcuts(requests).catch(() => ({}) as Awaited<ReturnType<typeof window.electronAPI.findShortcuts>>);
  const downloads = await window.electronAPI.getKnownPath('downloads').catch(() => '');

  interface Resolved { label: string; path: string; iconSource: string; type: FenceItem['type']; icon?: string }
  const resolved = FOCUS_PRESET.map((fence, f) =>
    fence.items.map((item): Resolved | null => {
      if (item.special) {
        const s = SPECIAL[item.special];
        return { label: item.label, path: s.path, iconSource: '', type: 'shortcut', icon: s.icon };
      }
      if (item.known === 'downloads') {
        return downloads ? { label: item.label, path: downloads, iconSource: downloads, type: 'folder' } : null;
      }
      const index = fence.items.filter((i) => i.names).indexOf(item);
      const match = found[`${f}:${item.label}:${index}`];
      return match ? { label: item.label, path: match.path, iconSource: match.iconSource || match.path, type: item.kind === 'folder' ? 'folder' : 'app' } : null;
    }),
  );

  // 3. real Windows icons (from the program itself, so no little shortcut arrow)
  const iconBySource = new Map<string, string | null>();
  await Promise.all(
    [...new Set(resolved.flat().filter((r): r is Resolved => !!r && !!r.iconSource).map((r) => r.iconSource))].map(async (source) => {
      iconBySource.set(source, await window.electronAPI.getFileIcon(source).catch(() => null));
    }),
  );

  // 4. build the fences
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;
  const style = focusStyle(Math.min(screenW / DESIGN.width, screenH / DESIGN.height));
  const stamp = Date.now();
  const store = useFenceStore.getState();

  FOCUS_PRESET.forEach((def, f) => {
    const items: FenceItem[] = [];
    resolved[f].forEach((r, n) => {
      if (!r) {
        result.missing.push(`${def.items[n].label} (in ${def.name})`);
        return;
      }
      items.push({
        id: `item-${stamp}-${f}-${n}`,
        name: r.label,
        path: r.path,
        type: r.type,
        icon: r.icon || iconBySource.get(r.iconSource) || undefined,
        position: { x: 0, y: 0 },
      });
    });
    const { position, size } = fenceBounds(def, screenW, screenH);
    store.addFence({
      id: `fence-${stamp}-${f}`,
      name: def.name,
      position,
      size,
      items,
      style: { ...style },
      displayId: info?.displayId,
      gridSize: 80,
    });
    result.fences += 1;
    result.items += items.length;
  });

  await useFenceStore.getState().saveFences();
  return result;
}
