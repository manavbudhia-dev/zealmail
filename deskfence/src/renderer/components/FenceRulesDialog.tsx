import React, { useState } from 'react';
import { useFenceStore } from '../store/fenceStore';
import { RuleEngine } from '../utils/rule-engine';
import RuleBuilderDialog from './RuleBuilderDialog';
import { QUICK_RULES, makeQuickRule, type QuickRule } from '../utils/quick-rules';
import { previewExistingFiles, sortExistingFiles } from '../utils/rule-runner';
import type { AutomationRule, Fence } from '../../shared/types';

interface FenceRulesDialogProps {
  fenceId: string;
  onClose: () => void;
}

/** Rules that belong to ONE fence: matching files from the watched folders land in this fence. */
const FenceRulesDialog: React.FC<FenceRulesDialogProps> = ({ fenceId, onClose }) => {
  const fence = useFenceStore((state) => state.fences.find((f) => f.id === fenceId)) as Fence | undefined;
  const { updateFence, saveFences } = useFenceStore.getState();
  const [editing, setEditing] = useState<AutomationRule | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!fence) return null;
  const rules = fence.rules || [];

  const setRules = (next: AutomationRule[]) => {
    updateFence(fence.id, { rules: next });
    saveFences();
  };

  // Applies rules to what is ALREADY in their folders (new files are handled as they arrive)
  const sortNow = async (only: AutomationRule[], askFirst: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const scoped = only.map((r) => ({ ...r, targetFenceId: fence.id }));
      const planned = await previewExistingFiles(scoped);
      if (planned.length === 0) {
        setMessage('Nothing to sort right now: no item in the watched folder matches.');
        return;
      }
      if (askFirst && !confirm(`Move the ${planned.length} matching item(s) that are already there into “${fence.name}” now?`)) return;
      const { moved } = await sortExistingFiles(scoped);
      setMessage(`${moved} item(s) moved into “${fence.name}”.`);
    } catch (error) {
      setMessage(`Sorting failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const addQuickRule = async (quick: QuickRule) => {
    const desktop = await window.electronAPI.getKnownPath('desktop');
    if (!desktop) return alert('Could not find your Desktop folder.');
    try {
      await window.electronAPI.watchFolder(desktop);
    } catch (error) {
      return alert(`Cannot watch the Desktop: ${error instanceof Error ? error.message : String(error)}`);
    }
    const rule = makeQuickRule(quick, fence.id, desktop);
    const latest = useFenceStore.getState().fences.find((f) => f.id === fence.id);
    updateFence(fence.id, { rules: [...(latest?.rules || []), rule] });
    await saveFences();
    await sortNow([rule], true);
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
            <div>
              <h2 className="text-xl font-semibold text-white">Rules for “{fence.name}”</h2>
              <p className="text-sm text-gray-400 mt-1">
                New files that match are moved or copied into this fence • runs while DeskFence is running
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-auto p-6 space-y-3">
            <div>
              <div className="text-sm text-gray-300 mb-2">Quick rules: collect from the Desktop</div>
              <div className="flex flex-wrap gap-2">
                {QUICK_RULES.map((quick) => {
                  const has = rules.some((r) => r.preset === quick.key);
                  return (
                    <button
                      key={quick.key}
                      disabled={has || busy}
                      onClick={() => addQuickRule(quick)}
                      className="px-3 py-1.5 text-sm rounded-full bg-gray-700 hover:bg-gray-600 text-white disabled:opacity-40"
                      title={has ? 'Already a rule of this fence' : `New ${quick.label.toLowerCase()} on the Desktop go into this fence`}
                    >
                      {quick.emoji} {quick.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {message && <div className="p-3 rounded bg-gray-700/50 text-sm text-gray-300">{message}</div>}

            {rules.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                <div className="text-4xl mb-3">⚡</div>
                <div className="text-sm">No rules for this fence yet.</div>
                <div className="text-xs mt-1">Example: “extension equals pdf” watching your Downloads folder.</div>
              </div>
            )}

            {rules.map((rule) => (
              <div
                key={rule.id}
                className={`p-4 rounded-lg border-2 ${rule.enabled ? 'bg-gray-700 border-green-500' : 'bg-gray-700 border-gray-600 opacity-60'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={() => setRules(rules.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)))}
                      className="w-5 h-5 mt-0.5"
                      title={rule.enabled ? 'Pause this rule' : 'Enable this rule'}
                    />
                    <div>
                      <div className="text-white font-medium">{rule.name}</div>
                      <div className="text-xs text-gray-400 mt-1">{RuleEngine.describeRule(rule)}</div>
                      <div className="text-xs text-gray-400 mt-1 break-all">
                        Watching: {(rule.watchPaths || []).join(', ') || 'no folder yet'}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => sortNow([rule], true)}
                      disabled={busy || !rule.enabled}
                      className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-40"
                      title="Apply this rule to the items already in its folder"
                    >
                      Sort now
                    </button>
                    <button
                      onClick={() => setEditing(rule)}
                      className="px-3 py-1 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete the rule "${rule.name}"?`)) setRules(rules.filter((r) => r.id !== rule.id));
                      }}
                      className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 text-white rounded"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}

            <button
              onClick={() => setEditing('new')}
              className="w-full py-3 border-2 border-dashed border-gray-600 hover:border-blue-500 text-gray-400 hover:text-white rounded-lg transition-all"
            >
              ➕ Add rule for this fence
            </button>
          </div>

          <div className="flex justify-end px-6 py-4 border-t border-gray-700">
            <button onClick={onClose} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors">
              Done
            </button>
          </div>
        </div>
      </div>

      {editing && (
        <RuleBuilderDialog
          scopedFenceId={fence.id}
          existingRule={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
};

export default FenceRulesDialog;
