import React, { useState } from 'react';
import { ScheduleEngine } from '../utils/schedule-engine';
import type { ScheduledTask } from '../utils/schedule-engine';
import { buildCron, specFromCron, validateSchedule, pad } from '../utils/schedule-builder';
import type { ScheduleSpec } from '../utils/schedule-builder';
import { baseName } from '../utils/fence-files';
import { cleanIpcError } from '../utils/portal';

interface ScheduledTaskFormProps {
  task?: ScheduledTask; // editing when set, creating when not
  onSave: (task: ScheduledTask) => void;
  onCancel: () => void;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const inputClass = 'w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 outline-none';

const ScheduledTaskForm: React.FC<ScheduledTaskFormProps> = ({ task, onSave, onCancel }) => {
  const [name, setName] = useState(task?.name ?? '');
  const [folders, setFolders] = useState<string[]>(task?.config.targetPaths ?? []);
  const [action, setAction] = useState<'archive' | 'delete'>(task?.config.action === 'delete' ? 'delete' : 'archive');
  const [destination, setDestination] = useState(task?.config.destination ?? '');
  const [olderThan, setOlderThan] = useState(task?.config.olderThan ?? 30);
  const [extensions, setExtensions] = useState((task?.config.extensions ?? []).join(', '));
  const [spec, setSpec] = useState<ScheduleSpec>(task ? specFromCron(task.schedule) : { mode: 'weekly', days: [0], time: '03:00' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cron = buildCron(spec);
  const scheduleError = validateSchedule(spec);
  const next = scheduleError ? null : ScheduleEngine.getNextRunTime(cron);

  const addFolder = async () => {
    const picked = await window.electronAPI.selectFolder(folders[folders.length - 1]);
    if (picked && !folders.includes(picked)) setFolders([...folders, picked]);
  };

  const pickDestination = async () => {
    const picked = await window.electronAPI.selectFolder(destination || folders[0]);
    if (picked) setDestination(picked);
  };

  const parsedExtensions = extensions
    .split(/[,\s]+/)
    .map((e) => e.replace(/^\./, '').trim().toLowerCase())
    .filter(Boolean);

  const setMode = (mode: ScheduleSpec['mode']) => {
    switch (mode) {
      case 'minutes': return setSpec({ mode, every: 15 });
      case 'hours': return setSpec({ mode, every: 6 });
      case 'daily': return setSpec({ mode, time: '03:00' });
      case 'weekly': return setSpec({ mode, days: [0], time: '03:00' });
      case 'monthly': return setSpec({ mode, day: 1, time: '03:00' });
      case 'custom': return setSpec({ mode, cron });
    }
  };

  const timeOf = (s: ScheduleSpec) => ('time' in s ? s.time : '03:00');

  const handleSave = async () => {
    setError(null);
    if (!name.trim()) return setError('Give the task a name.');
    if (folders.length === 0) return setError('Choose at least one folder to clean.');
    if (action === 'archive' && !destination.trim()) return setError('Choose the archive folder the items should be moved to.');
    if (!(olderThan >= 1)) return setError('"Older than" must be at least 1 day.');
    if (scheduleError) return setError(scheduleError);

    const config: ScheduledTask['config'] = {
      targetPaths: folders,
      olderThan: Math.round(olderThan),
      action,
      destination: action === 'archive' ? destination.trim() : undefined,
      extensions: parsedExtensions.length ? parsedExtensions : undefined,
    };

    // Show exactly what this task would touch right now before it is saved
    setBusy(true);
    try {
      const preview = await window.electronAPI.runCleanup({
        targetPaths: config.targetPaths,
        olderThanDays: config.olderThan,
        action: config.action,
        destination: config.destination,
        extensions: config.extensions,
        dryRun: true,
      });
      const blocked = preview.failed.find((f) => /Protected/.test(f.error));
      if (blocked) return setError(`"${baseName(blocked.path)}" is a protected system folder or a whole drive and cannot be used.`);

      const names = preview.matched.slice(0, 6).map((f) => `• ${f.name}`).join('\n');
      const more = preview.matched.length > 6 ? `\n…and ${preview.matched.length - 6} more` : '';
      const effect = action === 'delete' ? 'sent to the Recycle Bin' : `moved to ${config.destination}`;
      const summary = preview.matched.length
        ? `Right now ${preview.matched.length} item(s) would be ${effect}:\n\n${names}${more}`
        : 'Right now nothing matches, so nothing would be touched.';
      if (!confirm(`${task ? 'Save changes to' : 'Create'} "${name.trim()}"?\n\nIt will run: ${ScheduleEngine.describeSchedule(cron)}.\n\n${summary}`)) return;
    } catch (err) {
      return setError(cleanIpcError(err, 'Could not check the folders.'));
    } finally {
      setBusy(false);
    }

    onSave({
      id: task?.id ?? `task-${Date.now()}`,
      name: name.trim(),
      type: 'cleanup',
      enabled: task?.enabled ?? true,
      schedule: cron,
      lastRun: task?.lastRun,
      lastResult: task?.lastResult,
      nextRun: ScheduleEngine.getNextRunTime(cron)?.getTime(),
      config,
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-white">{task ? 'Edit task' : 'Build a custom task'}</h3>
        <button onClick={onCancel} className="text-gray-400 hover:text-white">← Back</button>
      </div>

      {error && <div className="p-3 bg-red-900/30 border border-red-700 rounded text-sm text-red-200">{error}</div>}

      <div>
        <label className="block text-sm text-gray-300 mb-1">Name *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Clear old screenshots" className={inputClass} />
      </div>

      <div>
        <label className="block text-sm text-gray-300 mb-1">Folders to clean *</label>
        <div className="space-y-2">
          {folders.map((folder) => (
            <div key={folder} className="flex items-center gap-2 text-sm">
              <div className="flex-1 px-3 py-2 bg-gray-700 text-white rounded break-all">{folder}</div>
              <button onClick={() => setFolders(folders.filter((f) => f !== folder))} className="px-2 py-1 text-red-400 hover:text-red-300" title="Remove folder">✕</button>
            </div>
          ))}
          <button onClick={addFolder} className="px-3 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded">📂 Choose folder…</button>
          <p className="text-xs text-gray-400">Only the items directly inside the folder are looked at (not sub-folder contents). System folders and whole drives are refused.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-300 mb-1">Only items older than (days) *</label>
          <input type="number" min={1} value={olderThan} onChange={(e) => setOlderThan(parseInt(e.target.value) || 0)} className={inputClass} />
          <p className="text-xs text-gray-400 mt-1">Based on last-modified date.</p>
        </div>
        <div>
          <label className="block text-sm text-gray-300 mb-1">Only these file types (optional)</label>
          <input value={extensions} onChange={(e) => setExtensions(e.target.value)} placeholder="tmp, log, zip" className={inputClass} />
          <p className="text-xs text-gray-400 mt-1">Leave empty for everything. Folders are skipped when a type is set.</p>
        </div>
      </div>

      <div>
        <label className="block text-sm text-gray-300 mb-1">What to do</label>
        <select value={action} onChange={(e) => setAction(e.target.value as 'archive' | 'delete')} className={inputClass}>
          <option value="archive">Move to an archive folder</option>
          <option value="delete">Send to the Recycle Bin (restorable)</option>
        </select>
        {action === 'archive' && (
          <div className="flex items-center gap-2 mt-2">
            <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Archive folder" className={inputClass} />
            <button onClick={pickDestination} className="px-3 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded whitespace-nowrap">📂 Browse…</button>
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm text-gray-300 mb-1">When to run</label>
        <select value={spec.mode} onChange={(e) => setMode(e.target.value as ScheduleSpec['mode'])} className={inputClass}>
          <option value="minutes">Every few minutes</option>
          <option value="hours">Every few hours</option>
          <option value="daily">Every day</option>
          <option value="weekly">On certain weekdays</option>
          <option value="monthly">Once a month</option>
          <option value="custom">Advanced (cron expression)</option>
        </select>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-300">
          {spec.mode === 'minutes' && (
            <>Every <input type="number" min={1} max={59} value={spec.every} onChange={(e) => setSpec({ mode: 'minutes', every: parseInt(e.target.value) || 1 })} className="w-20 px-2 py-1 bg-gray-700 text-white rounded border border-gray-600" /> minute(s)</>
          )}
          {spec.mode === 'hours' && (
            <>Every <input type="number" min={1} max={23} value={spec.every} onChange={(e) => setSpec({ mode: 'hours', every: parseInt(e.target.value) || 1 })} className="w-20 px-2 py-1 bg-gray-700 text-white rounded border border-gray-600" /> hour(s)</>
          )}
          {(spec.mode === 'daily' || spec.mode === 'weekly' || spec.mode === 'monthly') && (
            <>
              {spec.mode === 'monthly' && (
                <>On day <input type="number" min={1} max={31} value={spec.day} onChange={(e) => setSpec({ ...spec, day: parseInt(e.target.value) || 1 })} className="w-20 px-2 py-1 bg-gray-700 text-white rounded border border-gray-600" /> of the month</>
              )}
              at <input type="time" value={timeOf(spec)} onChange={(e) => setSpec({ ...spec, time: e.target.value || '00:00' } as ScheduleSpec)} className="px-2 py-1 bg-gray-700 text-white rounded border border-gray-600" />
            </>
          )}
          {spec.mode === 'weekly' && (
            <div className="flex gap-1 w-full">
              {DAYS.map((label, index) => {
                const on = spec.days.includes(index);
                return (
                  <button
                    key={label}
                    onClick={() => setSpec({ ...spec, days: on ? spec.days.filter((d) => d !== index) : [...spec.days, index] })}
                    className={`px-2 py-1 rounded text-xs ${on ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          {spec.mode === 'custom' && (
            <input value={spec.cron} onChange={(e) => setSpec({ mode: 'custom', cron: e.target.value })} placeholder="0 3 * * 0" className={inputClass} />
          )}
        </div>

        <p className={`text-xs mt-2 ${scheduleError ? 'text-red-400' : 'text-gray-400'}`}>
          {scheduleError ?? `${ScheduleEngine.describeSchedule(cron)} • next run: ${next ? next.toLocaleString() : 'never'} • cron: ${cron}`}
        </p>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button onClick={onCancel} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded">Cancel</button>
        <button onClick={handleSave} disabled={busy} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50">
          {busy ? 'Checking…' : task ? 'Save changes' : 'Preview & create'}
        </button>
      </div>
    </div>
  );
};

export default ScheduledTaskForm;
