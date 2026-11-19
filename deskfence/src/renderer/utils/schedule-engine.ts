import { nextCronRun } from './cron';

export interface ScheduledTask {
  id: string;
  name: string;
  type: 'cleanup';
  enabled: boolean;
  schedule: string; // Cron expression
  lastRun?: number;
  nextRun?: number;
  lastResult?: { processed: number; failed: number; error?: string };
  config: {
    targetPaths: string[];
    olderThan: number; // days
    action: 'delete' | 'archive' | 'move';
    destination?: string;
    extensions?: string[]; // only these file types (without the dot)
  };
}

export interface TaskPreset {
  name: string;
  description: string;
  schedule: string;
  config: ScheduledTask['config'];
}

export class ScheduleEngine {
  /** Human readable version of a cron expression. */
  static describeSchedule(cronExpression: string): string {
    const parts = cronExpression.split(' ');
    if (parts.length !== 5) return cronExpression;

    const [minute, hour, dayOfMonth, , dayOfWeek] = parts;

    if (cronExpression === '0 0 * * *') return 'Daily at midnight';
    if (cronExpression === '0 2 * * *') return 'Daily at 2:00 AM';
    if (cronExpression === '0 3 * * 0') return 'Weekly on Sunday at 3:00 AM';
    if (cronExpression === '0 0 * * 0') return 'Weekly on Sunday at midnight';
    if (cronExpression === '0 0 1 * *') return 'Monthly on the 1st at midnight';
    if (cronExpression === '0 2 1 * *') return 'Monthly on the 1st at 2:00 AM';
    if (cronExpression === '0 2 * * 0') return 'Weekly on Sunday at 2:00 AM';
    if (cronExpression === '*/15 * * * *') return 'Every 15 minutes';
    if (cronExpression === '0 */6 * * *') return 'Every 6 hours';

    let description = '';
    if (minute === '*') description += 'every minute';
    else if (minute.startsWith('*/')) description += `every ${minute.substring(2)} minutes`;
    else description += `at minute ${minute}`;

    if (hour === '*') {
      description += ', every hour';
    } else if (hour.startsWith('*/')) {
      description += `, every ${hour.substring(2)} hours`;
    } else {
      const h = parseInt(hour);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const displayHour = h > 12 ? h - 12 : h === 0 ? 12 : h;
      description += ` at ${displayHour}:${minute.padStart(2, '0')} ${ampm}`;
    }

    if (dayOfWeek !== '*') {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      description += ` on ${dayOfWeek.split(',').map((d) => days[parseInt(d) % 7]).join(', ')}`;
    }
    if (dayOfMonth !== '*') description += ` on day ${dayOfMonth} of the month`;
    return description;
  }

  /** Next time the schedule fires after `fromDate` (null if the expression is invalid). */
  static getNextRunTime(cronExpression: string, fromDate: Date = new Date()): Date | null {
    return nextCronRun(cronExpression, fromDate);
  }

  /** Due when its next run time has passed. Also catches up once if the app was closed at that time. */
  static shouldRun(task: ScheduledTask, now: number = Date.now()): boolean {
    if (!task.enabled) return false;
    const next = task.nextRun ?? this.getNextRunTime(task.schedule, new Date(task.lastRun ?? now))?.getTime();
    return next !== undefined && now >= next;
  }

  /**
   * Templates. They only ever touch the user's own Desktop/Downloads, move (never delete)
   * and only items that are older than the given number of days. Paths come from the OS.
   */
  static async getCleanupPresets(): Promise<TaskPreset[]> {
    const [desktop, downloads, documents] = await Promise.all([
      window.electronAPI.getKnownPath('desktop'),
      window.electronAPI.getKnownPath('downloads'),
      window.electronAPI.getKnownPath('documents'),
    ]);
    const join = (base: string, name: string) => (base ? `${base.replace(/[\\/]+$/, '')}${base.includes('\\') ? '\\' : '/'}${name}` : '');

    const presets: TaskPreset[] = [];
    if (desktop) {
      presets.push({
        name: 'Weekly Desktop Tidy-up',
        description: 'Move Desktop items untouched for 14+ days into Documents\\DeskFence Archive\\Desktop',
        schedule: '0 3 * * 0',
        config: {
          targetPaths: [desktop],
          olderThan: 14,
          action: 'archive',
          destination: join(join(documents, 'DeskFence Archive'), 'Desktop'),
        },
      });
    }
    if (downloads) {
      presets.push({
        name: 'Monthly Downloads Archive',
        description: 'Move Downloads older than 30 days into Documents\\DeskFence Archive\\Downloads',
        schedule: '0 2 1 * *',
        config: {
          targetPaths: [downloads],
          olderThan: 30,
          action: 'archive',
          destination: join(join(documents, 'DeskFence Archive'), 'Downloads'),
        },
      });
      presets.push({
        name: 'Old Downloads to Recycle Bin',
        description: 'Send Downloads older than 90 days to the Recycle Bin (restorable)',
        schedule: '0 2 * * 0',
        config: { targetPaths: [downloads], olderThan: 90, action: 'delete' },
      });
    }
    return presets;
  }
}
