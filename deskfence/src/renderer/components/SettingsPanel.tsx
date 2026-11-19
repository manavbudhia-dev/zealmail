import React, { useState, useEffect } from 'react';
import { useFenceStore } from '../store/fenceStore';
import type { Fence } from '../../shared/types';
import { applyTheme } from '../utils/theme';
import { allFenceItems } from '../utils/fence-tabs';
import { applyFocusLayout, fencesOnThisMonitor } from '../utils/focus-layout';

interface SettingsPanelProps {
  onClose: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
  const { fences, setFences, saveFences } = useFenceStore();
  const [settings, setSettings] = useState({
    globalHotkey: 'CommandOrControl+Space',
    autoStart: false,
    theme: 'auto' as 'light' | 'dark' | 'auto',
    hideDesktopIcons: false,
    dropFolderToFence: true,
    drawToCreate: true,
  });
  const [iconsMessage, setIconsMessage] = useState<string | null>(null);
  const [iconsBusy, setIconsBusy] = useState(false);

  useEffect(() => {
    window.electronAPI
      .getSettings()
      // merge so a missing/partial settings object can't leave fields undefined and crash the form
      .then((loaded) => setSettings((current) => ({ ...current, ...(loaded || {}) })))
      .catch((error) => console.error('Failed to load settings:', error));
  }, []);

  // Theme applies and is saved immediately so you can see the result
  const handleThemeChange = async (theme: 'light' | 'dark' | 'auto') => {
    setSettings((current) => ({ ...current, theme }));
    applyTheme(theme);
    await window.electronAPI.saveSettings({ theme });
  };

  // Hiding the real Desktop icons changes Windows itself, so it is applied right away and verified
  const handleHideIconsChange = async (hide: boolean) => {
    setIconsBusy(true);
    setIconsMessage(null);
    try {
      const result = await window.electronAPI.saveSettings({ hideDesktopIcons: hide });
      const icons = result.desktopIcons;
      if (icons && !icons.success) {
        setIconsMessage(icons.error || 'Could not change the Desktop icons.');
        setSettings((current) => ({ ...current, hideDesktopIcons: !hide }));
        await window.electronAPI.saveSettings({ hideDesktopIcons: !hide });
      } else {
        setSettings((current) => ({ ...current, hideDesktopIcons: hide }));
        setIconsMessage(hide ? 'Desktop icons hidden. They come back when DeskFence quits.' : 'Desktop icons shown.');
      }
    } finally {
      setIconsBusy(false);
    }
  };

  // ---- Layout preset ----
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [layoutMessage, setLayoutMessage] = useState('');

