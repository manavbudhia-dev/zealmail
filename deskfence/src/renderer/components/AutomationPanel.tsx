import React, { useState } from 'react';
import { useAutomationStore } from '../store/automationStore';
import { useFenceStore } from '../store/fenceStore';
import { RuleEngine } from '../utils/rule-engine';
import RuleBuilderDialog from './RuleBuilderDialog';
import { previewExistingFiles, sortExistingFiles } from '../utils/rule-runner';
import type { AutomationRule } from '../../shared/types';

interface AutomationPanelProps {
  onClose: () => void;
}

/** Global automation rules: new files in watched folders that match go into the chosen fence. */
const AutomationPanel: React.FC<AutomationPanelProps> = ({ onClose }) => {
  const { rules, toggleRule, deleteRule } = useAutomationStore();
  const fences = useFenceStore((state) => state.fences);
  const [editing, setEditing] = useState<AutomationRule | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sortEverythingNow = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const planned = await previewExistingFiles();
      if (planned.length === 0) return setMessage('Nothing to sort: no item in a watched folder matches a rule.');
      if (!confirm(`Apply all rules to what is already in their folders?\n\n${planned.length} item(s) will be moved into fences.`)) return;
      const { moved } = await sortExistingFiles();
      setMessage(`${moved} item(s) moved into fences.`);
    } catch (error) {
      setMessage(`Sorting failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const fenceName = (id: string) => fences.find((f) => f.id === id)?.name;
  const perFenceCount = fences.reduce((n, f) => n + (f.rules?.length || 0), 0);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
            <div>
              <h2 className="text-xl font-semibold text-white">Automation Rules</h2>
              <p className="text-sm text-gray-400 mt-1">
                New files that match a rule are moved or copied into a fence • runs while DeskFence is running
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-auto p-6 space-y-3">
            {message && <div className="p-3 rounded bg-gray-700/50 text-sm text-gray-300">{message}</div>}
            {perFenceCount > 0 && (
              <div className="text-xs text-gray-400">
                {perFenceCount} more rule(s) belong to single fences: open them with ⚡ on that fence. Those run first.
              </div>
            )}

            {rules.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                <div className="text-4xl mb-3">⚡</div>
                <div className="text-sm">No global rules yet.</div>
                <div className="text-xs mt-1">Example: PDFs that appear in Downloads go to your “Documents” fence.</div>
              </div>
            )}

            {rules.map((rule) => {
              const target = fenceName(rule.targetFenceId);
              return (
                <div
                  key={rule.id}
                  className={`p-4 rounded-lg border-2 ${rule.enabled ? 'bg-gray-700 border-green-500' : 'bg-gray-700 border-gray-600 opacity-60'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={() => toggleRule(rule.id)}
                        className="w-5 h-5 mt-0.5"
                        title={rule.enabled ? 'Pause this rule' : 'Enable this rule'}
                      />
                      <div>
                        <div className="text-white font-medium">{rule.name}</div>
                        <div className="text-xs text-gray-400 mt-1">{RuleEngine.describeRule(rule)}</div>
                        <div className="text-xs mt-1">
                          {target ? (
                            <span className="text-gray-300">Into fence: {target}</span>
                          ) : (
                            <span className="text-yellow-400">Target fence no longer exists: this rule does nothing</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 mt-1 break-all">
                          Watching: {(rule.watchPaths || []).join(', ') || 'no folder yet'}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => setEditing(rule)}
                        className="px-3 py-1 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete the rule "${rule.name}"?`)) deleteRule(rule.id);
                        }}
                        className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 text-white rounded"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            <button
              onClick={() => {
                if (fences.length === 0) return alert('Create a fence first: a rule needs a fence to put files into.');
                setEditing('new');
              }}
              className="w-full py-3 border-2 border-dashed border-gray-600 hover:border-blue-500 text-gray-400 hover:text-white rounded-lg transition-all"
            >
              ➕ Add rule
            </button>
          </div>

          <div className="flex justify-between px-6 py-4 border-t border-gray-700">
            <button
              onClick={sortEverythingNow}
              disabled={busy}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors disabled:opacity-50"
              title="Rules handle new files as they arrive; this sorts the items already there"
            >
              {busy ? 'Sorting…' : 'Sort existing files now'}
            </button>
            <button onClick={onClose} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors">
              Done
            </button>
          </div>
        </div>
      </div>

      {editing && (
        <RuleBuilderDialog existingRule={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
};

export default AutomationPanel;
