import React, { useState, useEffect, useRef } from 'react';
import Draggable from 'react-draggable';
import { useFenceStore } from '../store/fenceStore';
import type { Fence as FenceType } from '../../shared/types';
import FenceItem from './FenceItem';
import FolderIcon from './FolderIcon';
import { createPortal } from 'react-dom';
import { displayStyle } from '../utils/theme';
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

  // fences still on the old blue default are drawn with the current default look (nothing is saved)
  const style = displayStyle(fence.style);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

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
      // a cell is the icon plus room for its name: 5 icons fit across a ~290px fence, like the original
      default: return Math.max(52, (style.iconPx ?? 34) + 20);
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

  type MenuEntry = { label: string; run: () => void; disabled?: boolean } | '-';
  const fenceMenuItems = (): MenuEntry[] => {
    const locked = !!fence.isLocked;
    const lockedAlert = (what: string) => () => alert(`This fence is locked. Unlock it to ${what}.`);
    const entries: MenuEntry[] = [
      { label: 'Rename', run: locked ? lockedAlert('rename it') : () => setIsEditing(true), disabled: tabbed },
      { label: '🎨 Customize…', run: () => setShowCustomization(true) },
      '-',
    ];
    if (!fence.autoRollup) {
      entries.push({
        label: fence.collapsed ? '▾ Expand' : '▴ Roll up to title',
        run: () => {
          updateFence(fence.id, { collapsed: !fence.collapsed });
          saveFences();
        },
      });
    }
    entries.push(
      {
        label: fence.autoRollup ? '✓ Auto roll-up (on hover)' : 'Auto roll-up (on hover)',
        run: () => {
          updateFence(fence.id, { autoRollup: !fence.autoRollup, collapsed: false });
          saveFences();
        },
      },
      {
        label: locked ? '🔓 Unlock' : '🔒 Lock',
        run: () => {
          updateFence(fence.id, { isLocked: !locked });
          saveFences();
        },
      },
      '-'
    );
    if (!fence.portalPath) {
      entries.push({
        label: '🗂 Add tab',
        run: locked
          ? lockedAlert('add tabs')
          : () => {
              updateFence(fence.id, addTab(latestFence()));
              saveFences();
            },
      });
    }
    if (tabbed && currentTabId) {
      const current = fence.tabs!.find((t) => t.id === currentTabId);
      entries.push(
        {
          label: 'Rename this tab',
          run: locked
            ? lockedAlert('rename tabs')
            : () => {
                setEditingTabId(currentTabId);
                setEditingTabName(current?.name || '');
              },
        },
        {
          label: 'Close this tab',
          run: locked
            ? lockedAlert('close tabs')
            : () => {
                if (confirm(`Close tab "${current?.name}"? Its items move to the neighbouring tab.`)) {
                  updateFence(fence.id, removeTab(latestFence(), currentTabId));
                  saveFences();
                }
              },
        }
      );
    }
    entries.push(
      {
        label: fence.portalPath ? '📁 Linked folder…' : '🔗 Link to a folder…',
        run: () => {
          if (tabbed) return alert('A fence with tabs cannot be linked to a folder. Close the extra tabs first.');
          setShowPortalDialog(true);
        },
      },
      { label: `⚡ Rules${fence.rules?.length ? ` (${fence.rules.length})` : ''}…`, run: () => setShowRules(true) }
    );
    if (displayInfo && displayInfo.displays.length > 1) {
      entries.push({
        label: '🖥 Move to next monitor',
        run: () => {
          // lands near the top-left of the other monitor; this window stops drawing it
          updateFence(fence.id, { displayId: nextDisplayId(fence, displayInfo), position: { x: 60, y: 60 } });
          saveFences();
        },
      });
    }
    entries.push('-', { label: '✕ Delete fence', run: locked ? lockedAlert('delete it') : () => handleDelete() });
    return entries;
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
        className="fence absolute fence-enter flex flex-col overflow-hidden" 
        data-fence-id={fence.id}
        style={{
          width: fence.size.width,
          height: rolledUp ? undefined : fence.size.height,
          // a dropped-down auto roll-up fence floats above the fences next to it
          zIndex: fence.autoRollup && !rolledUp ? 30 : undefined,
          backgroundColor: style.backgroundColor,
          border: `${style.borderWidth}px solid ${style.borderColor}`,
          borderRadius: style.borderRadius,
          opacity: style.opacity,
          boxShadow: style.shadow === false ? 'none' : '0 4px 18px rgba(0, 0, 0, 0.25)',
        }}
        onClick={() => setSelectedFence(fence.id)}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onMouseEnter={() => hoverOpen()}
        onMouseLeave={() => hoverClose()}
      >
        {/* Header: centered title (or the tabs), options behind ⋯ / right-click */}
        <div
          className={`fence-header relative flex items-center ${style.titleAlign === 'left' && !tabbed ? 'justify-start pl-3 pr-8' : 'justify-center'} ${
            tabbed ? 'pl-1.5 pr-8' : style.titleAlign === 'left' ? '' : 'px-8'
          } cursor-move select-none`}
          style={{
            color: style.labelColor,
            fontSize: style.labelSize,
            minHeight: Math.round(style.labelSize * 2),
            backgroundColor: style.titleBarColor || undefined,
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          {tabbed ? (
            <div className="flex w-full items-stretch gap-1 py-1">
              {fence.tabs!.map((tab) => {
                const active = tab.id === currentTabId;
                return (
                  <div
                    key={tab.id}
                    data-tab-id={tab.id}
                    className={`group/tab relative flex-1 min-w-0 flex items-center justify-center gap-1 px-2 py-0.5 rounded cursor-pointer ${
                      active ? 'font-semibold' : 'opacity-60 hover:opacity-100 hover:bg-white/5'
                    }`}
                    style={active ? { backgroundColor: style.tabColor || 'rgba(255, 255, 255, 0.15)' } : undefined}
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
                        onFocus={(e) => e.target.select()}
                        onBlur={() => {
                          updateFence(fence.id, renameTab(latestFence(), tab.id, editingTabName));
                          saveFences();
                          setEditingTabId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') setEditingTabId(null);
                        }}
                        className="w-full min-w-0 bg-transparent text-center border-b border-current outline-none"
                      />
                    ) : (
                      <span className="truncate">{tab.name}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : isEditing ? (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={(e) => e.key === 'Enter' && handleNameSave()}
              onFocus={(e) => e.target.select()}
              className="w-full min-w-0 bg-transparent text-center font-semibold border-b border-white/50 outline-none px-1"
              autoFocus
            />
          ) : (
            <div className={`flex items-center gap-2 min-w-0 py-0.5 ${style.titleAlign === 'left' ? 'justify-start' : 'justify-center'}`}>
              {style.compactHeader && <FolderIcon size={Math.round(style.labelSize * 1.3)} tint={style.iconTint} strength={style.iconTintStrength} />}
              <span className="font-semibold truncate" onDoubleClick={() => setIsEditing(true)} title="Double-click to rename">
                {fence.name}
              </span>
              {fence.isLocked && <span className="text-[0.7em] opacity-60" title="Locked">🔒</span>}
              {fence.portalPath && <span className="text-[0.7em] opacity-60" title={`Shows the folder ${fence.portalPath}`}>🔗</span>}
            </div>
          )}

          <button
            className="fence-actions absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded flex items-center justify-center text-base leading-none hover:bg-white/15"
            title="Fence options"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setMenu(menu ? null : { x: r.right - 200, y: r.bottom + 4 });
            }}
          >
            ⋯
          </button>
        </div>

        {/* Category / tags / due date: a quiet line under the title */}
        {!rolledUp && (fence.category || fence.dueDate || (fence.tags && fence.tags.length > 0)) && (
          <div className="flex flex-wrap justify-center gap-1 px-2 pb-1 text-[11px]" style={{ color: style.labelColor }}>
            {fence.category && <span className="opacity-70 bg-white/10 px-2 rounded">{fence.category}</span>}
            {fence.dueDate && <span className="opacity-70 bg-yellow-600/30 px-2 rounded">📅 {new Date(fence.dueDate).toLocaleDateString()}</span>}
            {fence.tags?.map((tag) => (
              <span key={tag} className="bg-blue-600/40 px-2 rounded">{tag}</span>
            ))}
          </div>
        )}

        {/* Items */}
        <div
          className={`fence-body flex-1 min-h-0 overflow-auto px-1.5 pb-1.5 ${fence.autoRollup ? 'fence-dropdown' : ''}`}
          style={{ display: rolledUp ? 'none' : undefined }}
        >
          <div
            className="grid gap-x-0 gap-y-1"
            style={{
              gridTemplateColumns: style.columns
                ? `repeat(${style.columns}, minmax(0, 1fr))`
                : `repeat(auto-fill, minmax(${getIconSize(style.iconSize)}px, 1fr))`,
            }}
          >
            {fence.items.map((item) => (
              <FenceItem key={item.id} item={item} fenceId={fence.id} />
            ))}
          </div>

          {fence.items.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-xs gap-1 opacity-50" style={{ color: style.labelColor }}>
              {fence.portalPath ? 'This folder is empty' : 'Drop files here'}
            </div>
          )}
        </div>

        {/* Resize handle: only visible while the mouse is over the fence */}
        {!fence.isLocked && !rolledUp && (
          <div
            className="fence-resize absolute bottom-0 right-0 w-3.5 h-3.5 cursor-se-resize"
            onMouseDown={handleResize}
            style={{ background: `linear-gradient(135deg, transparent 55%, ${style.labelColor}66 55%)`, borderBottomRightRadius: style.borderRadius }}
          />
        )}
      </div>
    </Draggable>
    {menu &&
      createPortal(
        <div
          className="fixed inset-0 z-[70]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMenu(null);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu(null);
          }}
        >
          <div
            className="absolute bg-gray-800 border border-gray-600 rounded-lg shadow-2xl py-1 w-52 text-sm text-white"
            style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 216)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 420)) }}
          >
            {fenceMenuItems().map((entry, index) =>
              entry === '-' ? (
                <div key={index} className="my-1 border-t border-gray-700" />
              ) : (
                <button
                  key={entry.label}
                  className="w-full text-left px-4 py-1.5 hover:bg-gray-700 disabled:opacity-40"
                  disabled={entry.disabled}
                  onClick={() => {
                    setMenu(null);
                    entry.run();
                  }}
                >
                  {entry.label}
                </button>
              )
            )}
          </div>
        </div>,
        document.body
      )}
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
