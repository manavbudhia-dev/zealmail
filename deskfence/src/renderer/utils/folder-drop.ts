import { useFenceStore } from '../store/fenceStore';
import { useDisplayStore } from '../store/displayStore';
import { defaultFenceStyle, currentTheme } from './theme';
import { filesToItems, cleanIpcError } from './portal';
import { watchForFence, baseName, isManagedItem, isInsideFolder, refreshPortalFence, describeFailures } from './fence-files';
import { allFenceItems } from './fence-tabs';
import type { Fence } from '../../shared/types';

export interface DroppedEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface FolderDropResult {
  created: string[]; // names of the new fences
  existing: string[]; // folders that already have a fence
  failed: string[]; // "name: reason"
}

const FENCE_WIDTH = 300;
const FENCE_HEIGHT = 400;

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** What is being dragged over the page: files from the OS, or one of our own fence items. */
export function dragKind(dataTransfer: DataTransfer | null | undefined): 'files' | 'item' | null {
  const types = dataTransfer ? Array.from(dataTransfer.types || []) : [];
  if (types.includes('Files')) return 'files';
  if (types.includes('application/json')) return 'item';
  return null;
}

/** True while the drag carries files/folders from the OS (not one of our own item drags). */
export function isFileDrag(dataTransfer: DataTransfer | null | undefined): boolean {
  return !!dataTransfer && Array.from(dataTransfer.types || []).includes('Files');
}

/**
 * Reads everything needed from a drop right away: DataTransfer is emptied after the first await.
 * file.type === '' is NOT a folder test (.md, .py have no MIME type), so ask the browser.
 */
export function readDroppedEntries(dataTransfer: DataTransfer): DroppedEntry[] {
  return Array.from(dataTransfer.files).map((file, index) => ({
    name: file.name,
    // Electron (<= v31) adds .path to dropped files; it is undefined in a plain browser
    path: (file as File & { path?: string }).path || '',
    isDirectory: dataTransfer.items?.[index]?.webkitGetAsEntry?.()?.isDirectory ?? false,
  }));
}

/**
 * Creates one folder-linked fence per dropped folder, the first one where it was dropped
 * (kept on screen), the next ones cascaded beside it.
 */
export async function createFencesFromFolders(folders: DroppedEntry[], at: { x: number; y: number }): Promise<FolderDropResult> {
  const result: FolderDropResult = { created: [], existing: [], failed: [] };
  const info = useDisplayStore.getState().info;

  for (const folder of folders) {
    const name = baseName(folder.path);
    const store = useFenceStore.getState();

    if (store.fences.some((f) => f.portalPath && norm(f.portalPath) === norm(folder.path))) {
      result.existing.push(name);
      continue;
    }

    try {
      // Throws "Folder not found" instead of creating an empty fence for a bad path
      const files = await window.electronAPI.getFilesInFolder(folder.path);
      const step = result.created.length * 30;
      const fence: Fence = {
        id: `fence-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        position: {
          x: Math.min(Math.max(0, at.x + step), Math.max(0, window.innerWidth - FENCE_WIDTH)),
          y: Math.min(Math.max(0, at.y + step), Math.max(0, window.innerHeight - FENCE_HEIGHT)),
        },
        size: { width: FENCE_WIDTH, height: FENCE_HEIGHT },
        items: filesToItems(files),
        style: defaultFenceStyle(currentTheme()),
        displayId: info?.displayId,
        gridSize: 80,
        portalPath: folder.path,
      };
      store.addFence(fence);
      try {
        await watchForFence(fence.id, folder.path); // live updates when the folder changes
      } catch (error) {
        console.warn(`Could not watch ${folder.path}:`, error);
      }
      result.created.push(name);
    } catch (error) {
      result.failed.push(`${name}: ${cleanIpcError(error, 'could not read the folder')}`);
    }
  }

  if (result.created.length > 0) await useFenceStore.getState().saveFences();
  return result;
}

/**
 * A fence item dropped on the bare Desktop: the real file goes back to the Desktop folder and
 * leaves the fence. Returns the message to show.
 */
export async function moveItemBackToDesktop(fenceId: string, itemId: string): Promise<string> {
  const store = useFenceStore.getState();
  const fence = store.fences.find((f) => f.id === fenceId);
  const item = fence ? allFenceItems(fence).find((i) => i.id === itemId) : undefined;
  if (!fence || !item) return '';

  const isRealFile = isManagedItem(fence, item) || (!!fence.portalPath && isInsideFolder(item.path, fence.portalPath));
  if (!isRealFile) {
    return `"${item.name}" is only a shortcut in this fence, so there is nothing to move. Use ✕ on it to remove it from the fence.`;
  }

  const desktop = await window.electronAPI.getDesktopPath();
  if (!desktop) return 'Could not find your Desktop folder.';

  const { failed } = await window.electronAPI.moveFiles([item.path], desktop);
  if (failed.length > 0) return `Could not move "${item.name}" to the Desktop:\n${describeFailures(failed)}`;

  if (fence.portalPath) {
    await refreshPortalFence(fenceId).catch(() => {}); // a linked fence mirrors its folder
  } else {
    // the item may sit in a tab that is not the visible one
    const latest = useFenceStore.getState().fences.find((f) => f.id === fenceId);
    if (latest) {
      useFenceStore.getState().updateFence(fenceId, {
        items: latest.items.filter((i) => i.id !== itemId),
        ...(latest.tabs ? { tabs: latest.tabs.map((t) => ({ ...t, items: t.items.filter((i) => i.id !== itemId) })) } : {}),
      });
    }
  }
  await useFenceStore.getState().saveFences();
  return `Moved "${item.name}" back to the Desktop.`;
}