  const handleApplyFocusLayout = async () => {
    const current = fencesOnThisMonitor();
    const intro = current.length > 0
      ? `Replace the ${current.length} fence(s) on this monitor with the "Focus" layout?\n\n` +
        '• Files you moved into those fences go back to your Desktop.\n' +
        '• Shortcut-only items just leave the fences; nothing is deleted.\n' +
        '• A backup of your fence list is saved first.'
      : 'Create the "Focus" layout on this monitor (10 fences)?';
    if (!confirm(intro)) return;

    setLayoutBusy(true);
    setLayoutMessage('Building the layout and looking up your apps…');
    try {
      const result = await applyFocusLayout();
      const lines = [`Created ${result.fences} fences with ${result.items} items.`];
      if (result.missing.length > 0) lines.push(`Not found on this PC (add them by dragging them onto the fence): ${result.missing.join(', ')}.`);
      if (result.kept.length > 0) lines.push(`Left in place because their files could not be moved back: ${result.kept.join(', ')}.`);
      setLayoutMessage(lines.join('\n'));
    } catch (error) {
      setLayoutMessage(`The layout could not be applied: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLayoutBusy(false);
    }
  };

  // Applies right away, like the theme
  const handleDropFolderChange = async (enabled: boolean) => {
    setSettings((current) => ({ ...current, dropFolderToFence: enabled }));
    await window.electronAPI.saveSettings({ dropFolderToFence: enabled });
  };

  const handleDrawChange = async (enabled: boolean) => {
    setSettings((current) => ({ ...current, drawToCreate: enabled }));
    await window.electronAPI.saveSettings({ drawToCreate: enabled });
  };

  const handleSave = async () => {
    await window.electronAPI.saveSettings(settings);
    onClose();
  };

  const importConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow importing the same file twice
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const config = JSON.parse(String(reader.result));
        if (!Array.isArray(config.fences)) throw new Error('missing "fences" list');
        const valid = config.fences.every(
          (f: Partial<Fence>) => f && f.id && f.position && f.size && Array.isArray(f.items) && f.style
        );
        if (!valid) throw new Error('some fences are incomplete');
        if (!confirm(`Replace your ${fences.length} current fence(s) with ${config.fences.length} imported fence(s)?`)) return;

        setFences(config.fences);
        await saveFences();
        if (config.settings) setSettings((current) => ({ ...current, ...config.settings }));
      } catch (error) {
        alert(`Could not import this file: ${error instanceof Error ? error.message : 'invalid JSON'}`);
      }
    };
    reader.readAsText(file);
  };

  const exportConfig = () => {
    const config = {
      fences,
      settings,
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deskfence-config-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-6">
          {/* General Settings */}
          <section>
            <h3 className="text-lg font-medium text-white mb-4">General</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-2">
                  Global Hotkey
                </label>
                <input
                  type="text"
                  value={settings.globalHotkey}
                  onChange={(e) => setSettings({ ...settings, globalHotkey: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 outline-none"
                  placeholder="CommandOrControl+Space"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Hotkey to toggle peek mode
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm text-gray-300">Start on Boot</label>
                  <p className="text-xs text-gray-400">Launch DeskFence when Windows starts</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoStart}
                  onChange={(e) => setSettings({ ...settings, autoStart: e.target.checked })}
                  className="w-5 h-5"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-2">Theme</label>
                <select
                  value={settings.theme}
                  onChange={(e) => handleThemeChange(e.target.value as 'light' | 'dark' | 'auto')}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 outline-none"
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="auto">Auto (follow Windows)</option>
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  Changes menus and dialogs. Each fence keeps its own colours (🎨 in the fence header); new fences start with a style that matches the theme.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm text-gray-300">Hide Desktop icons</label>
                    <p className="text-xs text-gray-400">
                      Hides the icons Windows shows on your Desktop (like right-click → View → Show desktop icons). They are shown again when DeskFence quits.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.hideDesktopIcons}
                    disabled={iconsBusy}
                    onChange={(e) => handleHideIconsChange(e.target.checked)}
                    className="w-5 h-5"
                  />
                </div>
                {iconsMessage && <p className="text-xs text-yellow-400 mt-2">{iconsMessage}</p>}
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm text-gray-300">Draw fences on the Desktop</label>
                  <p className="text-xs text-gray-400">
                    Hold the right mouse button on an empty part of the Desktop and drag a rectangle: a new fence appears there when you let go. A plain right-click still opens the normal Desktop menu.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.drawToCreate !== false}
                  onChange={(e) => handleDrawChange(e.target.checked)}
                  className="w-5 h-5"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm text-gray-300">Drop a folder to create a fence</label>
                  <p className="text-xs text-gray-400">
                    Drag a folder from File Explorer onto an empty part of the Desktop to turn it into a fence linked to that folder. Hold Shift while dropping to place items on the Desktop as usual.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.dropFolderToFence !== false}
                  onChange={(e) => handleDropFolderChange(e.target.checked)}
                  className="w-5 h-5"
                />
              </div>

              <div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <label className="text-sm text-gray-300">"Focus" desktop layout</label>
                    <p className="text-xs text-gray-400">
                      Ten dark, rounded fences in two columns (System &amp; Tools, Work &amp; Projects, Communication, Creative &amp; Design, Productivity, Files &amp; Documents on the left; Learning, Media, Utilities, Personal on the right), with the middle left free for your wallpaper. Filled with your own shortcuts.
                    </p>
                  </div>
                  <button
                    onClick={handleApplyFocusLayout}
                    disabled={layoutBusy}
                    className="shrink-0 px-3 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white"
                  >
                    {layoutBusy ? 'Working…' : 'Apply layout'}
                  </button>
                </div>
                {layoutMessage && <p className="text-xs text-yellow-400 mt-2 whitespace-pre-line">{layoutMessage}</p>}
              </div>
            </div>
          </section>

          {/* Fences Overview */}
          <section>
            <h3 className="text-lg font-medium text-white mb-4">Fences ({fences.length})</h3>
            <div className="space-y-2">
              {fences.map((fence) => (
                <div
                  key={fence.id}
                  className="flex items-center justify-between p-3 bg-gray-700 rounded"
                >
                  <div>
                    <div className="text-white font-medium">{fence.name}</div>
                    <div className="text-xs text-gray-400">
                      {allFenceItems(fence).length} items
                      {fence.portalPath && ` • Portal: ${fence.portalPath}`}
                    </div>
                  </div>
                  {fence.isLocked && (
                    <span className="text-yellow-400" title="Locked">
                      🔒
                    </span>
                  )}
                </div>
              ))}

              {fences.length === 0 && (
                <div className="text-center text-gray-400 py-8">
                  No fences created yet. Right-click on desktop to create one.
                </div>
              )}
            </div>
          </section>

          {/* Import/Export */}
          <section>
            <h3 className="text-lg font-medium text-white mb-4">Import/Export</h3>
            <div className="flex gap-3">
              <button
                onClick={exportConfig}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
              >
                📥 Export Configuration
              </button>
              <label className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors cursor-pointer">
                📤 Import Configuration
                <input type="file" accept="application/json,.json" className="hidden" onChange={importConfig} />
              </label>
            </div>
          </section>

          {/* About */}
          <section className="border-t border-gray-700 pt-6">
            <h3 className="text-lg font-medium text-white mb-2">About</h3>
            <p className="text-sm text-gray-400">
              DeskFence v1.0.0 - Desktop Organization Tool
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Developed by AYPEE Industries
            </p>
          </section>
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
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
