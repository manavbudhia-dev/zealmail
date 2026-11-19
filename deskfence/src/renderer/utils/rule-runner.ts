import { useFenceStore } from '../store/fenceStore';
import { useAutomationStore } from '../store/automationStore';
import { RuleEngine } from './rule-engine';
import { getFenceFolder, refreshPortalFence, isInsideFolder, baseName, newItemId } from './fence-files';
import type { AutomationRule } from '../../shared/types';

/**
 * Per-fence rules (stored on the fence, in fences.json) come first, then the global rules
 * from the Automation panel. A per-fence rule always targets the fence it belongs to.
 */
export function collectRules(): AutomationRule[] {
  const perFence = useFenceStore
    .getState()
    .fences.flatMap((fence) => (fence.rules || []).map((rule) => ({ ...rule, targetFenceId: fence.id })));
  return [...perFence, ...useAutomationStore.getState().rules];
}

export function allWatchPaths(): string[] {
  const paths = new Set<string>();
  for (const rule of collectRules()) for (const p of rule.watchPaths || []) paths.add(p);
  return [...paths];
}

const sameFolder = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();

export interface FolderEvent {
  event: string;
  path: string;
  size?: number;
  modified?: number;
  folderPath: string;
}

// Windows' own housekeeping files on the Desktop: never sorted
const SYSTEM_FILES = new Set(['desktop.ini', 'thumbs.db']);

/**
 * A file/folder appeared in a watched folder: find the first matching rule and move/copy it into its
 * fence. Returns true when it was put into a fence. `save: false` lets a batch save once at the end.
 */
export async function handleFolderEvent(data: FolderEvent, options: { save?: boolean } = {}): Promise<boolean> {
  if (data.event !== 'add' && data.event !== 'addDir') return false;

  const filePath = data.path;
  const fileName = baseName(filePath);
  if (SYSTEM_FILES.has(fileName.toLowerCase())) return false;
  const isDirectory = data.event === 'addDir';

  const rule = collectRules().find(
    (r) =>
      (r.watchPaths || []).some((p) => sameFolder(p, data.folderPath)) &&
      RuleEngine.matchesRule(filePath, fileName, data.size || 0, r, data.modified, isDirectory)
  );
  if (!rule) return false;

  const target = useFenceStore.getState().fences.find((f) => f.id === rule.targetFenceId);
  if (!target) return false;

  try {
    const folder = await getFenceFolder(target);
    if (!folder || isInsideFolder(filePath, folder) || sameFolder(filePath, folder)) return false; // already there

    const { moved, failed } = await window.electronAPI.moveFiles(
      [filePath],
      folder,
      rule.action === 'copy' ? 'copy' : 'move'
    );
    if (failed.length > 0) {
      console.warn(`Rule "${rule.name}" could not handle ${fileName}: ${failed[0].error}`);
      return false;
    }

    if (target.portalPath) {
      await refreshPortalFence(target.id);
    } else {
      for (const m of moved) {
        // goes into the fence's visible (active) tab; read the store fresh, it changes between moves
        const current = useFenceStore.getState().fences.find((f) => f.id === target.id);
        if (current?.items.some((i) => i.path === m.to)) continue;
        useFenceStore.getState().addItemToFence(target.id, {
          id: newItemId(),
          name: baseName(m.to),
          path: m.to,
          type: isDirectory ? 'folder' : 'file',
          position: { x: 0, y: 0 },
        });
      }
    }
    if (options.save !== false) await useFenceStore.getState().saveFences();
    return moved.length > 0;
  } catch (error) {
    console.warn(`Rule "${rule.name}" failed:`, error);
    return false;
  }
}

/** What the rules would do to the items ALREADY in their watched folders (nothing is moved). */
export async function previewExistingFiles(onlyRules?: AutomationRule[]): Promise<{ path: string; fenceId: string }[]> {
  const rules = collectRules();
  const folders = new Set<string>();
  for (const r of onlyRules || rules) for (const p of r.watchPaths || []) folders.add(p);

  const planned: { path: string; fenceId: string }[] = [];
  for (const folder of folders) {
    let files: { name: string; path: string; type: 'file' | 'folder'; size?: number; modified?: number }[];
    try {
      files = await window.electronAPI.getFilesInFolder(folder);
    } catch {
      continue; // missing folder
    }
    for (const file of files) {
      if (SYSTEM_FILES.has(file.name.toLowerCase())) continue;
      const isDirectory = file.type === 'folder';
      // the FIRST matching rule decides, exactly like for new files
      const rule = rules.find(
        (r) =>
          (r.watchPaths || []).some((p) => sameFolder(p, folder)) &&
          RuleEngine.matchesRule(file.path, file.name, file.size || 0, r, file.modified, isDirectory)
      );
      if (!rule || (onlyRules && !onlyRules.some((o) => o.id === rule.id && o.targetFenceId === rule.targetFenceId))) continue;
      if (!useFenceStore.getState().fences.some((f) => f.id === rule.targetFenceId)) continue;
      planned.push({ path: file.path, fenceId: rule.targetFenceId });
    }
  }
  return planned;
}

/**
 * Applies the rules to the items already sitting in their watched folders (e.g. the Desktop).
 * New files are handled as they arrive; this is the "sort what is there now" button.
 */
export async function sortExistingFiles(onlyRules?: AutomationRule[]): Promise<{ moved: number; checked: number }> {
  const rules = collectRules();
  let moved = 0;
  let checked = 0;
  const folders = new Set<string>();
  for (const r of onlyRules || rules) for (const p of r.watchPaths || []) folders.add(p);

  for (const folder of folders) {
    let files: { name: string; path: string; type: 'file' | 'folder'; size?: number; modified?: number }[];
    try {
      files = await window.electronAPI.getFilesInFolder(folder);
    } catch {
      continue;
    }
    for (const file of files) {
      checked++;
      if (onlyRules) {
        // only items whose deciding rule is one of these
        const rule = rules.find(
          (r) =>
            (r.watchPaths || []).some((p) => sameFolder(p, folder)) &&
            RuleEngine.matchesRule(file.path, file.name, file.size || 0, r, file.modified, file.type === 'folder')
        );
        if (!rule || !onlyRules.some((o) => o.id === rule.id && o.targetFenceId === rule.targetFenceId)) continue;
      }
      const done = await handleFolderEvent(
        { event: file.type === 'folder' ? 'addDir' : 'add', path: file.path, size: file.size, modified: file.modified, folderPath: folder },
        { save: false }
      );
      if (done) moved++;
    }
  }
  if (moved > 0) await useFenceStore.getState().saveFences();
  return { moved, checked };
}
