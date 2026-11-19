import type { FenceItem } from '../../shared/types';

export type DetailsColumn = 'name' | 'modified' | 'type' | 'size';
export type SortKey = DetailsColumn;

/** Explorer-style size: "812 bytes", "38.4 MB", "1.27 GB" (3 significant digits). */
export function formatSize(bytes?: number): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = value >= 100 ? Math.round(value).toString() : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${text.replace(/\.0+$|(\.\d*[1-9])0+$/, '$1')} ${units[unit]}`;
}

/** "11/2/2026 1:42 PM" in the user's own date/time format. */
export function formatModified(ms?: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

const KNOWN_TYPES: Record<string, string> = {
  exe: 'Application',
  msi: 'Windows Installer Package',
  lnk: 'Shortcut',
  url: 'Internet Shortcut',
  txt: 'Text Document',
  pdf: 'PDF Document',
  zip: 'Compressed (zipped) Folder',
  jpg: 'JPG File',
  jpeg: 'JPEG File',
  png: 'PNG File',
  docx: 'Microsoft Word Document',
  xlsx: 'Microsoft Excel Worksheet',
  pptx: 'Microsoft PowerPoint Presentation',
  mp3: 'MP3 File',
  mp4: 'MP4 File',
};

/** Explorer-style type: "File folder", "Application", "PNG File"... */
export function typeLabel(item: FenceItem): string {
  if (item.type === 'folder') return 'File folder';
  const dot = item.name.lastIndexOf('.');
  const ext = dot > 0 ? item.name.slice(dot + 1).toLowerCase() : '';
  if (!ext) return 'File';
  return KNOWN_TYPES[ext] || `${ext.toUpperCase()} File`;
}

/** Folders first (like Explorer), then by the chosen column. */
export function sortItems(items: FenceItem[], key: SortKey, ascending: boolean): FenceItem[] {
  const dir = ascending ? 1 : -1;
  const byName = (a: FenceItem, b: FenceItem) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  return [...items].sort((a, b) => {
    const folders = (b.type === 'folder' ? 1 : 0) - (a.type === 'folder' ? 1 : 0);
    if (folders !== 0) return folders;
    let diff = 0;
    if (key === 'modified') diff = (a.modified || 0) - (b.modified || 0);
    else if (key === 'size') diff = (a.size || 0) - (b.size || 0);
    else if (key === 'type') diff = typeLabel(a).localeCompare(typeLabel(b));
    return (diff || byName(a, b)) * dir;
  });
}

/** Columns that fit a fence of this width (Name always). */
export function columnsFor(width: number): DetailsColumn[] {
  if (width < 380) return ['name', 'size'];
  if (width < 560) return ['name', 'modified', 'size'];
  return ['name', 'modified', 'type', 'size'];
}

export function gridTemplate(columns: DetailsColumn[]): string {
  const widths: Record<DetailsColumn, string> = {
    name: 'minmax(0, 2.4fr)',
    modified: 'minmax(0, 1.5fr)',
    type: 'minmax(0, 1.1fr)',
    size: 'minmax(4.5rem, 0.8fr)',
  };
  return columns.map((c) => widths[c]).join(' ');
}
