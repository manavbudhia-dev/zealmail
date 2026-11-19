import type { FenceItem } from '../../shared/types';

export interface FolderEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
  size?: number;
  modified?: number;
}

/** Turns folder listing into fence items, reusing ids of items that are already there. */
export function filesToItems(files: FolderEntry[], existing: FenceItem[] = []): FenceItem[] {
  const byPath = new Map(existing.map((item) => [item.path, item]));
  return files.map((file) => {
    const previous = byPath.get(file.path);
    return {
      id: previous?.id ?? `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      path: file.path,
      type: file.type,
      position: previous?.position ?? { x: 0, y: 0 },
      ...(file.type === 'file' && Number.isFinite(file.size) ? { size: file.size } : {}),
      ...(Number.isFinite(file.modified) ? { modified: file.modified } : {}),
    };
  });
}

/** Electron wraps errors thrown in the main process; show only the useful part. */
export function cleanIpcError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const cleaned = message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').trim();
  return cleaned || fallback;
}
