import React, { useEffect, useRef, useState } from 'react';
import { useFenceStore } from '../store/fenceStore';
import { defaultFenceStyle, displayStyle } from '../utils/theme';
import { splitColor, joinColor } from '../utils/color';
import FolderIcon from './FolderIcon';
import type { Fence, FenceStyle } from '../../shared/types';

interface FenceCustomizationDialogProps {
  fence: Fence;
  onClose: () => void;
}

const PRESETS: { name: string; style: Partial<FenceStyle> }[] = [
  { name: 'Classic', style: { backgroundColor: 'rgba(16, 20, 26, 0.86)', borderColor: 'rgba(255, 255, 255, 0.12)', labelColor: '#ffffff', borderWidth: 1, borderRadius: 6, titleBarColor: undefined, tabColor: undefined } },
  { name: 'Glass', style: { backgroundColor: 'rgba(255, 255, 255, 0.14)', borderColor: 'rgba(255, 255, 255, 0.35)', labelColor: '#ffffff', borderWidth: 1, titleBarColor: undefined } },
  { name: 'Light', style: { backgroundColor: 'rgba(255, 255, 255, 0.88)', borderColor: 'rgba(0, 0, 0, 0.12)', labelColor: '#1f2937', borderWidth: 1, titleBarColor: undefined, tabColor: 'rgba(0, 0, 0, 0.08)' } },
  { name: 'Slate', style: { backgroundColor: 'rgba(30, 41, 59, 0.85)', borderColor: '#3b82f6', labelColor: '#ffffff', borderWidth: 2, titleBarColor: 'rgba(59, 130, 246, 0.25)' } },
  { name: 'Forest', style: { backgroundColor: 'rgba(20, 83, 45, 0.8)', borderColor: '#22c55e', labelColor: '#ecfdf5', borderWidth: 1, titleBarColor: 'rgba(34, 197, 94, 0.2)' } },
  { name: 'Plum', style: { backgroundColor: 'rgba(76, 29, 149, 0.8)', borderColor: '#a78bfa', labelColor: '#f5f3ff', borderWidth: 1, titleBarColor: 'rgba(167, 139, 250, 0.2)' } },
  { name: 'Ember', style: { backgroundColor: 'rgba(124, 45, 18, 0.8)', borderColor: '#fb923c', labelColor: '#fff7ed', borderWidth: 1, titleBarColor: 'rgba(251, 146, 60, 0.2)' } },
];

const CORNERS: { name: string; radius: number }[] = [
  { name: 'Square', radius: 0 },
  { name: 'Soft', radius: 6 },
  { name: 'Rounded', radius: 14 },
  { name: 'Round', radius: 24 },
];

const TINTS = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#9ca3af'];

