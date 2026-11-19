import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ScheduledTask } from '../utils/schedule-engine';

interface ScheduledStore {
  tasks: ScheduledTask[];
  addTask: (task: ScheduledTask) => void;
  updateTask: (id: string, updates: Partial<ScheduledTask>) => void;
  deleteTask: (id: string) => void;
}

export const useScheduledStore = create<ScheduledStore>()(
  persist(
    (set) => ({
      tasks: [],
      addTask: (task) => set((s) => ({ tasks: [...s.tasks, task] })),
      updateTask: (id, updates) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)) })),
      deleteTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
    }),
    { name: 'deskfence-scheduled-tasks', partialize: (state) => ({ tasks: state.tasks }) }
  )
);

const inFlight = new Map<string, Promise<Awaited<ReturnType<typeof runTask>>>>();

/** Runs one task now and records the result. Shared by the scheduler and the "Run now" button.
 *  The same task never runs twice at once: a second request joins the run already in progress. */
export function executeTask(task: ScheduledTask) {
  const running = inFlight.get(task.id);
  if (running) return running;
  const run = runTask(task).finally(() => inFlight.delete(task.id));
  inFlight.set(task.id, run);
  return run;
}

async function runTask(task: ScheduledTask) {
  const { updateTask } = useScheduledStore.getState();
  const { ScheduleEngine } = await import('../utils/schedule-engine');
  try {
    const result = await window.electronAPI.runCleanup({
      targetPaths: task.config.targetPaths,
      olderThanDays: task.config.olderThan,
      action: task.config.action,
      destination: task.config.destination,
      extensions: task.config.extensions,
      taskId: task.id, // main refuses a second simultaneous run of the same task (even from another window)
    });
    if (result.busy) return result; // another window is already running it; it records the result
    const now = Date.now();
    updateTask(task.id, {
      lastRun: now,
      nextRun: ScheduleEngine.getNextRunTime(task.schedule, new Date(now))?.getTime(),
      lastResult: { processed: result.processed, failed: result.failed.length, error: result.failed[0]?.error },
    });
    return result;
  } catch (error) {
    const now = Date.now();
    updateTask(task.id, {
      lastRun: now,
      nextRun: ScheduleEngine.getNextRunTime(task.schedule, new Date(now))?.getTime(),
      lastResult: { processed: 0, failed: 1, error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}
