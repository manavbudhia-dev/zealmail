import { isValidCron } from './cron';

export type ScheduleSpec =
  | { mode: 'minutes'; every: number }
  | { mode: 'hours'; every: number }
  | { mode: 'daily'; time: string }
  | { mode: 'weekly'; days: number[]; time: string } // 0 = Sunday
  | { mode: 'monthly'; day: number; time: string }
  | { mode: 'custom'; cron: string };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

function splitTime(time: string): { h: number; m: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return { h: 0, m: 0 };
  return { h: clamp(parseInt(match[1], 10), 0, 23), m: clamp(parseInt(match[2], 10), 0, 59) };
}

export const pad = (n: number) => String(n).padStart(2, '0');

/** Friendly schedule -> cron expression (what the scheduler runs). */
export function buildCron(spec: ScheduleSpec): string {
  switch (spec.mode) {
    case 'minutes':
      return `*/${clamp(spec.every, 1, 59)} * * * *`;
    case 'hours':
      return `0 */${clamp(spec.every, 1, 23)} * * *`;
    case 'daily': {
      const { h, m } = splitTime(spec.time);
      return `${m} ${h} * * *`;
    }
    case 'weekly': {
      const { h, m } = splitTime(spec.time);
      const days = [...new Set(spec.days.map((d) => clamp(d, 0, 6)))].sort((a, b) => a - b);
      return `${m} ${h} * * ${days.length ? days.join(',') : '*'}`;
    }
    case 'monthly': {
      const { h, m } = splitTime(spec.time);
      return `${m} ${h} ${clamp(spec.day, 1, 31)} * *`;
    }
    case 'custom':
      return spec.cron.trim();
  }
}

/** Cron expression -> friendly schedule (falls back to "custom" for anything unusual). */
export function specFromCron(cron: string): ScheduleSpec {
  const parts = cron.trim().split(/\s+/);
  if (parts.length === 5) {
    const [min, hour, dom, month, dow] = parts;
    const num = (s: string) => /^\d+$/.test(s);
    if (/^\*\/\d+$/.test(min) && hour === '*' && dom === '*' && month === '*' && dow === '*') {
      return { mode: 'minutes', every: parseInt(min.slice(2), 10) };
    }
    if (min === '0' && /^\*\/\d+$/.test(hour) && dom === '*' && month === '*' && dow === '*') {
      return { mode: 'hours', every: parseInt(hour.slice(2), 10) };
    }
    if (num(min) && num(hour) && month === '*') {
      const time = `${pad(parseInt(hour, 10))}:${pad(parseInt(min, 10))}`;
      if (dom === '*' && dow === '*') return { mode: 'daily', time };
      if (dom === '*' && /^[0-6](,[0-6])*$/.test(dow)) {
        return { mode: 'weekly', days: dow.split(',').map(Number), time };
      }
      if (num(dom) && dow === '*') return { mode: 'monthly', day: parseInt(dom, 10), time };
    }
  }
  return { mode: 'custom', cron };
}

export function validateSchedule(spec: ScheduleSpec): string | null {
  if (spec.mode === 'weekly' && spec.days.length === 0) return 'Pick at least one day of the week.';
  if (spec.mode === 'minutes' && (spec.every < 1 || spec.every > 59)) return 'Minutes must be between 1 and 59.';
  if (spec.mode === 'hours' && (spec.every < 1 || spec.every > 23)) return 'Hours must be between 1 and 23.';
  if (!isValidCron(buildCron(spec))) {
    return spec.mode === 'custom' ? 'Not a valid cron expression (5 fields: minute hour day month weekday).' : 'Invalid schedule.';
  }
  return null;
}
