import React, { useState } from 'react';
import { useFenceStore } from '../store/fenceStore';
import { defaultFenceStyle, displayStyle } from '../utils/theme';
import type { Fence, FenceStyle } from '../../shared/types';

interface FenceCustomizationDialogProps {
  fence: Fence;
  onClose: () => void;
}

/** "#3b82f6" or "rgba(30, 41, 59, 0.85)" -> { hex, alpha } for the color pickers. */
function splitColor(color: string): { hex: string; alpha: number } {
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(color.trim());
  if (rgba) {
    const hex = '#' + [rgba[1], rgba[2], rgba[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    return { hex, alpha: rgba[4] === undefined ? 1 : Number(rgba[4]) };
  }
  if (/^#[0-9a-f]{6}$/i.test(color)) return { hex: color, alpha: 1 };
  if (/^#[0-9a-f]{3}$/i.test(color)) return { hex: '#' + [...color.slice(1)].map((c) => c + c).join(''), alpha: 1 };
  return { hex: '#1e293b', alpha: 0.85 };
}

function joinColor(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(alpha * 100) / 100})`;
}

const PRESETS: { name: string; style: Partial<FenceStyle> }[] = [
  { name: 'Classic', style: { backgroundColor: 'rgba(16, 20, 26, 0.86)', borderColor: 'rgba(255, 255, 255, 0.12)', labelColor: '#ffffff', borderWidth: 1, borderRadius: 6, opacity: 1 } },
  { name: 'Slate', style: { backgroundColor: 'rgba(30, 41, 59, 0.85)', borderColor: '#3b82f6', labelColor: '#ffffff' } },
  { name: 'Glass', style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', borderColor: '#ffffff', labelColor: '#ffffff' } },
  { name: 'Light', style: { backgroundColor: 'rgba(255, 255, 255, 0.88)', borderColor: '#3b82f6', labelColor: '#1f2937' } },
  { name: 'Forest', style: { backgroundColor: 'rgba(20, 83, 45, 0.8)', borderColor: '#22c55e', labelColor: '#ecfdf5' } },
  { name: 'Plum', style: { backgroundColor: 'rgba(76, 29, 149, 0.8)', borderColor: '#a78bfa', labelColor: '#f5f3ff' } },
  { name: 'Ember', style: { backgroundColor: 'rgba(124, 45, 18, 0.8)', borderColor: '#fb923c', labelColor: '#fff7ed' } },
];

const toDateInput = (ms?: number) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const FenceCustomizationDialog: React.FC<FenceCustomizationDialogProps> = ({ fence, onClose }) => {
  const { updateFence, saveFences } = useFenceStore();
  const [name, setName] = useState(fence.name);
  const [style, setStyle] = useState<FenceStyle>({ ...displayStyle(fence.style) });
  const [category, setCategory] = useState(fence.category || '');
  const [tags, setTags] = useState((fence.tags || []).join(', '));
  const [dueDate, setDueDate] = useState(toDateInput(fence.dueDate));

  const bg = splitColor(style.backgroundColor);
  const set = (updates: Partial<FenceStyle>) => setStyle((current) => ({ ...current, ...updates }));

  const handleSave = () => {
    const [y, m, d] = dueDate.split('-').map(Number);
    updateFence(fence.id, {
      name: name.trim() || fence.name,
      style,
      category: category.trim() || undefined,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      dueDate: dueDate ? new Date(y, m - 1, d).getTime() : undefined,
    });
    saveFences();
    onClose();
  };

  const row = (label: string, control: React.ReactNode) => (
    <label className="flex items-center justify-between gap-4 text-sm text-gray-300">
      <span>{label}</span>
      {control}
    </label>
  );
  const range = (value: number, min: number, max: number, step: number, onChange: (v: number) => void, unit = '') => (
    <span className="flex items-center gap-2">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-40" />
      <span className="w-12 text-right text-gray-400 text-xs">{value}{unit}</span>
    </span>
  );
  const input = 'px-2 py-1 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-lg max-h-[calc(100vh-4rem)] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">Customize fence</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">✕</button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-5">
          {/* live preview */}
          <div
            className="px-3 py-2 font-semibold"
            style={{
              backgroundColor: style.backgroundColor,
              border: `${style.borderWidth}px solid ${style.borderColor}`,
              borderRadius: style.borderRadius,
              opacity: style.opacity,
              color: style.labelColor,
              fontSize: style.labelSize,
            }}
          >
            {name || fence.name}
          </div>

          <div className="space-y-3">
            {row('Name', <input className={`${input} w-56`} value={name} onChange={(e) => setName(e.target.value)} />)}
            {row('Category', <input className={`${input} w-56`} value={category} placeholder="Client, project…" onChange={(e) => setCategory(e.target.value)} />)}
            {row('Tags', <input className={`${input} w-56`} value={tags} placeholder="comma, separated" onChange={(e) => setTags(e.target.value)} />)}
            {row('Due date', (
              <span className="flex items-center gap-2">
                <input type="date" className={input} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                {dueDate && <button className="text-xs text-gray-400 hover:text-white" onClick={() => setDueDate('')}>clear</button>}
              </span>
            ))}
          </div>

          <div>
            <div className="text-sm text-gray-300 mb-2">Presets</div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => set(p.style)}
                  className="px-3 py-1 rounded text-xs border"
                  style={{ backgroundColor: p.style.backgroundColor, borderColor: p.style.borderColor, color: p.style.labelColor }}
                >
                  {p.name}
                </button>
              ))}
              <button
                onClick={() => setStyle({ ...style, ...defaultFenceStyle() })}
                className="px-3 py-1 rounded text-xs bg-gray-700 text-gray-300 hover:text-white"
              >
                Reset
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {row('Background', <input type="color" value={bg.hex} onChange={(e) => set({ backgroundColor: joinColor(e.target.value, bg.alpha) })} />)}
            {row('Background transparency', range(Math.round((1 - bg.alpha) * 100), 0, 100, 5, (v) => set({ backgroundColor: joinColor(bg.hex, 1 - v / 100) }), '%'))}
            {row('Border', <input type="color" value={splitColor(style.borderColor).hex} onChange={(e) => set({ borderColor: e.target.value })} />)}
            {row('Border width', range(style.borderWidth, 0, 8, 1, (v) => set({ borderWidth: v }), 'px'))}
            {row('Corner radius', range(style.borderRadius, 0, 24, 1, (v) => set({ borderRadius: v }), 'px'))}
            {row('Whole fence opacity', range(Math.round(style.opacity * 100), 20, 100, 5, (v) => set({ opacity: v / 100 }), '%'))}
            {row('Title color', <input type="color" value={splitColor(style.labelColor).hex} onChange={(e) => set({ labelColor: e.target.value })} />)}
            {row('Title size', range(style.labelSize, 10, 28, 1, (v) => set({ labelSize: v }), 'px'))}
            {row('Icon size', range(style.iconPx ?? 34, 16, 96, 4, (v) => set({ iconPx: v }), 'px'))}
            {row('Item label size', range(style.itemLabelSize ?? 10, 9, 20, 1, (v) => set({ itemLabelSize: v }), 'px'))}
            {row('Columns', (
              <select
                className={input}
                value={style.columns ?? 0}
                onChange={(e) => set({ columns: Number(e.target.value) || undefined })}
              >
                <option value={0}>As many as fit</option>
                {[1, 2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            ))}
            {row('Compact header (folder icon + title)', (
              <input type="checkbox" className="w-4 h-4" checked={!!style.compactHeader} onChange={(e) => set({ compactHeader: e.target.checked })} />
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-gray-300 hover:text-white transition-colors">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors">Save</button>
        </div>
      </div>
    </div>
  );
};

export default FenceCustomizationDialog;
