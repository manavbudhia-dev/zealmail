import React, { useState, useEffect, useRef } from 'react';
import Draggable from 'react-draggable';
import { useFenceStore } from '../store/fenceStore';
import type { Fence as FenceType } from '../../shared/types';
import FenceItem from './FenceItem';
import FolderPortalDialog from './FolderPortalDialog';
import FenceCustomizationDialog from './FenceCustomizationDialog';
import FenceRulesDialog from './FenceRulesDialog';
import { useDisplayStore, nextDisplayId } from '../store/displayStore';
import { addTab, switchTab, renameTab, removeTab, moveItemToTab, hasTabs, activeTabId, allFenceItems } from '../utils/fence-tabs';
import { filesToItems } from '../utils/portal';
import {
  getFenceFolder,
  refreshPortalFence,
  unwatchForFence,
  isManagedItem,
  isInsideFolder,
  describeFailures,
  baseName,
  newItemId,
} from '../utils/fence-files';

// Yellow folder shown before the title of compact fences
const FolderGlyph: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path
      d="M2 6.5A2.5 2.5 0 0 1 4.5 4h4.2c.6 0 1.2.3 1.6.8l1.3 1.7h7.9A2.5 2.5 0 0 1 22 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5z"
      fill="#e9a825"
    />
    <path d="M2 10a2.5 2.5 0 0 1 2.5-2.5h15A2.5 2.5 0 0 1 22 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5z" fill="#ffd25f" />
  </svg>
);

// Auto roll-up timing: a short delay before dropping down (so passing the mouse over does not
// flicker) and a longer one before rolling up (so a small slip outside does not close it).
const HOVER_OPEN_DELAY_MS = 120;
const HOVER_CLOSE_DELAY_MS = 500;

interface FenceProps {
  fence: FenceType;
}

