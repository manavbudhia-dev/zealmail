import { useFenceStore } from '../store/fenceStore';
import { useDisplayStore, fenceBelongsHere } from '../store/displayStore';
import { defaultFenceStyle } from './theme';
import { sortExistingFiles } from './rule-runner';
import type { AutomationRule, Fence, RuleCondition } from '../../shared/types';

/** One-click rules: "everything of this kind that lands on the Desktop goes into this fence". */
export interface QuickRule {
  key: string;
  label: string; // also the name of the fence "Organize my Desktop" creates
  emoji: string;
  conditions: RuleCondition[];
}

const ext = (list: string): RuleCondition => ({ type: 'extension', operator: 'equals', value: list });

// Order matters: an item goes to the FIRST kind it matches
export const QUICK_RULES: QuickRule[] = [
  { key: 'folders', label: 'Folders', emoji: '📁', conditions: [{ type: 'kind', operator: 'equals', value: 'folder' }] },
  { key: 'apps', label: 'Apps', emoji: '🚀', conditions: [ext('lnk url exe appref-ms')] },
  { key: 'images', label: 'Images', emoji: '🖼️', conditions: [ext('jpg jpeg png gif bmp webp heic heif svg tif tiff ico raw')] },
  { key: 'documents', label: 'Documents', emoji: '📄', conditions: [ext('pdf doc docx xls xlsx xlsm ppt pptx txt rtf odt ods odp csv md epub')] },
  { key: 'videos', label: 'Videos', emoji: '🎬', conditions: [ext('mp4 mkv avi mov wmv webm m4v flv')] },
  { key: 'music', label: 'Music', emoji: '🎵', conditions: [ext('mp3 wav flac aac ogg m4a wma opus')] },
  { key: 'archives', label: 'Archives', emoji: '📦', conditions: [ext('zip rar 7z tar gz bz2 xz iso')] },
  { key: 'installers', label: 'Installers', emoji: '💿', conditions: [ext('msi msix appx')] },
];

export function makeQuickRule(quick: QuickRule, targetFenceId: string, watchFolder: string): AutomationRule {
  return {
    id: `rule-${quick.key}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: `${quick.label} from the Desktop`,
    enabled: true,
    conditions: quick.conditions,
    action: 'move',
    targetFenceId,
    watchPaths: [watchFolder],
    preset: quick.key,
  };
}

/** Which quick kind an item belongs to (the first that matches), or null. */
export function quickKindOf(name: string, isDirectory: boolean): QuickRule | null {
  if (name.toLowerCase() === 'desktop.ini' || name.toLowerCase() === 'thumbs.db') return null;
  const dot = name.lastIndexOf('.');
  const extension = !isDirectory && dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  for (const quick of QUICK_RULES) {
    const matches = quick.conditions.every((c) =>
      c.type === 'kind'
        ? String(c.value) === (isDirectory ? 'folder' : 'file')
        : !isDirectory && String(c.value).split(/\s+/).includes(extension)
    );
    if (matches) return quick;
  }
  return null;
}

export interface OrganizePlan {
  desktop: string;
  groups: { quick: QuickRule; count: number; existingFenceId?: string }[];
  total: number;
}

/** Looks at the Desktop and counts what each kind would collect (nothing changes). */
export async function planOrganizeDesktop(): Promise<OrganizePlan> {
  const desktop = await window.electronAPI.getKnownPath('desktop');
  if (!desktop) throw new Error('Could not find your Desktop folder.');
  const files: { name: string; type: 'file' | 'folder' }[] = await window.electronAPI.getFilesInFolder(desktop);

  const counts = new Map<string, number>();
  for (const f of files) {
    const quick = quickKindOf(f.name, f.type === 'folder');
    if (quick) counts.set(quick.key, (counts.get(quick.key) || 0) + 1);
  }

  const fences = useFenceStore.getState().fences;
  const groups = QUICK_RULES.filter((q) => counts.has(q.key)).map((quick) => ({
    quick,
    count: counts.get(quick.key) || 0,
    // a fence made earlier for this kind is reused instead of creating a second one
    existingFenceId: fences.find((f) => (f.rules || []).some((r) => r.preset === quick.key))?.id,
  }));
  return { desktop, groups, total: groups.reduce((n, g) => n + g.count, 0) };
}

/**
 * Creates one fence per kind found on the Desktop (right side of this monitor), gives each its quick
 * rule (so new files keep being sorted), then moves the existing Desktop items in.
 */
export async function organizeDesktop(plan: OrganizePlan): Promise<{ fences: number; moved: number }> {
  const store = useFenceStore.getState();
  const info = useDisplayStore.getState().info;
  const width = 292;
  const gap = 12;
  let x = window.innerWidth - width - 16;
  let y = 16;
  // keep clear of the fences already on this monitor's right edge
  const taken = info ? store.fences.filter((f) => fenceBelongsHere(f, info)) : [];
  const overlaps = (ax: number, ay: number, h: number) =>
    taken.some((f) => ax < f.position.x + f.size.width && ax + width > f.position.x && ay < f.position.y + f.size.height && ay + h > f.position.y);

  const newRules: AutomationRule[] = [];
  let created = 0;
  for (const group of plan.groups) {
    if (group.existingFenceId) {
      const rule = useFenceStore.getState().fences.find((f) => f.id === group.existingFenceId)?.rules?.find((r) => r.preset === group.quick.key);
      if (rule) newRules.push({ ...rule, targetFenceId: group.existingFenceId });
      continue;
    }
    const rows = Math.min(4, Math.max(1, Math.ceil(group.count / 5)));
    const height = 34 + rows * 64 + 8;
    for (let guard = 0; guard < 50 && overlaps(x, y, height); guard++) {
      y += 40;
      if (y + height > window.innerHeight - 16) {
        y = 16;
        x -= width + gap;
      }
    }
    if (y + height > window.innerHeight - 16) {
      y = 16;
      x -= width + gap;
    }
    const id = `fence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const rule = makeQuickRule(group.quick, id, plan.desktop);
    const fence: Fence = {
      id,
      name: group.quick.label,
      position: { x: Math.max(0, x), y },
      size: { width, height },
      items: [],
      style: defaultFenceStyle(),
      displayId: info?.displayId,
      gridSize: 80,
      rules: [rule],
    };
    useFenceStore.getState().addFence(fence);
    taken.push(fence);
    newRules.push(rule);
    created++;
    y += height + gap;
  }

  await useFenceStore.getState().saveFences();
  try {
    await window.electronAPI.watchFolder(plan.desktop); // new Desktop files are sorted as they arrive
  } catch (error) {
    console.warn('Could not watch the Desktop:', error);
  }
  const { moved } = await sortExistingFiles(newRules);
  return { fences: created, moved };
}
