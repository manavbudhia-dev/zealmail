/** Minimal 5-field cron: minute hour day-of-month month day-of-week. Supports * , - / */

function parseField(field: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : parseInt(stepText, 10);
    if (!Number.isFinite(step) || step < 1) return null;

    let start: number;
    let end: number;
    if (range === '*') {
      start = min;
      end = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map((n) => parseInt(n, 10));
      start = a;
      end = b;
    } else {
      start = parseInt(range, 10);
      end = stepText === undefined ? start : max;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < min || end > max || start > end) return null;
    for (let v = start; v <= end; v += step) values.add(v);
  }
  return values;
}

interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domAny: boolean;
  dowAny: boolean;
}

export function parseCron(expression: string): ParsedCron | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = parseField(parts[0], 0, 59);
  const hour = parseField(parts[1], 0, 23);
  const dom = parseField(parts[2], 1, 31);
  const month = parseField(parts[3], 1, 12);
  const dowRaw = parseField(parts[4], 0, 7);
  if (!minute || !hour || !dom || !month || !dowRaw) return null;
  const dow = new Set([...dowRaw].map((d) => (d === 7 ? 0 : d))); // 7 = Sunday too
  return { minute, hour, dom, month, dow, domAny: parts[2] === '*', dowAny: parts[4] === '*' };
}

export function isValidCron(expression: string): boolean {
  return parseCron(expression) !== null;
}

function matches(cron: ParsedCron, d: Date): boolean {
  if (!cron.minute.has(d.getMinutes()) || !cron.hour.has(d.getHours()) || !cron.month.has(d.getMonth() + 1)) {
    return false;
  }
  const domOk = cron.dom.has(d.getDate());
  const dowOk = cron.dow.has(d.getDay());
  // standard cron: if both day fields are restricted, either one may match
  if (!cron.domAny && !cron.dowAny) return domOk || dowOk;
  return domOk && dowOk;
}

/** First minute strictly after `from` that matches, or null if the expression is invalid. */
export function nextCronRun(expression: string, from: Date = new Date()): Date | null {
  const cron = parseCron(expression);
  if (!cron) return null;
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (matches(cron, d)) return new Date(d.getTime());
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}
