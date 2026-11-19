import React, { useEffect, useState } from 'react';
import { ScheduleEngine } from '../utils/schedule-engine';
import type { ScheduledTask, TaskPreset } from '../utils/schedule-engine';
import { useScheduledStore, executeTask } from '../store/scheduledStore';
import { baseName } from '../utils/fence-files';
import ScheduledTaskForm from './ScheduledTaskForm';

interface ScheduledTasksDialogProps {
  onClose: () => void;
}

const actionLabel = (action: ScheduledTask['config']['action']) =>
  action === 'delete' ? 'send to the Recycle Bin' : 'move to the archive folder';

const ScheduledTasksDialog: React.FC<ScheduledTasksDialogProps> = ({ onClose }) => {
  const { tasks, addTask, updateTask, deleteTask } = useScheduledStore();
  const [showPresets, setShowPresets] = useState(false);
  // undefined = form closed, null = creating a new custom task, task = editing it
  const [formTask, setFormTask] = useState<ScheduledTask | null | undefined>(undefined);
  const [presets, setPresets] = useState<TaskPreset[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    ScheduleEngine.getCleanupPresets().then(setPresets).catch(() => setPresets([]));
  }, []);

  const handleCreateFromPreset = (preset: TaskPreset) => {
    const folders = preset.config.targetPaths.join(', ');
    const ok = confirm(
      `Create "${preset.name}"?\n\n${preset.description}\n\n` +
        `Every time it runs it will ${actionLabel(preset.config.action)} items in:\n${folders}\n` +
        `that were last modified more than ${preset.config.olderThan} day(s) ago.\n\n` +
        `You can preview exactly what it would touch before it ever runs.`
    );
    if (!ok) return;

    addTask({
      id: `task-${Date.now()}`,
      name: preset.name,
      type: 'cleanup',
      enabled: true,
      schedule: preset.schedule,
      nextRun: ScheduleEngine.getNextRunTime(preset.schedule)?.getTime(),
      config: { ...preset.config },
    });
    setShowPresets(false);
  };

  const handleToggleTask = (task: ScheduledTask) => {
    const enabled = !task.enabled;
    updateTask(task.id, {
      enabled,
      // when turning back on, never "catch up" for the time it was off
      nextRun: enabled ? ScheduleEngine.getNextRunTime(task.schedule)?.getTime() : task.nextRun,
    });
  };

  const handleDeleteTask = (task: ScheduledTask) => {
    if (confirm(`Delete the scheduled task "${task.name}"?\n\nFiles that were already archived stay where they are.`)) {
      deleteTask(task.id);
    }
  };

  const preview = async (task: ScheduledTask) => {
    setBusyId(task.id);
    setMessage(null);
    try {
      const result = await window.electronAPI.runCleanup({
        targetPaths: task.config.targetPaths,
        olderThanDays: task.config.olderThan,
        action: task.config.action,
        destination: task.config.destination,
        extensions: task.config.extensions,
        dryRun: true,
      });
      const names = result.matched.slice(0, 8).map((f) => `• ${f.name}`).join('\n');
      const more = result.matched.length > 8 ? `\n…and ${result.matched.length - 8} more` : '';
      const problems = result.failed.length ? `\n\nProblems:\n${result.failed.map((f) => `• ${baseName(f.path)}: ${f.error}`).join('\n')}` : '';
      alert(
        result.matched.length === 0
          ? `Nothing to do right now: no item is older than ${task.config.olderThan} day(s).${problems}`
          : `Right now this would ${actionLabel(task.config.action)} ${result.matched.length} item(s):\n\n${names}${more}${problems}`
      );
    } catch (error) {
      alert(`Preview failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (task: ScheduledTask) => {
    setBusyId(task.id);
    setMessage(null);
    try {
      const dry = await window.electronAPI.runCleanup({
        targetPaths: task.config.targetPaths,
        olderThanDays: task.config.olderThan,
        action: task.config.action,
        destination: task.config.destination,
        extensions: task.config.extensions,
        dryRun: true,
      });
      if (dry.matched.length === 0) {
        setMessage(`"${task.name}": nothing to do, no item is older than ${task.config.olderThan} day(s).`);
        return;
      }
      if (!confirm(`Run "${task.name}" now?\n\n${dry.matched.length} item(s) will be moved: ${actionLabel(task.config.action)}.`)) return;

      const result = await executeTask(task);
      setMessage(
        `"${task.name}": ${result.processed} item(s) processed` +
          (result.failed.length ? `, ${result.failed.length} failed (${result.failed[0].error})` : '.')
      );
    } catch (error) {
      setMessage(`"${task.name}" failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div>
            <h2 className="text-xl font-semibold text-white">Scheduled Tasks</h2>
            <p className="text-sm text-gray-400 mt-1">
              Automated cleanup • {tasks.length} task{tasks.length === 1 ? '' : 's'} configured • runs while DeskFence is running
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {message && (
            <div className="mb-4 p-3 bg-blue-900/30 border border-blue-700 rounded text-sm text-blue-100">{message}</div>
          )}

          {formTask !== undefined ? (
            <ScheduledTaskForm
              task={formTask ?? undefined}
              onCancel={() => setFormTask(undefined)}
              onSave={(saved) => {
                if (formTask) updateTask(saved.id, saved);
                else addTask(saved);
                setFormTask(undefined);
                setShowPresets(false);
              }}
            />
          ) : !showPresets ? (
            <>
              {tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="text-6xl mb-4">⏰</div>
                  <h3 className="text-lg font-medium text-white mb-2">No Scheduled Tasks</h3>
                  <p className="text-sm text-gray-400 mb-6 max-w-md">
                    Automatically archive old files from your Desktop or Downloads. You can preview exactly what a task
                    would touch before anything is moved.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowPresets(true)}
                      className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                    >
                      ⚡ Create from Template
                    </button>
                    <button
                      onClick={() => setFormTask(null)}
                      className="px-6 py-3 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition-colors"
                    >
                      🛠 Build Custom Task
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        task.enabled ? 'bg-gray-700 border-green-500' : 'bg-gray-750 border-gray-600 opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={task.enabled}
                            onChange={() => handleToggleTask(task)}
                            className="w-5 h-5"
                            title={task.enabled ? 'Pause this task' : 'Enable this task'}
                          />
                          <div>
                            <h3 className="text-white font-medium">{task.name}</h3>
                            <p className="text-sm text-gray-400 mt-1">{ScheduleEngine.describeSchedule(task.schedule)}</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => preview(task)}
                            disabled={busyId === task.id}
                            className="px-3 py-1 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors disabled:opacity-50"
                          >
                            👁 Preview
                          </button>
                          <button
                            onClick={() => runNow(task)}
                            disabled={busyId === task.id}
                            className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50"
                          >
                            {busyId === task.id ? 'Working…' : '▶ Run Now'}
                          </button>
                          <button
                            onClick={() => setFormTask(task)}
                            className="px-3 py-1 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
                          >
                            ✏️ Edit
                          </button>
                          <button
                            onClick={() => handleDeleteTask(task)}
                            className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <div className="text-gray-400 mb-1">Action:</div>
                          <div className="text-white capitalize">{task.config.action}</div>
                        </div>
                        <div>
                          <div className="text-gray-400 mb-1">Only items older than:</div>
                          <div className="text-white flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              value={task.config.olderThan}
                              onChange={(e) =>
                                updateTask(task.id, {
                                  config: { ...task.config, olderThan: Math.max(1, parseInt(e.target.value) || 1) },
                                })
                              }
                              className="w-20 px-2 py-1 bg-gray-600 rounded border border-gray-500 outline-none"
                            />
                            day(s)
                          </div>
                        </div>
                        <div>
                          <div className="text-gray-400 mb-1">Folder:</div>
                          <div className="text-white text-xs space-y-1 break-all">
                            {task.config.targetPaths.map((path, idx) => (
                              <div key={idx}>{path}</div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="text-gray-400 mb-1">{task.config.action === 'delete' ? 'Goes to:' : 'Archive folder:'}</div>
                          <div className="text-white text-xs break-all">
                            {task.config.action === 'delete' ? 'Recycle Bin (restorable)' : task.config.destination}
                          </div>
                        </div>
                        <div>
                          <div className="text-gray-400 mb-1">Last run:</div>
                          <div className="text-white">
                            {task.lastRun ? new Date(task.lastRun).toLocaleString() : 'Never'}
                            {task.lastResult && (
                              <span className={task.lastResult.failed ? 'text-yellow-400' : 'text-green-400'}>
                                {' '}
                                • {task.lastResult.processed} processed
                                {task.lastResult.failed ? `, ${task.lastResult.failed} failed${task.lastResult.error ? ` (${task.lastResult.error})` : ''}` : ''}
                              </span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="text-gray-400 mb-1">Next run:</div>
                          <div className="text-white">
                            {task.enabled && task.nextRun ? new Date(task.nextRun).toLocaleString() : 'Paused'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={() => setShowPresets(true)}
                    className="w-full py-3 border-2 border-dashed border-gray-600 hover:border-blue-500 text-gray-400 hover:text-white rounded-lg transition-all"
                  >
                    ➕ Add New Scheduled Task
                  </button>
                </div>
              )}
            </>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-white">Choose a Template</h3>
                <button onClick={() => setShowPresets(false)} className="text-gray-400 hover:text-white">
                  ← Back
                </button>
              </div>

              {presets.length === 0 && (
                <div className="text-sm text-gray-400 mb-4">Templates need the desktop app (they use your real Desktop and Downloads folders).</div>
              )}
              {(
                <div className="grid grid-cols-2 gap-4">
                  <div
                    className="p-4 bg-gray-700 rounded-lg border border-dashed border-gray-500 hover:border-blue-500 transition-all cursor-pointer"
                    onClick={() => setFormTask(null)}
                  >
                    <h4 className="text-white font-medium mb-2">🛠 Build a custom task</h4>
                    <p className="text-sm text-gray-400 mb-3">Pick your own folders, age, file types, archive folder and schedule.</p>
                    <span className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Custom</span>
                  </div>
                  {presets.map((preset, idx) => (
                    <div
                      key={idx}
                      className="p-4 bg-gray-700 rounded-lg border border-gray-600 hover:border-blue-500 transition-all cursor-pointer"
                      onClick={() => handleCreateFromPreset(preset)}
                    >
                      <h4 className="text-white font-medium mb-2">{preset.name}</h4>
                      <p className="text-sm text-gray-400 mb-3">{preset.description}</p>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500">{ScheduleEngine.describeSchedule(preset.schedule)}</span>
                        <span className="px-2 py-1 bg-blue-600 text-white rounded">Use Template</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6 p-4 bg-blue-900/20 border border-blue-700 rounded-lg">
                <div className="text-sm text-blue-200 font-medium mb-2">💡 About Scheduled Tasks:</div>
                <div className="text-xs text-blue-300 space-y-1">
                  <div>• Tasks run while DeskFence is running; if the PC was off at the scheduled time, a task runs once when the app starts</div>
                  <div>• Only items older than the number of days you set are touched (by last-modified date)</div>
                  <div>• Archiving moves items, nothing is overwritten; deleting uses the Recycle Bin so you can restore</div>
                  <div>• System folders and whole drives are always skipped</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-700 bg-gray-750">
          <div className="text-sm text-gray-400">{tasks.filter((t) => t.enabled).length} active tasks</div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScheduledTasksDialog;
