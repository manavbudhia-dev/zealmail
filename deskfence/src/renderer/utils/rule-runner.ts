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

/** A file/folder appeared in a watched folder: find the first matching rule and move/copy it into its fence. */
export async function handleFolderEvent(data: FolderEvent): Promise<void> {
  if (data.event !== 'add' && data.event !== 'addDir') return;

  const filePath = data.path;
  const fileName = baseName(filePath);

  const rule = collectRules().find(
    (r) =>
      (r.watchPaths || []).some((p) => sameFolder(p, data.folderPath)) &&
      RuleEngine.matchesRule(filePath, fileName, data.size || 0, r, data.modified)
  );
  if (!rule) return;

  const target = useFenceStore.getState().fences.find((f) => f.id === rule.targetFenceId);
  if (!target) return;

  try {
    const folder = await getFenceFolder(target);
    if (!folder || isInsideFolder(filePath, folder)) return; // already there

    const { moved, failed } = await window.electronAPI.moveFiles(
      [filePath],
      folder,
      rule.action === 'copy' ? 'copy' : 'move'
    );
    if (failed.length > 0) {
      console.warn(`Rule "${rule.name}" could not handle ${fileName}: ${failed[0].error}`);
      return;
    }

    const store = useFenceStore.getState();
    if (target.portalPath) {
      await refreshPortalFence(target.id);
    } else {
      for (const m of moved) {
        // goes into the fence's visible (active) tab
        if (store.fences.find((f) => f.id === target.id)?.items.some((i) => i.path === m.to)) continue;
        store.addItemToFence(target.id, {
          id: newItemId(),
          name: baseName(m.to),
          path: m.to,
          type: data.event === 'addDir' ? 'folder' : 'file',
          position: { x: 0, y: 0 },
        });
      }
    }
    await store.saveFences();
  } catch (error) {
    console.warn(`Rule "${rule.name}" failed:`, error);
  }
}