const toDateInput = (ms?: number) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Customize one fence. Every change shows on the real fence right away; Cancel puts it back. */
const FenceCustomizationDialog: React.FC<FenceCustomizationDialogProps> = ({ fence, onClose }) => {
  const { updateFence, saveFences } = useFenceStore();
  // what to restore on Cancel
  const original = useRef({ style: fence.style, size: fence.size });
  const [name, setName] = useState(fence.name);
  const [style, setStyle] = useState<FenceStyle>({ ...displayStyle(fence.style) });
  const [size, setSize] = useState({ ...fence.size });
  const [category, setCategory] = useState(fence.category || '');
  const [tags, setTags] = useState((fence.tags || []).join(', '));
  const [dueDate, setDueDate] = useState(toDateInput(fence.dueDate));

  // live preview on the Desktop (not saved until Save)
  useEffect(() => {
    updateFence(fence.id, { style, size });
  }, [style, size]);

  const set = (updates: Partial<FenceStyle>) => setStyle((current) => ({ ...current, ...updates }));
  const bg = splitColor(style.backgroundColor);
  const bar = splitColor(style.titleBarColor || 'rgba(255, 255, 255, 0)');
  const tab = splitColor(style.tabColor || 'rgba(255, 255, 255, 0.15)');

  const cancel = () => {
    updateFence(fence.id, original.current);
    onClose();
  };

  const handleSave = () => {
    const [y, m, d] = dueDate.split('-').map(Number);
    updateFence(fence.id, {
      name: name.trim() || fence.name,
      style,
      size,
      category: category.trim() || undefined,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      dueDate: dueDate ? new Date(y, m - 1, d).getTime() : undefined,
    });
    saveFences();
    onClose();
  };

  const applyToAll = () => {
    const all = useFenceStore.getState().fences;
    if (!confirm(`Give all ${all.length} fences this look (colours, corners, title bar, icons)? Names, sizes and contents stay as they are.`)) return;
    for (const f of all) {
      if (f.id === fence.id) continue;
      updateFence(f.id, { style: { ...style } });
    }
    handleSave();
  };

  // ---- small building blocks ----
  const input = 'px-2 py-1 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 outline-none';
  const row = (label: string, control: React.ReactNode, hint?: string) => (
    <div className="flex items-center justify-between gap-4 text-sm text-gray-300">
      <span title={hint}>{label}</span>
      {control}
    </div>
  );
  const range = (value: number, min: number, max: number, step: number, onChange: (v: number) => void, unit = '') => (
    <span className="flex items-center gap-2">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-36" />
      <span className="w-12 text-right text-gray-400 text-xs">{value}{unit}</span>
    </span>
  );
  const colorPick = (value: string, onChange: (hex: string) => void) => (
    <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-10 h-7 bg-transparent cursor-pointer" />
  );
  const chip = (label: string, active: boolean, onClick: () => void, extra?: React.CSSProperties) => (
    <button
      key={label}
      onClick={onClick}
      className={`px-3 py-1 rounded text-xs border ${active ? 'border-blue-400 ring-1 ring-blue-400' : 'border-gray-600'} bg-gray-700 text-gray-300 hover:bg-gray-600`}
      style={extra}
    >
      {label}
    </button>
  );
  const section = (title: string, children: React.ReactNode) => (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-wide text-gray-400">{title}</div>
      {children}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end p-4 pointer-events-none">
      {/* docked at the side so the fence itself stays visible while you change it */}
      <div className="pointer-events-auto bg-gray-800 rounded-lg shadow-2xl w-full max-w-md max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-white">Customize fence</h2>
            <p className="text-xs text-gray-400">Changes show on the fence right away</p>
          </div>
          <button onClick={cancel} className="text-gray-400 hover:text-white transition-colors">✕</button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-6">
          {/* preview with sample icons, so tint / title / corners can be judged even off-screen */}
          <div
            className="overflow-hidden"
            style={{
              backgroundColor: style.backgroundColor,
              border: `${style.borderWidth}px solid ${style.borderColor}`,
              borderRadius: style.borderRadius,
              opacity: style.opacity,
              boxShadow: style.shadow === false ? 'none' : '0 4px 18px rgba(0,0,0,0.25)',
            }}
          >
            <div
              className={`px-3 py-1 font-semibold ${style.titleAlign === 'left' ? 'text-left' : 'text-center'}`}
              style={{ color: style.labelColor, fontSize: style.labelSize, backgroundColor: style.titleBarColor || undefined }}
            >
              {name || fence.name}
            </div>
            <div className="flex justify-center gap-4 px-3 pb-2 pt-1">
              {['Documents', 'Projects', 'Photos'].map((label) => (
                <div key={label} className="flex flex-col items-center gap-1">
                  <FolderIcon size={style.iconPx ?? 34} tint={style.iconTint} strength={style.iconTintStrength} />
                  <span className="fence-item-label" style={{ color: style.labelColor, fontSize: style.itemLabelSize ?? 10 }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {section('Look', (
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => set(p.style)}
                  className="px-3 py-1 rounded text-xs border"
                  // drawn over a dark swatch, so see-through looks (Glass) stay visible on a light dialog
                  style={{
                    background: `linear-gradient(${p.style.backgroundColor}, ${p.style.backgroundColor}), #334155`,
                    borderColor: p.style.borderColor,
                    color: p.style.labelColor,
                  }}
                >
                  {p.name}
                </button>
              ))}
              <button onClick={() => setStyle({ ...defaultFenceStyle() })} className="px-3 py-1 rounded text-xs bg-gray-700 text-gray-300 hover:text-white">
                Reset
              </button>
            </div>
          ))}

          {section('Panel', (
            <>
              {row('Colour', colorPick(bg.hex, (hex) => set({ backgroundColor: joinColor(hex, bg.alpha) })))}
              {row('Transparency', range(Math.round((1 - bg.alpha) * 100), 0, 100, 5, (v) => set({ backgroundColor: joinColor(bg.hex, 1 - v / 100) }), '%'))}
              {row('Border colour', colorPick(splitColor(style.borderColor).hex, (hex) => set({ borderColor: joinColor(hex, splitColor(style.borderColor).alpha) })))}
              {row('Border width', range(style.borderWidth, 0, 6, 1, (v) => set({ borderWidth: v }), 'px'))}
              {row('Corners', (
                <div className="flex gap-1">
                  {CORNERS.map((c) => chip(c.name, style.borderRadius === c.radius, () => set({ borderRadius: c.radius }), { borderRadius: Math.min(c.radius, 10) }))}
                </div>
              ))}
              {row('Corner radius', range(style.borderRadius, 0, 30, 1, (v) => set({ borderRadius: v }), 'px'))}
              {row('Shadow', <input type="checkbox" className="w-4 h-4" checked={style.shadow !== false} onChange={(e) => set({ shadow: e.target.checked })} />)}
              {row('Whole fence opacity', range(Math.round(style.opacity * 100), 20, 100, 5, (v) => set({ opacity: v / 100 }), '%'), 'Fades the icons too; use Transparency to fade only the background')}
            </>
          ))}

          {section('Title & tabs', (
            <>
              {row('Title colour', colorPick(splitColor(style.labelColor).hex, (hex) => set({ labelColor: hex })))}
              {row('Title size', range(style.labelSize, 10, 24, 1, (v) => set({ labelSize: v }), 'px'))}
              {row('Title position', (
                <div className="flex gap-1">
                  {chip('Center', style.titleAlign !== 'left', () => set({ titleAlign: 'center' }))}
                  {chip('Left', style.titleAlign === 'left', () => set({ titleAlign: 'left' }))}
                </div>
              ))}
              {row('Title bar colour', (
                <span className="flex items-center gap-2">
                  {colorPick(bar.hex, (hex) => set({ titleBarColor: joinColor(hex, Math.max(bar.alpha, 0.3)) }))}
                  {style.titleBarColor && <button className="text-xs text-gray-400 hover:text-white" onClick={() => set({ titleBarColor: undefined })}>none</button>}
                </span>
              ))}
              {style.titleBarColor && row('Title bar strength', range(Math.round(bar.alpha * 100), 5, 100, 5, (v) => set({ titleBarColor: joinColor(bar.hex, v / 100) }), '%'))}
              {row('Active tab colour', colorPick(tab.hex, (hex) => set({ tabColor: joinColor(hex, Math.max(tab.alpha, 0.35)) })), 'Highlight of the open tab (fences with tabs)')}
              {row('Folder icon before title', <input type="checkbox" className="w-4 h-4" checked={!!style.compactHeader} onChange={(e) => set({ compactHeader: e.target.checked })} />)}
            </>
          ))}

          {section('Icons', (
            <>
              {row('Icon size', range(style.iconPx ?? 34, 16, 96, 2, (v) => set({ iconPx: v }), 'px'))}
              {row('Label size', range(style.itemLabelSize ?? 10, 8, 18, 0.5, (v) => set({ itemLabelSize: v }), 'px'))}
              {row('Columns', (
                <select className={input} value={style.columns ?? 0} onChange={(e) => set({ columns: Number(e.target.value) || undefined })}>
                  <option value={0}>As many as fit</option>
                  {[1, 2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              ))}
              {row('Icon tint', (
                <div className="flex items-center gap-1">
                  {TINTS.map((c) => (
                    <button
                      key={c}
                      onClick={() => set({ iconTint: c, iconTintStrength: style.iconTintStrength || 0.6 })}
                      className={`w-5 h-5 rounded-full border ${style.iconTint === c && (style.iconTintStrength ?? 0) > 0 ? 'border-white ring-1 ring-white' : 'border-gray-500'}`}
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                  {colorPick(style.iconTint || '#3b82f6', (hex) => set({ iconTint: hex, iconTintStrength: style.iconTintStrength || 0.6 }))}
                </div>
              ), 'Lays a colour over every icon, keeping its light and shade')}
              {row('Tint strength', range(Math.round((style.iconTintStrength ?? 0) * 100), 0, 100, 5, (v) => set({ iconTintStrength: v / 100 }), '%'))}
            </>
          ))}

          {section('Size', (
            <>
              {row('Width', range(size.width, 160, 1200, 10, (v) => setSize((s) => ({ ...s, width: v })), 'px'))}
              {row('Height', range(size.height, 60, 1000, 10, (v) => setSize((s) => ({ ...s, height: v })), 'px'))}
            </>
          ))}

          {section('Details', (
            <>
              {row('Name', <input className={`${input} w-48`} value={name} onChange={(e) => setName(e.target.value)} />)}
              {row('Category', <input className={`${input} w-48`} value={category} placeholder="Client, project…" onChange={(e) => setCategory(e.target.value)} />)}
              {row('Tags', <input className={`${input} w-48`} value={tags} placeholder="comma, separated" onChange={(e) => setTags(e.target.value)} />)}
              {row('Due date', (
                <span className="flex items-center gap-2">
                  <input type="date" className={input} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  {dueDate && <button className="text-xs text-gray-400 hover:text-white" onClick={() => setDueDate('')}>clear</button>}
                </span>
              ))}
            </>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-gray-700">
          <button onClick={applyToAll} className="px-3 py-2 text-sm text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 rounded">
            Apply look to all fences
          </button>
          <div className="flex gap-2">
            <button onClick={cancel} className="px-4 py-2 text-gray-300 hover:text-white transition-colors">Cancel</button>
            <button onClick={handleSave} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FenceCustomizationDialog;