const Fence: React.FC<FenceProps> = ({ fence }) => {
  const { updateFence, deleteFence, saveFences, selectedFenceId, setSelectedFence, addItemToFence, removeItemFromFence, moveItemBetweenFences } = useFenceStore();
  // The `fence` prop is the value from the last render. Handlers that rebuild `items`/`tabs` must
  // start from the store's current copy, or an item added in between (a rule, a folder refresh,
  // another monitor's save) is silently overwritten.
  const latestFence = () => useFenceStore.getState().fences.find((f) => f.id === fence.id) || fence;
  const nodeRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [dragHover, setDragHover] = useState(false); // a file is being dragged over the fence
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(fence.name);
  const [showPortalDialog, setShowPortalDialog] = useState(false);
  const [showCustomization, setShowCustomization] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabName, setEditingTabName] = useState('');
  const displayInfo = useDisplayStore((state) => state.info);
  const tabbed = hasTabs(fence);
  const currentTabId = activeTabId(fence);

  const isSelected = selectedFenceId === fence.id;

  // A freshly drawn fence opens its title for typing, like naming a new folder
  const renameRequested = useFenceStore((state) => state.renameFenceId === fence.id);
  useEffect(() => {
    if (!renameRequested) return;
    setName(fence.name);
    setIsEditing(true);
    useFenceStore.getState().setRenameFence(null);
  }, [renameRequested]);

  // ---- Auto roll-up --------------------------------------------------------------------
  // With autoRollup on, the fence shows only its title bar. The mouse arriving drops it down,
  // the mouse leaving rolls it up again. This is view state only (nothing is saved on hover).
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const cancelOpen = () => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  };
  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const hoverOpen = (immediately = false) => {
    if (!fence.autoRollup) return;
    cancelClose();
    if (immediately) {
      cancelOpen();
      setHovered(true);
      return;
    }
    if (openTimer.current !== null) return;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      setHovered(true);
    }, HOVER_OPEN_DELAY_MS);
  };
  const hoverClose = () => {
    cancelOpen();
    if (closeTimer.current !== null) return;
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setHovered(false);
      setDragHover(false);
    }, HOVER_CLOSE_DELAY_MS);
  };

  useEffect(() => () => { cancelOpen(); cancelClose(); }, []);

  // switching auto roll-up off: forget any pending hover
  useEffect(() => {
    if (!fence.autoRollup) {
      cancelOpen();
      cancelClose();
      setHovered(false);
      setDragHover(false);
    }
  }, [fence.autoRollup]);

  // Safety net: the desktop window is click-through on empty space, so the browser can miss
  // the "mouse left" event. While the fence is dropped down, also watch where the pointer is.
  useEffect(() => {
    if (!fence.autoRollup || !hovered) return;
    const onMove = (e: MouseEvent) => {
      const rect = nodeRef.current?.getBoundingClientRect();
      if (!rect) return;
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (inside) cancelClose();
      else hoverClose();
    };
    const onLeaveWindow = () => hoverClose();
    window.addEventListener('mousemove', onMove);
    document.documentElement.addEventListener('mouseleave', onLeaveWindow);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeaveWindow);
    };
  }, [fence.autoRollup, hovered]);

  // Never roll up while the user is busy with this fence
  const keepOpen =
    isDragging || isResizing || isEditing || editingTabId !== null || dragHover ||
    showPortalDialog || showCustomization || showRules;
  const rolledUp = fence.autoRollup ? !hovered && !keepOpen : !!fence.collapsed;

  // Listen for folder changes if this fence has a portal
  useEffect(() => {
    if (!fence.portalPath) return;

    const handleFolderChange = (data: any) => {
      if (data.folderPath === fence.portalPath) {
        // Refresh fence contents when folder changes
        refreshPortalContents();
      }
    };

    // unsubscribe on cleanup, otherwise every re-render stacks another listener
    // and one folder change triggers many refreshes + saves
    return window.electronAPI.onFolderChanged(handleFolderChange);
  }, [fence.portalPath]);

  const refreshPortalContents = async () => {
    if (!fence.portalPath) return;

    try {
      await refreshPortalFence(fence.id); // ordered: an older listing can never overwrite a newer one
      saveFences();
    } catch (error) {
      console.error('Failed to refresh portal contents:', error);
    }
  };

  const getIconSize = (size?: string): number => {
    switch (size) {
      case 'small': return 48;
      case 'medium': return 64;
      case 'large': return 96;
      case 'extra-large': return 128;
      default: return fence.gridSize || 80;
    }
  };

  const handleDragStop = (_: any, data: { x: number; y: number }) => {
    setIsDragging(false);
    updateFence(fence.id, {
      position: { x: data.x, y: data.y },
    });
    saveFences();
  };

  const handleResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = fence.size.width;
    const startHeight = fence.size.height;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      const newWidth = Math.max(200, startWidth + deltaX);
      const newHeight = Math.max(150, startHeight + deltaY);

      updateFence(fence.id, {
        size: { width: newWidth, height: newHeight },
      });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      saveFences();
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleNameSave = () => {
    updateFence(fence.id, { name });
    setIsEditing(false);
    saveFences();
  };

  const handleDelete = async () => {
    // Files that were moved INTO this fence live in its own folder. Deleting the fence
    // must not strand them there, so they go back to the Desktop first.
    // every tab counts, not only the visible one
    const managed = allFenceItems(fence).filter((item) => isManagedItem(fence, item));

    const message = managed.length > 0
      ? `Delete fence "${fence.name}"?\n\nIts ${managed.length} file(s)/folder(s) will be moved back to your Desktop.`
      : fence.portalPath
        ? `Delete fence "${fence.name}"?\n\nThe linked folder and its files are not touched.`
        : `Delete fence "${fence.name}"?`;
    if (!confirm(message)) return;

    if (managed.length > 0) {
      const desktop = await window.electronAPI.getDesktopPath();
      if (desktop) {
        const { moved, failed } = await window.electronAPI.moveFiles(managed.map((i) => i.path), desktop);
        for (const m of moved) {
          const item = managed.find((i) => i.path === m.from);
          if (!item) continue;
          // the item may sit in a tab that is not visible right now
          const latest = useFenceStore.getState().fences.find((f) => f.id === fence.id);
          if (latest?.items.some((i) => i.id === item.id)) {
            removeItemFromFence(fence.id, item.id);
          } else if (latest?.tabs) {
            updateFence(fence.id, {
              tabs: latest.tabs.map((t) => ({ ...t, items: t.items.filter((i) => i.id !== item.id) })),
            });
          }
        }
        if (failed.length > 0) {
          saveFences();
          alert(`The fence was NOT deleted because some files could not be moved back to the Desktop:\n\n${describeFailures(failed)}`);
          return;
        }
      }
    }

    // release this fence's hold on its linked folder (other users of the folder keep their watch)
    unwatchForFence(fence.id).catch(() => {});
    deleteFence(fence.id);
    saveFences();
  };

  // Moves files/folders into this fence's real folder and shows them in the fence.
  // Returns false if nothing could be done (so the caller can stop).
  const moveIntoThisFence = async (
    entries: { path: string; type: 'file' | 'folder'; onMoved?: () => void }[]
  ) => {
    const latest = useFenceStore.getState().fences.find((f) => f.id === fence.id) || fence;
    const folder = await getFenceFolder(latest);
    if (!folder) return false;

    const { moved, failed } = await window.electronAPI.moveFiles(entries.map((e) => e.path), folder);

    for (const m of moved) {
      const entry = entries.find((e) => e.path === m.from);
      entry?.onMoved?.();
      if (latest.portalPath) continue; // linked fences re-read the folder below
      const current = useFenceStore.getState().fences.find((f) => f.id === fence.id);
      if (current?.items.some((i) => i.path === m.to)) continue;
      addItemToFence(fence.id, {
        id: newItemId(),
        name: baseName(m.to),
        path: m.to,
        type: entry?.type ?? 'file',
        position: { x: 0, y: 0 },
      });
    }

    if (latest.portalPath) await refreshPortalFence(fence.id);
    saveFences();

    if (failed.length > 0) {
      alert(`Some items could not be moved:\n\n${describeFailures(failed)}`);
    }
    return true;
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (fence.isLocked) {
      alert('This fence is locked. Unlock it (🔒) to add or move items.');
      return;
    }

    // 1) An item dragged from another fence: move the real file between the fence folders
    const internal = e.dataTransfer.getData('application/json');
    if (internal) {
      try {
        const { itemId, fenceId: fromId } = JSON.parse(internal);
        if (itemId && fromId) {
          if (fromId === fence.id) return;
          const source = useFenceStore.getState().fences.find((f) => f.id === fromId);
          const item = source?.items.find((i) => i.id === itemId);
          if (!source || !item) return;

          // Only files that really live in the source fence's folder may be moved on disk. A
          // shortcut-only item (layout presets, Start Menu shortcuts, an app folder in Documents...)
          // points at the user's own file: moving that would relocate their real file/folder.
          const ownsFile =
            isManagedItem(source, item) || (!!source.portalPath && isInsideFolder(item.path, source.portalPath));
          if (!ownsFile) {
            if (fence.portalPath) {
              alert(`"${item.name}" is only a shortcut. A fence linked to a folder shows that folder's files, so it cannot hold shortcuts.`);
              return;
            }
            moveItemBetweenFences(fromId, fence.id, itemId);
            saveFences();
            return;
          }

          await moveIntoThisFence([
            {
              path: item.path,
              type: item.type === 'folder' ? 'folder' : 'file',
              onMoved: () => {
                if (source.portalPath) refreshPortalFence(fromId).catch(() => {});
                else removeItemFromFence(fromId, itemId);
              },
            },
          ]);
          return;
        }
      } catch {
        // not one of our drags, fall through to OS files
      }
    }

    // 2) Files/folders dropped from Explorer / the Desktop. Read everything we need now,
    //    DataTransfer is emptied once we await. file.type === '' is NOT a folder test
    //    (.md, .py, .lnk have no MIME type), so ask the browser.
    const dropped = Array.from(e.dataTransfer.files).map((file, index) => ({
      name: file.name,
      // Electron (<= v31) adds .path to dropped files; it is undefined in a plain browser
      path: (file as File & { path?: string }).path || '',
      isDirectory: e.dataTransfer.items?.[index]?.webkitGetAsEntry?.()?.isDirectory ?? false,
    }));

    const real = dropped.filter((d) => d.path);
    if (real.length > 0) {
      await moveIntoThisFence(real.map((d) => ({ path: d.path, type: d.isDirectory ? 'folder' : 'file' })));
      return;
    }

    // Browser mode: files have no real path, so keep a reference only (nothing is moved)
    if (fence.portalPath) {
      alert('This fence is linked to a folder. Files cannot be added manually in browser mode.');
      return;
    }
    for (const d of dropped) {
      if (fence.items.some((i) => i.name === d.name)) continue;
      addItemToFence(fence.id, {
        id: newItemId(),
        name: d.name,
        path: d.name,
        type: d.isDirectory ? 'folder' : 'file',
        position: { x: 0, y: 0 },
      });
    }
    saveFences();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (fence.autoRollup) {
      cancelClose();
      if (!hovered) setHovered(true); // drop down so the file can be dropped inside
      if (!dragHover) setDragHover(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!fence.autoRollup) return;
    // leaving into one of our own children is not leaving the fence
    if (e.relatedTarget instanceof Node && nodeRef.current?.contains(e.relatedTarget)) return;
    setDragHover(false);
    hoverClose();
  };

  return (
    <>
    <Draggable
      nodeRef={nodeRef}
      position={fence.position}
      bounds="parent"
      onStart={() => setIsDragging(true)}
      onStop={handleDragStop}
      handle=".fence-header"
      disabled={fence.isLocked}
    >
      <div
        ref={nodeRef}
        className={`absolute fence-enter ${fence.style.compactHeader ? 'fence-compact' : ''} ${isSelected ? 'ring-2 ring-blue-400' : ''}`}
        data-fence-id={fence.id}
        style={{
          width: fence.size.width,
          height: rolledUp ? undefined : fence.size.height,
          // a dropped-down auto roll-up fence floats above the fences next to it
          zIndex: fence.autoRollup && !rolledUp ? 30 : undefined,
          ...(fence.style.compactHeader ? { display: 'flex', flexDirection: 'column' as const } : {}),
          backgroundColor: fence.style.backgroundColor,
          borderColor: fence.style.borderColor,
          borderWidth: fence.style.borderWidth,
          borderRadius: fence.style.borderRadius,
          opacity: fence.style.opacity,
        }}
        onClick={() => setSelectedFence(fence.id)}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onMouseEnter={() => hoverOpen()}
        onMouseLeave={() => hoverClose()}
      >
        {/* Header */}
        <div
          className="fence-header flex items-center justify-between px-3 py-2 cursor-move select-none"
          style={{
            borderBottom: fence.style.compactHeader ? 'none' : `1px solid ${fence.style.borderColor}`,
            color: fence.style.labelColor,
            fontSize: fence.style.labelSize,
          }}
        >
          {isEditing ? (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={(e) => e.key === 'Enter' && handleNameSave()}
              onFocus={(e) => e.target.select()}
              className="bg-transparent border-b border-white/50 outline-none px-1"
              autoFocus
            />
          ) : (
            <div className="flex items-center gap-2">
              {fence.style.compactHeader && <FolderGlyph size={Math.round(fence.style.labelSize * 1.45)} />}
              <span
                className="font-semibold"
                onDoubleClick={() => setIsEditing(true)}
              >
                {fence.name}
              </span>
              {fence.category && (
                <span className="text-xs opacity-70 bg-white/20 px-2 py-0.5 rounded">
                  {fence.category}
                </span>
              )}
              {fence.dueDate && (
                <span className="text-xs opacity-70 bg-yellow-600/30 px-2 py-0.5 rounded">
                  📅 {new Date(fence.dueDate).toLocaleDateString()}
                </span>
              )}
            </div>
          )}

          <div className="flex gap-2 items-center fence-actions">
            {!fence.autoRollup && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updateFence(fence.id, { collapsed: !fence.collapsed });
                  saveFences();
                }}
                className="text-xs opacity-70 hover:opacity-100 transition-opacity"
                title={fence.collapsed ? 'Expand' : 'Roll up to title bar'}
              >
                {fence.collapsed ? '▸' : '▾'}
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                // starts from a clean state either way (not manually rolled up)
                updateFence(fence.id, { autoRollup: !fence.autoRollup, collapsed: false });
                saveFences();
              }}
              className={`text-xs transition-opacity rounded px-1 ${
                fence.autoRollup ? 'bg-white/25 opacity-100' : 'opacity-70 hover:opacity-100'
              }`}
              title={
                fence.autoRollup
                  ? 'Auto roll-up is ON: rolls up when the mouse leaves, drops down on hover (click to turn off)'
                  : 'Auto roll-up: roll up to the title bar when the mouse leaves, drop down on hover'
              }
            >
              ⇅
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                updateFence(fence.id, { isLocked: !fence.isLocked });
                saveFences();
              }}
              className="text-xs opacity-70 hover:opacity-100 transition-opacity"
              title={fence.isLocked ? 'Unlock (allow moving, resizing, changing)' : 'Lock (prevent moving, resizing, changes)'}
            >
              {fence.isLocked ? '🔒' : '🔓'}
            </button>
            {!fence.portalPath && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (fence.isLocked) return alert('This fence is locked. Unlock it (🔒) to add tabs.');
                  updateFence(fence.id, addTab(latestFence()));
                  saveFences();
                }}
                className="text-xs opacity-70 hover:opacity-100 transition-opacity"
                title="Add a tab"
              >
                🗂
              </button>
            )}
            {displayInfo && displayInfo.displays.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const target = nextDisplayId(fence, displayInfo);
                  // lands near the top-left of the other monitor; this window stops drawing it
                  updateFence(fence.id, { displayId: target, position: { x: 60, y: 60 } });
                  saveFences();
                }}
                className="text-xs opacity-70 hover:opacity-100 transition-opacity"
                title="Move this fence to the next monitor"
              >
                🖥
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowRules(true);
              }}
              className="text-xs opacity-70 hover:opacity-100 transition-opacity"
              title={`Rules for this fence${fence.rules?.length ? ` (${fence.rules.length})` : ''}`}
            >
              ⚡{fence.rules && fence.rules.length > 0 ? <sup>{fence.rules.length}</sup> : null}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowCustomization(true);
              }}
              className="text-xs opacity-70 hover:opacity-100 transition-opacity"
              title="Customize fence"
            >
              🎨
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (tabbed) {
                  alert('A fence with tabs cannot be linked to a folder. Close the extra tabs first.');
                  return;
                }
                setShowPortalDialog(true);
              }}
              className="text-xs opacity-70 hover:opacity-100 transition-opacity"
              title={fence.portalPath ? `Portal: ${fence.portalPath}` : 'Link to folder'}
            >
              {fence.portalPath ? '📁' : '🔗'}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (fence.isLocked) {
                  alert('This fence is locked. Unlock it (🔒) to delete it.');
                  return;
                }
                handleDelete();
              }}
              className="text-xs opacity-50 hover:opacity-100 transition-opacity"
              title="Delete fence"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content Area */}
        {tabbed && !rolledUp && (
          <div
            className={`fence-tabs flex items-center gap-1 px-2 py-1 overflow-x-auto ${fence.autoRollup ? 'fence-dropdown' : ''}`}
            style={{ color: fence.style.labelColor, borderBottom: `1px solid ${fence.style.borderColor}55` }}
          >
            {fence.tabs!.map((tab) => {
              const active = tab.id === currentTabId;
              return (
                <div
                  key={tab.id}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer whitespace-nowrap ${
                    active ? 'bg-white/25 font-semibold' : 'hover:bg-white/10 opacity-80'
                  }`}
                  data-tab-id={tab.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    updateFence(fence.id, switchTab(latestFence(), tab.id));
                    saveFences();
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (fence.isLocked) return;
                    setEditingTabId(tab.id);
                    setEditingTabName(tab.name);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    // drop an item of this fence onto another tab to move it there
                    const payload = e.dataTransfer.getData('application/json');
                    if (!payload || fence.isLocked) return;
                    try {
                      const { itemId, fenceId: fromId } = JSON.parse(payload);
                      if (fromId !== fence.id) return;
                      e.preventDefault();
                      e.stopPropagation();
                      updateFence(fence.id, moveItemToTab(latestFence(), itemId, tab.id));
                      saveFences();
                    } catch {
                      /* not our drag */
                    }
                  }}
                  title="Click to open • double-click to rename • drop an item here to move it to this tab"
                >
                  {editingTabId === tab.id ? (
                    <input
                      autoFocus
                      value={editingTabName}
                      onChange={(e) => setEditingTabName(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={() => {
                        updateFence(fence.id, renameTab(latestFence(), tab.id, editingTabName));
                        saveFences();
                        setEditingTabId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setEditingTabId(null);
                      }}
                      className="w-24 bg-transparent border-b border-current outline-none"
                    />
                  ) : (
                    <span>{tab.name}</span>
                  )}
                  {active && !fence.isLocked && (
                    <button
                      className="opacity-60 hover:opacity-100 leading-none"
                      title="Close this tab (its items move to the neighbouring tab)"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Close tab "${tab.name}"? Its items move to the neighbouring tab.`)) {
                          updateFence(fence.id, removeTab(latestFence(), tab.id));
                          saveFences();
                        }
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            {!fence.isLocked && (
              <button
                className="px-1.5 text-xs opacity-70 hover:opacity-100"
                title="Add a tab"
                onClick={(e) => {
                  e.stopPropagation();
                  updateFence(fence.id, addTab(latestFence()));
                  saveFences();
                }}
              >
                ＋
              </button>
            )}
          </div>
        )}

        <div
          className={`${fence.style.compactHeader ? 'px-3 pb-2' : 'p-3'} overflow-auto ${
            fence.style.compactHeader ? 'fence-body flex-1 min-h-0' : tabbed ? 'h-[calc(100%-68px)]' : 'h-[calc(100%-40px)]'
          } ${fence.autoRollup ? 'fence-dropdown' : ''}`}
          style={{ display: rolledUp ? 'none' : undefined }}
        >
          {fence.tags && fence.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {fence.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-2 py-0.5 bg-blue-600/50 text-white rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: fence.style.columns
                ? `repeat(${fence.style.columns}, minmax(0, 1fr))`
                : `repeat(auto-fill, minmax(${getIconSize(fence.style.iconSize)}px, 1fr))`,
              ...(fence.style.compactHeader ? { gap: '10px 4px' } : {}),
            }}
          >
            {fence.items.map((item) => (
              <FenceItem key={item.id} item={item} fenceId={fence.id} />
            ))}
          </div>

          {fence.items.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm gap-2">
              {fence.portalPath ? (
                <>
                  <div>📁 Folder Portal</div>
                  <div className="text-xs">Folder is empty</div>
                </>
              ) : (
                <>
                  <div>Drag files here</div>
                  <div className="text-xs">or click 🔗 to link a folder</div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Resize Handle */}
        {!fence.isLocked && !rolledUp && (
          <div
            className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
            onMouseDown={handleResize}
            style={{
              background: 'linear-gradient(135deg, transparent 50%, rgba(59, 130, 246, 0.5) 50%)',
            }}
          />
        )}
      </div>
    </Draggable>
    {showPortalDialog && (
      <FolderPortalDialog
        fence={fence}
        onClose={() => setShowPortalDialog(false)}
      />
    )}
    {showRules && <FenceRulesDialog fenceId={fence.id} onClose={() => setShowRules(false)} />}
    {showCustomization && (
      <FenceCustomizationDialog
        fence={fence}
        onClose={() => setShowCustomization(false)}
      />
    )}
    </>
  );
};

export default Fence;
