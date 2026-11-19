import React, { useState } from 'react';
import { useFenceStore } from '../store/fenceStore';
import type { Fence } from '../../shared/types';
import { filesToItems, cleanIpcError } from '../utils/portal';
import { watchForFence, unwatchForFence, isManagedItem } from '../utils/fence-files';
import { allFenceItems } from '../utils/fence-tabs';

interface FolderPortalDialogProps {
  fence: Fence;
  onClose: () => void;
}

const FolderPortalDialog: React.FC<FolderPortalDialogProps> = ({ fence, onClose }) => {
  const { updateFence, saveFences } = useFenceStore();
  const [folderPath, setFolderPath] = useState(fence.portalPath || '');
  const [syncMode, setSyncMode] = useState<'watch' | 'manual'>('watch');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBrowse = async () => {
    // Native folder picker (window.prompt() is not supported inside Electron)
    const picked = await window.electronAPI.selectFolder(folderPath);
    if (picked) {
      setFolderPath(picked);
      setError(null);
    }
  };

  const handleConnect = async () => {
    if (!folderPath.trim()) {
      setError('Please enter a folder path');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Get files from folder
      const targetPath = folderPath.trim();

      // Files that were moved INTO this fence live in its own folder (Documents\DeskFence\...).
      // Linking replaces the items with the folder listing, which would strand those files
      // where nobody can see them, so refuse until they are moved out.
      const before = useFenceStore.getState().fences.find((f) => f.id === fence.id) || fence;
      const managed = allFenceItems(before).filter((item) => isManagedItem(before, item));
      if (managed.length > 0) {
        setError(
          `This fence holds ${managed.length} file(s) that were moved into it. Move them back to the Desktop (↩ on each item) or into another fence before linking a folder.`
        );
        return;
      }

      // Throws "Folder not found" for a bad path instead of silently connecting an empty fence
      const files = await window.electronAPI.getFilesInFolder(targetPath);

      // read the fence again after the await: its items may have changed meanwhile
      const latest = useFenceStore.getState().fences.find((f) => f.id === fence.id);
      if (!latest) return onClose(); // deleted while we were reading
      updateFence(fence.id, {
        portalPath: targetPath,
        items: filesToItems(files, latest.portalPath === targetPath ? latest.items : []),
      });

      // Start watching if in watch mode
      // (watching a new folder releases the old one; refresh-only mode releases this fence's watch)
      if (syncMode === 'watch') {
        await watchForFence(fence.id, targetPath);
      } else {
        await unwatchForFence(fence.id);
      }

      await saveFences();
      onClose();
    } catch (err) {
      setError(cleanIpcError(err, 'Failed to connect folder'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    await unwatchForFence(fence.id);

    updateFence(fence.id, {
      portalPath: undefined,
      items: [],
    });

    await saveFences();
    onClose();
  };

  const handleRefresh = async () => {
    if (!folderPath) return;

    setIsLoading(true);
    try {
      const files = await window.electronAPI.getFilesInFolder(folderPath);
      const latest = useFenceStore.getState().fences.find((f) => f.id === fence.id);
      // the fence may have been unlinked / relinked while the folder was being read
      if (latest && latest.portalPath === folderPath) updateFence(fence.id, { items: filesToItems(files, latest.items) });
      await saveFences();
    } catch (err) {
      setError(cleanIpcError(err, 'Failed to refresh folder contents'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div>
            <h2 className="text-xl font-semibold text-white">Folder Portal</h2>
            <p className="text-sm text-gray-400 mt-1">
              Link a folder to <span className="font-medium">{fence.name}</span>
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
        <div className="p-6 space-y-4">
          {/* Folder Path */}
          <div>
            <label className="block text-sm text-gray-300 mb-2">
              Folder Path
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                placeholder="C:\Users\YourName\Documents"
                className="flex-1 px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 outline-none"
              />
              <button
                onClick={handleBrowse}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
              >
                📁 Browse
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Supports local folders, network paths (\\server\share), and cloud sync folders
            </p>
          </div>

          {/* Sync Mode */}
          <div>
            <label className="block text-sm text-gray-300 mb-2">
              Sync Mode
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-white cursor-pointer">
                <input
                  type="radio"
                  name="syncMode"
                  value="watch"
                  checked={syncMode === 'watch'}
                  onChange={() => setSyncMode('watch')}
                  className="w-4 h-4"
                />
                <div>
                  <div className="font-medium">Live Sync (Recommended)</div>
                  <div className="text-xs text-gray-400">
                    Automatically update when folder contents change
                  </div>
                </div>
              </label>
              <label className="flex items-center gap-2 text-white cursor-pointer">
                <input
                  type="radio"
                  name="syncMode"
                  value="manual"
                  checked={syncMode === 'manual'}
                  onChange={() => setSyncMode('manual')}
                  className="w-4 h-4"
                />
                <div>
                  <div className="font-medium">Manual Sync</div>
                  <div className="text-xs text-gray-400">
                    Update only when you click refresh
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Current Status */}
          {fence.portalPath && (
            <div className="p-3 bg-blue-900/30 border border-blue-700 rounded">
              <div className="flex items-start gap-2">
                <span className="text-blue-400">ℹ️</span>
                <div className="flex-1">
                  <div className="text-sm text-blue-200 font-medium">
                    Currently Connected
                  </div>
                  <div className="text-xs text-blue-300 mt-1 break-all">
                    {fence.portalPath}
                  </div>
                  <div className="text-xs text-blue-400 mt-1">
                    {fence.items.length} items synced
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-700 rounded">
              <div className="flex items-start gap-2">
                <span className="text-red-400">⚠️</span>
                <div className="text-sm text-red-200">{error}</div>
              </div>
            </div>
          )}

          {/* Info */}
          <div className="p-3 bg-gray-700/50 rounded">
            <div className="text-xs text-gray-300 space-y-1">
              <div className="font-medium mb-2">💡 Folder Portal Tips:</div>
              <div>• Changes in the folder automatically appear in the fence</div>
              <div>• Works with cloud folders (OneDrive, Dropbox, Google Drive)</div>
              <div>• Network paths require proper permissions</div>
              <div>• Only immediate children are shown (not recursive)</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-700 bg-gray-750">
          <div className="flex gap-2">
            {fence.portalPath && (
              <>
                <button
                  onClick={handleRefresh}
                  disabled={isLoading}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors disabled:opacity-50"
                >
                  🔄 Refresh
                </button>
                <button
                  onClick={handleDisconnect}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConnect}
              disabled={isLoading || !folderPath.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Connecting...' : fence.portalPath ? 'Update' : 'Connect'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FolderPortalDialog;
