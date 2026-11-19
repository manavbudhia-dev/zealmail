import { useFenceStore } from '../store/fenceStore';
import { filesToItems } from './portal';
import { allFenceItems } from './fence-tabs';
import type { Fence, FenceItem } from '../../shared/types';

/** Case/slash-insensitive "is child inside parent folder" for Windows and POSIX paths. */
export function isInsideFolder(child: string, parent: string): boolean {
  if (!child || !parent) return false;
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return norm(child).startsWith(norm(parent) + '/');
}

export function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

export function newItemId(): string {
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The real folder that holds a fence's files: its linked folder, or its own managed folder. */
export async function getFenceFolder(fence: Fence): Promise<string> {
  if (fence.portalPath) return fence.portalPath;
  if (fence.storagePath) return fence.storagePath;

  const folder = await window.electronAPI.ensureFenceFolder(fence.name, fence.id);
  if (folder) {
    useFenceStore.getState().updateFence(fence.id, { storagePath: folder });
  }
  return folder;
}

// Folder listings can finish out of order (a slow read started first, a fast one second).
// Only a result newer than the last one applied may change the fence, otherwise an older
// listing would overwrite a newer one.
const refreshStarted = new Map<string, number>();
const refreshApplied = new Map<string, number>();

/** Re-reads a folder-linked fence from disk. */
export async function refreshPortalFence(fenceId: string): Promise<void> {
  const first = useFenceStore.getState().fences.find((f) => f.id === fenceId);
  if (!first?.portalPath) return;

  const ticket = (refreshStarted.get(fenceId) || 0) + 1;
  refreshStarted.set(fenceId, ticket);

  const files = await window.electronAPI.getFilesInFolder(first.portalPath);
  if (ticket <= (refreshApplied.get(fenceId) || 0)) return; // a newer listing was already applied
  refreshApplied.set(fenceId, ticket);

  // read the fence AFTER the await, it may have changed while we were waiting
  const store = useFenceStore.getState();
  const current = store.fences.find((f) => f.id === fenceId);
  if (!current || current.portalPath !== first.portalPath) return;
  store.updateFence(fenceId, { items: filesToItems(files, current.items) });
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/**
 * Brings fences that own a folder (Documents\DeskFence\...) back in line with that folder:
 *  - files that are in the folder but in no tab (e.g. moved in right before a crash) are added
 *  - items whose file has disappeared are dropped
 * A folder that cannot be read is left alone, and an empty listing never wipes a fence.
 * Returns true when something changed.
 */
export async function reconcileManagedFences(): Promise<boolean> {
  let changed = false;
  for (const start of useFenceStore.getState().fences) {
    if (start.portalPath || !start.storagePath) continue;

    let files: { name: string; path: string; type: 'file' | 'folder' }[];
    try {
      files = await window.electronAPI.getFilesInFolder(start.storagePath);
    } catch {
      continue; // offline / missing: touch nothing
    }

    const store = useFenceStore.getState();
    const fence = store.fences.find((f) => f.id === start.id);
    if (!fence) continue;

    const onDisk = new Set(files.map((f) => norm(f.path)));
    const inside = (item: FenceItem) => !!fence.storagePath && norm(item.path).startsWith(norm(fence.storagePath) + '/');
    const managedCount = allFenceItems(fence).filter(inside).length;
    const keep = (item: FenceItem) => !inside(item) || files.length === 0 || onDisk.has(norm(item.path));

    const items = fence.items.filter(keep);
    const tabs = fence.tabs?.map((t) => (t.id === fence.activeTabId ? t : { ...t, items: t.items.filter(keep) }));

    const known = new Set([...items, ...(tabs ? tabs.flatMap((t) => t.items) : [])].map((i) => norm(i.path)));
    const orphans = files.filter((f) => !known.has(norm(f.path)));
    const added: FenceItem[] = orphans.map((f) => ({
      id: newItemId(),
      name: f.name,
      path: f.path,
      type: f.type,
      position: { x: 0, y: 0 },
    }));

    const removedCount = managedCount - [...items, ...(tabs ? tabs.flatMap((t) => t.items) : [])].filter(inside).length;
    if (added.length === 0 && removedCount === 0) continue;

    store.updateFence(fence.id, { items: [...items, ...added], ...(tabs ? { tabs } : {}) });
    changed = true;
  }
  return changed;
}

/** True when the item is a real file/folder inside this fence's own managed folder. */
export function isManagedItem(fence: Fence, item: FenceItem): boolean {
  return !!fence.storagePath && !fence.portalPath && isInsideFolder(item.path, fence.storagePath);
}

export function describeFailures(failed: { path: string; error: string }[]): string {
  return failed.map((f) => `• ${baseName(f.path)}: ${f.error}`).join('\n');
}

const iconCache = new Map<string, Promise<string | null>>();

/** Real Windows icon for a path (cached); null when unavailable so the emoji fallback is shown. */
export function loadFileIcon(filePath: string): Promise<string | null> {
  let pending = iconCache.get(filePath);
  if (!pending) {
    pending = window.electronAPI.getFileIcon(filePath).catch(() => null);
    iconCache.set(filePath, pending);
  }
  return pending;
}

// ---- folder watches, held per fence --------------------------------------------------------
// The main process counts watchers per folder, so each fence must release exactly what IT took:
// releasing a watch this fence never held would silently stop another fence's/rule's watch.
const fenceWatches = new Map<string, string>(); // fenceId -> folder this window watches for it

// Watch/unwatch calls for one fence run strictly one after another. Without this, two overlapping
// watchForFence calls (startup + folder drop / portal dialog) both saw "nothing held", both took a
// watch and only one was recorded, so the folder could never be released; and an unwatch that ran
// while a watch was still in flight released nothing, leaving a deleted fence's folder watched.
const fenceWatchQueue = new Map<string, Promise<void>>();
function serialForFence(fenceId: string, task: () => Promise<void>): Promise<void> {
  const previous = fenceWatchQueue.get(fenceId) || Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => {});
  fenceWatchQueue.set(fenceId, tail);
  tail.then(() => {
    if (fenceWatchQueue.get(fenceId) === tail) fenceWatchQueue.delete(fenceId);
  });
  return run;
}

export function unwatchForFence(fenceId: string): Promise<void> {
  return serialForFence(fenceId, async () => {
    const held = fenceWatches.get(fenceId);
    if (!held) return;
    fenceWatches.delete(fenceId);
    await window.electronAPI.unwatchFolder(held);
  });
}

/** Watches `folder` on behalf of a fence (switching folders releases the old one). Idempotent. */
export function watchForFence(fenceId: string, folder: string): Promise<void> {
  return serialForFence(fenceId, async () => {
    const held = fenceWatches.get(fenceId);
    if (held === folder) return;
    await window.electronAPI.watchFolder(folder); // throws if the folder is missing: nothing recorded
    fenceWatches.set(fenceId, folder);
    if (held) await window.electronAPI.unwatchFolder(held);
  });
}
