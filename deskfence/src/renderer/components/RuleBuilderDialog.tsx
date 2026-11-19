import React, { useEffect, useState } from 'react';
import { useFenceStore } from '../store/fenceStore';
import { useAutomationStore } from '../store/automationStore';
import { cleanIpcError } from '../utils/portal';
import type { AutomationRule, RuleCondition } from '../../shared/types';

interface RuleBuilderDialogProps {
  onClose: () => void;
  existingRule?: AutomationRule;
  /** When set, the rule belongs to this fence (stored on the fence) and always targets it. */
  scopedFenceId?: string;
}

const RuleBuilderDialog: React.FC<RuleBuilderDialogProps> = ({ onClose, existingRule, scopedFenceId }) => {
  const { fences, updateFence, saveFences } = useFenceStore();
  const scopedFence = scopedFenceId ? fences.find((f) => f.id === scopedFenceId) : undefined;
  const { addRule, updateRule } = useAutomationStore();
  const [rule, setRule] = useState<Partial<AutomationRule>>(existingRule || {
    name: '',
    enabled: true,
    conditions: [],
    action: 'move',
    targetFenceId: scopedFenceId || fences[0]?.id || '',
    watchPaths: [],
  });

  // A new per-fence rule starts with the Desktop as its watched folder (easy to change)
  useEffect(() => {
    if (!scopedFenceId || existingRule) return;
    window.electronAPI.getKnownPath('desktop').then((desktop) => {
      if (desktop) setRule((current) => ((current.watchPaths || []).length ? current : { ...current, watchPaths: [desktop] }));
    });
  }, []);

  const [newCondition, setNewCondition] = useState<RuleCondition>({
    type: 'extension',
    operator: 'equals',
    value: '',
  });

  const conditionTypes = [
    { value: 'extension', label: 'File Extension' },
    { value: 'name', label: 'File Name' },
    { value: 'size', label: 'File Size' },
    { value: 'date', label: 'Date Modified' },
    { value: 'path', label: 'Source Path' },
  ];

  const operators = {
    extension: ['equals', 'contains'],
    name: ['equals', 'contains', 'startsWith', 'endsWith', 'matches'],
    size: ['equals', 'greaterThan', 'lessThan'],
    date: ['equals', 'greaterThan', 'lessThan'],
    path: ['equals', 'contains', 'startsWith'],
  };

  const handleAddCondition = () => {
    if (!newCondition.value) {
      alert('Please enter a value for the condition');
      return;
    }

    setRule({
      ...rule,
      conditions: [...(rule.conditions || []), newCondition],
    });

    setNewCondition({
      type: 'extension',
      operator: 'equals',
      value: '',
    });
  };

  const handleRemoveCondition = (index: number) => {
    const conditions = rule.conditions || [];
    setRule({
      ...rule,
      conditions: conditions.filter((_, i) => i !== index),
    });
  };

  const handleAddWatchPath = async () => {
    // Native folder picker (window.prompt() is not supported inside Electron)
    const path = await window.electronAPI.selectFolder();
    if (path && !(rule.watchPaths || []).includes(path)) {
      setRule({
        ...rule,
        watchPaths: [...(rule.watchPaths || []), path],
      });
    }
  };

  const handleRemoveWatchPath = (index: number) => {
    const watchPaths = rule.watchPaths || [];
    setRule({
      ...rule,
      watchPaths: watchPaths.filter((_, i) => i !== index),
    });
  };

  const handleSave = async () => {
    if (!rule.name?.trim()) {
      alert('Please enter a rule name');
      return;
    }

    if (!rule.conditions || rule.conditions.length === 0) {
      alert('Please add at least one condition');
      return;
    }

    if (!rule.targetFenceId) {
      alert('Please select a target fence');
      return;
    }

    // Start watching paths first so a bad folder is reported before the rule is saved
    for (const path of rule.watchPaths || []) {
      try {
        await window.electronAPI.watchFolder(path);
      } catch (error) {
        alert(`Cannot watch "${path}": ${cleanIpcError(error, 'folder is not available')}`);
        return;
      }
    }

    // The rule used to be dropped here (only logged), so automation never had any rules
    const saved: AutomationRule = {
      id: existingRule?.id || `rule-${Date.now()}`,
      name: rule.name.trim(),
      enabled: rule.enabled ?? true,
      conditions: rule.conditions,
      action: rule.action || 'move',
      targetFenceId: scopedFence ? scopedFence.id : rule.targetFenceId,
      schedule: rule.schedule,
      watchPaths: rule.watchPaths || [],
    };

    if (scopedFence) {
      // stored on the fence itself (fences.json), so it follows the fence everywhere
      const current = scopedFence.rules || [];
      const next = existingRule ? current.map((r) => (r.id === existingRule.id ? saved : r)) : [...current, saved];
      updateFence(scopedFence.id, { rules: next });
      await saveFences();
    } else if (existingRule) {
      updateRule(existingRule.id, saved);
    } else {
      addRule(saved);
    }

    onClose();
  };

  const getConditionLabel = (condition: RuleCondition) => {
    const typeLabel = conditionTypes.find(t => t.value === condition.type)?.label;
    const operatorLabel = condition.operator.replace(/([A-Z])/g, ' $1').toLowerCase();
    return `${typeLabel} ${operatorLabel} "${condition.value}"`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div>
            <h2 className="text-xl font-semibold text-white">
              {existingRule ? 'Edit Automation Rule' : 'New Automation Rule'}
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              Automatically organize files based on conditions
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-6">
          {/* Rule Name */}
          <div>
            <label className="block text-sm text-gray-300 mb-2">
              Rule Name *
            </label>
            <input
              type="text"
              value={rule.name || ''}
              onChange={(e) => setRule({ ...rule, name: e.target.value })}
              placeholder="e.g., Move PDFs to Documents"
              className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 outline-none"
            />
          </div>

          {/* Enabled Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-gray-300 font-medium">Rule Enabled</label>
              <p className="text-xs text-gray-400">Activate this rule immediately</p>
            </div>
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={(e) => setRule({ ...rule, enabled: e.target.checked })}
              className="w-5 h-5"
            />
          </div>

          <hr className="border-gray-700" />

          {/* Conditions */}
          <div>
            <h3 className="text-lg font-medium text-white mb-3">Conditions</h3>
            <p className="text-sm text-gray-400 mb-4">
              Files must match ALL conditions to trigger this rule
            </p>

            {/* Existing Conditions */}
            {rule.conditions && rule.conditions.length > 0 && (
              <div className="space-y-2 mb-4">
                {rule.conditions.map((condition, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 bg-gray-700 rounded"
                  >
                    <div className="text-sm text-white">
                      {getConditionLabel(condition)}
                    </div>
                    <button
                      onClick={() => handleRemoveCondition(index)}
                      className="text-red-400 hover:text-red-300 text-sm"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add New Condition */}
            <div className="bg-gray-750 p-4 rounded border border-gray-600">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Type</label>
                  <select
                    value={newCondition.type}
                    onChange={(e) => setNewCondition({
                      ...newCondition,
                      type: e.target.value as any,
                      operator: 'equals',
                    })}
                    className="w-full px-2 py-2 bg-gray-700 text-white text-sm rounded border border-gray-600 outline-none"
                  >
                    {conditionTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Operator</label>
                  <select
                    value={newCondition.operator}
                    onChange={(e) => setNewCondition({ ...newCondition, operator: e.target.value as any })}
                    className="w-full px-2 py-2 bg-gray-700 text-white text-sm rounded border border-gray-600 outline-none"
                  >
                    {operators[newCondition.type as keyof typeof operators]?.map((op) => (
                      <option key={op} value={op}>
                        {op.replace(/([A-Z])/g, ' $1')}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Value</label>
                  <input
                    type="text"
                    value={newCondition.value}
                    onChange={(e) => setNewCondition({ ...newCondition, value: e.target.value })}
                    placeholder={
                      newCondition.type === 'extension' ? '.pdf' :
                      newCondition.type === 'size' ? 'e.g. 10MB or 500KB' :
                      newCondition.type === 'date' ? (newCondition.operator === 'equals' ? 'YYYY-MM-DD' : 'days, e.g. 7') :
                      'value'
                    }
                    className="w-full px-2 py-2 bg-gray-700 text-white text-sm rounded border border-gray-600 outline-none"
                  />
                </div>
              </div>

              {newCondition.type === 'date' && (
                <p className="mt-2 text-xs text-gray-400">
                  Date = last modified. “greater than 7” means older than 7 days, “less than 7” means changed within the last 7 days, “equals” takes a day like 2026-10-05.
                </p>
              )}

              <button
                onClick={handleAddCondition}
                className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
              >
                ➕ Add Condition
              </button>
            </div>
          </div>

          <hr className="border-gray-700" />

          {/* Action */}
          <div>
            <h3 className="text-lg font-medium text-white mb-3">Action</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-300 mb-2">
                  Action Type
                </label>
                <select
                  value={rule.action}
                  onChange={(e) => setRule({ ...rule, action: e.target.value as any })}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 outline-none"
                >
                  <option value="move">Move to fence</option>
                  <option value="copy">Copy to fence</option>
                  <option value="organize">Organize in fence</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-2">
                  Target Fence *
                </label>
                {scopedFence ? (
                  <div className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600">
                    {scopedFence.name} (this fence)
                  </div>
                ) : (
                  <select
                    value={rule.targetFenceId}
                    onChange={(e) => setRule({ ...rule, targetFenceId: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 outline-none"
                  >
                    {fences.map((fence) => (
                      <option key={fence.id} value={fence.id}>
                        {fence.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>

          <hr className="border-gray-700" />

          {/* Watch Paths */}
          <div>
            <h3 className="text-lg font-medium text-white mb-3">Watch Folders</h3>
            <p className="text-sm text-gray-400 mb-4">
              Monitor these folders for new files matching the conditions
            </p>

            {rule.watchPaths && rule.watchPaths.length > 0 && (
              <div className="space-y-2 mb-4">
                {rule.watchPaths.map((path, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 bg-gray-700 rounded"
                  >
                    <div className="text-sm text-white break-all">{path}</div>
                    <button
                      onClick={() => handleRemoveWatchPath(index)}
                      className="text-red-400 hover:text-red-300 text-sm ml-4"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={handleAddWatchPath}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-colors"
            >
              📁 Add Watch Folder
            </button>
          </div>

          {/* Examples */}
          <div className="p-4 bg-blue-900/20 border border-blue-700 rounded">
            <div className="text-sm text-blue-200 font-medium mb-2">💡 Example Rules:</div>
            <div className="text-xs text-blue-300 space-y-1">
              <div>• Move all PDFs from Downloads to "Documents" fence</div>
              <div>• Copy images (png, jpg) to "Photos" fence when added to Desktop</div>
              <div>• Organize files by extension in "Sorted" fence</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-700 bg-gray-750">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
          >
            {existingRule ? 'Update Rule' : 'Create Rule'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RuleBuilderDialog;
