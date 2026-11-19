import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FenceItem as FenceItemType } from '../../shared/types';
import { useFenceStore } from '../store/fenceStore';
import { isManagedItem, refreshPortalFence, describeFailures, loadFileIcon } from '../utils/fence-files';
import FolderIcon from './FolderIcon';

interface FenceItemProps {
  item: FenceItemType;
  fenceId: string;
}

const FenceItem: React.FC<FenceItemProps> = ({ item, fenceId }) => {
  const handleClick = () => {
    window.electronAPI.openFile(item.path);
  };

  const fence = useFenceStore((state) => state.fences.find((f) => f.id === fenceId));
  const managed = !!fence && isManagedItem(fence, item);
  const locked = !!fence?.isLocked;
  const [iconUrl, setIconUrl] = useState<string | null>(() =>
    item.icon?.startsWith('data:') || item.icon === 'folder' ? item.icon : null
  );
  const iconPx = fence?.style.iconPx ?? 32;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // Real Windows icon (falls back to the emoji below if it can't be loaded)
  useEffect(() => {
    let cancelled = false;
    // an icon stored with the item (a layout preset's) wins over looking one up
    if (item.icon?.startsWith('data:') || item.icon === 'folder') {
      setIconUrl(item.icon);
      return;
    }
    setIconUrl(null);
    loadFileIcon(item.path).then((url) => {
      if (!cancelled) setIconUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [item.path, item.icon]);

  // Windows never shows the .lnk / .url of a shortcut, so neither do we
  const displayName = item.name.replace(/\.(lnk|url)$/i, '') || item.name;

  const canRemove = !locked && !(fence?.portalPath && !managed);

  // Managed item (it was moved into the fence): put the real file back on the Desktop.
  // Anything else (a reference or a linked-folder item): just take it out of the fence view.
  const handleRemove = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!canRemove) return;
    const store = useFenceStore.getState();

    if (managed) {
      const desktop = await window.electronAPI.getDesktopPath();
      if (desktop) {
        const { failed } = await window.electronAPI.moveFiles([item.path], desktop);
        if (failed.length > 0) {
          alert(`Could not move it back to the Desktop:\n\n${describeFailures(failed)}`);
          return;
        }
      }
    } else if (fence?.portalPath) {
      return; // linked-folder items mirror the folder; remove the file in the folder itself
    }

    store.removeItemFromFence(fenceId, item.id);
    if (fence?.portalPath) await refreshPortalFence(fenceId).catch(() => {});
    store.saveFences();
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    window.electronAPI.beginItemDrag?.(); // every monitor's window must accept the drop (e.g. on the Desktop)
    e.dataTransfer.setData('application/json', JSON.stringify({
      itemId: item.id,
      fenceId,
    }));
  };

  const getIcon = () => {
    if (item.icon && !item.icon.startsWith('data:')) {
      return item.icon;
    }

    // Default icons based on type
    switch (item.type) {
      case 'folder':
        return '📁';
      case 'app':
        return '⚙️';
      case 'file':
        const ext = item.name.split('.').pop()?.toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(ext || '')) return '🖼️';
        if (['pdf'].includes(ext || '')) return '📄';
        if (['doc', 'docx'].includes(ext || '')) return '📝';
        if (['xls', 'xlsx'].includes(ext || '')) return '📊';
        if (['ppt', 'pptx'].includes(ext || '')) return '📽️';
        if (['zip', 'rar', '7z'].includes(ext || '')) return '📦';
        if (['mp3', 'wav', 'flac'].includes(ext || '')) return '🎵';
        if (['mp4', 'avi', 'mkv'].includes(ext || '')) return '🎬';
        return '📄';
      default:
        return '📄';
    }
  };

  return (
    <div
      className={`relative flex flex-col items-center justify-center ${fence?.style.compactHeader ? 'p-1' : 'p-2'} rounded hover:bg-white/10 cursor-pointer transition-all group`}
      onClick={handleClick}
      draggable={!locked}
      onDragStart={handleDragStart}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation(); // keep the desktop-level menu from opening too
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      title={item.path}
    >
      {canRemove && (
        <button
          onClick={handleRemove}
          className="absolute top-0 right-0 hidden group-hover:block text-[10px] leading-none px-1 py-0.5 rounded bg-black/60 text-white hover:bg-black/80"
          title={managed ? 'Move back to Desktop' : 'Remove from fence'}
        >
          {managed ? '↩' : '✕'}
        </button>
      )}
      <div
        className="mb-1 group-hover:scale-110 transition-transform flex items-center justify-center"
        style={{ height: iconPx, fontSize: Math.round(iconPx * 0.9) }}
      >
        {/* 'folder' = the main process found a folder (Windows would have given a drive icon) */}
        {iconUrl === 'folder' || (!iconUrl && item.type === 'folder') ? (
          <FolderIcon size={iconPx} />
        ) : iconUrl ? (
          <img src={iconUrl} alt="" className="object-contain" style={{ width: iconPx, height: iconPx }} draggable={false} />
        ) : (
          getIcon()
        )}
      </div>
      <div
        className="text-xs text-center break-all line-clamp-2 w-full"
        style={{
          color: fence?.style.labelColor || 'rgba(255,255,255,0.9)',
          ...(fence?.style.itemLabelSize ? { fontSize: fence.style.itemLabelSize, lineHeight: 1.2 } : {}),
        }}
      >
        {displayName}
      </div>

      {/* Item menu. Portaled to <body>: a fixed menu inside a transformed fence would be misplaced. */}
      {menu &&
        createPortal(
          <div
            className="fixed inset-0 z-[70]"
            onClick={(e) => {
              e.stopPropagation();
              setMenu(null);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu(null);
            }}
          >
            <div
              className="absolute bg-gray-800 border border-gray-600 rounded-lg shadow-2xl py-1 w-52 text-sm text-white"
              style={{
                left: Math.min(menu.x, window.innerWidth - 220),
                top: Math.min(menu.y, window.innerHeight - 190),
              }}
            >
              <button
                className="w-full text-left px-4 py-2 hover:bg-gray-700"
                onClick={() => {
                  setMenu(null);
                  window.electronAPI.openFile(item.path);
                }}
              >
                Open
              </button>
              <button
                className="w-full text-left px-4 py-2 hover:bg-gray-700"
                onClick={() => {
                  setMenu(null);
                  window.electronAPI.showInFolder(item.path);
                }}
              >
                Show in folder
              </button>
              <button
                className="w-full text-left px-4 py-2 hover:bg-gray-700"
                onClick={() => {
                  setMenu(null);
                  window.electronAPI.copyText(item.path);
                }}
              >
                Copy path
              </button>
              {canRemove && (
                <>
                  <div className="my-1 border-t border-gray-700" />
                  <button
                    className="w-full text-left px-4 py-2 hover:bg-gray-700"
                    onClick={() => {
                      setMenu(null);
                      handleRemove();
                    }}
                  >
                    {managed ? 'Move back to Desktop' : 'Remove from fence'}
                  </button>
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default FenceItem;
