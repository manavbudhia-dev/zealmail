/** "#3b82f6" or "rgba(30, 41, 59, 0.85)" -> { hex, alpha } for color pickers. */
export function splitColor(color: string | undefined): { hex: string; alpha: number } {
  const text = String(color || '').trim();
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(text);
  if (rgba) {
    const hex = '#' + [rgba[1], rgba[2], rgba[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('');
    return { hex, alpha: rgba[4] === undefined ? 1 : Number(rgba[4]) };
  }
  if (/^#[0-9a-f]{6}$/i.test(text)) return { hex: text.toLowerCase(), alpha: 1 };
  if (/^#[0-9a-f]{3}$/i.test(text)) return { hex: '#' + [...text.slice(1)].map((c) => c + c).join('').toLowerCase(), alpha: 1 };
  return { hex: '#1e293b', alpha: 0.85 };
}

/** "#rrggbb" + alpha -> "rgba(r, g, b, a)". */
export function joinColor(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(alpha * 100) / 100})`;
}

/** Mixes two "#rrggbb" colours: t = 0 gives `a`, t = 1 gives `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(splitColor(a).hex.slice(1), 16);
  const pb = parseInt(splitColor(b).hex.slice(1), 16);
  const k = Math.min(1, Math.max(0, t));
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - k) + ((pb >> shift) & 255) * k);
  return '#' + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('');
}
