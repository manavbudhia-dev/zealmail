import React, { useEffect, useRef, useState } from 'react';
import { useFenceStore } from './store/fenceStore';
import Fence from './components/Fence';
import ContextMenu from './components/ContextMenu';
import SettingsPanel from './components/SettingsPanel';
import AutomationPanel from './components/AutomationPanel';
import ScheduledTasksDialog from './components/ScheduledTasksDialog';
import { useScheduledStore, executeTask } from './store/scheduledStore';
import { ScheduleEngine } from './utils/schedule-engine';
import { handleFolderEvent, allWatchPaths } from './utils/rule-runner';
import { useDisplayStore, loadWindowInfo, fenceBelongsHere } from './store/displayStore';
import { applyTheme, currentTheme, defaultFenceStyle } from './utils/theme';
import { reconcileManagedFences, watchForFence, refreshPortalFence } from './utils/fence-files';
import { dragKind, readDroppedEntries, createFencesFromFolders, moveItemBackToDesktop } from './utils/folder-drop';
import type { Fence as FenceType } from '../shared/types';
import type { WindowInfo, DrawRect } from './types';

const MIN_FENCE_WIDTH = 160;
const MIN_FENCE_HEIGHT = 100;
const DEFAULT_FENCE_WIDTH = 300;
const DEFAULT_FENCE_HEIGHT = 400;

function App() {
  const { fences, loadFences, saveFences, setPeekMode, addFence, applyIncoming, setRenameFence } = useFenceStore();
  const info = useDisplayStore((state) => state.info);
  const [showSettings, setShowSettings] = useState(false);
  const [showAutomation, setShowAutomation] = useState(false);
  const [showScheduled, setShowScheduled] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; fromButton?: boolean } | null>(null);
  // always points at the latest createFenceAt so callbacks registered once are never stale
  const createFenceRef = useRef<(rect?: DrawRect) => void>(() => {});
  // A folder dragged from File Explorer onto empty desktop space becomes a folder-linked fence
  const [dropActive, setDropActive] = useState<'files' | 'item' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const dropTimer = useRef<number | null>(null);
  // Drawing a new fence: `drawPreview` is the live rectangle (from a right-drag on the Desktop, or
  // from draw mode); draw mode is started by "New fence" in the menu / tray.
  const [drawPreview, setDrawPreview] = useState<DrawRect | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const drawStart = useRef<{ x: number; y: number } | null>(null);

  const showNotice = (message: string) => {
    setNotice(message);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 6000);
  };
  useEffect(() => () => { if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current); }, []);

  // Safety nets for the drop hint: whatever ends a drag anywhere in the window removes it
  useEffect(() => {
    const clear = () => {
      if (dropTimer.current !== null) {
        window.clearTimeout(dropTimer.current);
        dropTimer.current = null;
      }
      setDropActive(null);
    };
    window.addEventListener('drop', clear, true);
    // the drag that started in this window is over (dropped anywhere, or cancelled): release the mouse
    const dragEnded = () => {
      clear();
      window.electronAPI.endDragCapture?.();
    };
    window.addEventListener('dragend', dragEnded, true);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('drop', clear, true);
      window.removeEventListener('dragend', dragEnded, true);
      window.removeEventListener('blur', clear);
      if (dropTimer.current !== null) window.clearTimeout(dropTimer.current);
    };
  }, []);

  // Scheduled cleanup tasks: check every 30s; a task that was due while the app was closed runs once at start
  useEffect(() => {
    const running = new Set<string>();
    const tick = async () => {
      // only the primary-monitor window runs scheduled tasks, otherwise every monitor would run them
      if (!useDisplayStore.getState().info?.isController) return;
      for (const listed of useScheduledStore.getState().tasks) {
        // A cleanup can take minutes, so the list read above goes stale while earlier tasks run.
        // Re-read each task right before running it: one the user disabled, deleted or edited in
        // the meantime must not run with its old settings.
        const task = useScheduledStore.getState().tasks.find((t) => t.id === listed.id);
        if (!task || running.has(task.id) || !ScheduleEngine.shouldRun(task)) continue;
        running.add(task.id);
        try {
          await executeTask(task);
        } catch (error) {
          console.warn(`Scheduled task "${task.name}" failed:`, error);
        } finally {
          running.delete(task.id);
        }
      }
    };
    const first = setTimeout(tick, 5000);
    const timer = setInterval(tick, 30000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  // Startup: load fences, re-attach folder watchers, listen for main-process events
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // If the window info cannot be read, fall back to "single monitor": the fences must
      // still load and show, and nothing may stay blank.
      let windowInfo: WindowInfo;
      try {
        windowInfo = await loadWindowInfo();
      } catch (error) {
        console.error('Could not read window info, assuming one monitor:', error);
        windowInfo = { displayId: 0, isController: true, primaryDisplayId: 0, displays: [{ id: 0, primary: true, label: 'Monitor 1' }] };
        useDisplayStore.getState().setInfo(windowInfo);
      }
      window.electronAPI.getSettings().then((settings) => applyTheme(settings?.theme)).catch(() => applyTheme('auto'));
      await loadFences();
      if (cancelled || !windowInfo.isController) return;

      // Controller window only. Watchers live in the main process and are gone after a restart:
      // re-attach them, and refresh portal fences because the folder may have changed while the app was closed.
      const store = useFenceStore.getState();
      let changed = false;
      for (const fence of store.fences) {
        if (!fence.portalPath) continue;
        try {
          await watchForFence(fence.id, fence.portalPath);
          // ordered refresh that reads the fence after the await: a stale startup listing can no
          // longer overwrite a newer one applied by a folder event in the meantime
          await refreshPortalFence(fence.id);
          changed = true;
        } catch (error) {
          console.warn(`Portal folder unavailable: ${fence.portalPath}`, error);
        }
      }
      for (const watchPath of allWatchPaths()) {
        try {
          await window.electronAPI.watchFolder(watchPath);
        } catch (error) {
          console.warn(`Rule folder unavailable: ${watchPath}`, error);
        }
      }
      // Files that were moved in before a crash (or dropped into the folder by hand) show up,
      // and items whose file is gone are dropped. Only for folders that can actually be read.
      if (await reconcileManagedFences()) changed = true;
      if (changed) await store.saveFences();
    })();

    const unsubscribers = [
      window.electronAPI.onPeekStateChange((isPeekMode) => setPeekMode(isPeekMode)),
      // Another monitor's window saved: merge per fence (newer change wins), never replace the list
      window.electronAPI.onFencesUpdated(({ fences: incoming, deleted }) => applyIncoming(incoming, deleted)),
      window.electronAPI.onDisplaysChanged(() => {
        loadWindowInfo().catch(() => {});
      }),
      window.electronAPI.onSettingsChanged((settings) => applyTheme(settings?.theme)),

      // Right-click + drag on the Desktop (seen by the main process): live outline, then the fence
      window.electronAPI.onDrawPreview((rect) => setDrawPreview(rect)),
      window.electronAPI.onDrawFence((rect) => {
        setDrawPreview(null);
        createFenceRef.current(rect);
      }),

      // Tray menu: the window is click-through on empty space, so these are the
      // always-reachable way to open the app's panels. (Sent to the controller window only.)
      window.electronAPI.onTrayAction((action) => {
        if (action === 'new-fence') setDrawMode(true);
        else if (action === 'settings') setShowSettings(true);
        else if (action === 'automation') setShowAutomation(true);
        else if (action === 'scheduled') setShowScheduled(true);
      }),

      // Automation: a new file appeared in a watched folder -> per-fence and global rules decide.
      // Only the controller window acts, so a file is never handled twice.
      window.electronAPI.onFolderChanged((data) => {
        if (!useDisplayStore.getState().info?.isController) return;
        handleFolderEvent(data);
      }),
    ];

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  /**
   * Creates a fence in the drawn rectangle (kept on this monitor). A rectangle too small to be a
   * deliberate drawing (or none) gets the default size at that spot. The title opens for typing.
   */
  const createFenceAt = (rect?: DrawRect) => {
    const drawn = !!rect && rect.width >= 40 && rect.height >= 40;
    const width = drawn ? Math.max(MIN_FENCE_WIDTH, rect!.width) : DEFAULT_FENCE_WIDTH;
    const height = drawn ? Math.max(MIN_FENCE_HEIGHT, rect!.height) : DEFAULT_FENCE_HEIGHT;
    const cascade = (useFenceStore.getState().fences.length % 8) * 30;
    const x = rect ? rect.x : 100 + cascade;
    const y = rect ? rect.y : 100 + cascade;

    const newFence: FenceType = {
      id: `fence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, // unique even for two in the same ms
      name: 'New Fence',
      position: {
        x: Math.round(Math.min(Math.max(0, x), Math.max(0, window.innerWidth - width))),
        y: Math.round(Math.min(Math.max(0, y), Math.max(0, window.innerHeight - height))),
      },
      size: { width: Math.round(Math.min(width, window.innerWidth)), height: Math.round(Math.min(height, window.innerHeight)) },
      items: [],
      style: defaultFenceStyle(currentTheme()),
      displayId: useDisplayStore.getState().info?.displayId,
      gridSize: 80,
    };
    addFence(newFence);
    setRenameFence(newFence.id);
    saveFences();
  };
  createFenceRef.current = createFenceAt;

  // "New fence" from the menu / tray: the next drag on this monitor draws it
  const startDrawMode = () => {
    setContextMenu(null);
    setDrawMode(true);
  };

  useEffect(() => {
    if (!drawMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        drawStart.current = null;
        setDrawPreview(null);
        setDrawMode(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawMode]);

  const rectFrom = (a: { x: number; y: number }, b: { x: number; y: number }): DrawRect => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  });

  const handleDrawDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drawStart.current = { x: e.clientX, y: e.clientY };
    setDrawPreview(rectFrom(drawStart.current, drawStart.current));
  };
  const handleDrawMove = (e: React.MouseEvent) => {
    if (!drawStart.current) return;
    setDrawPreview(rectFrom(drawStart.current, { x: e.clientX, y: e.clientY }));
  };
  const handleDrawUp = (e: React.MouseEvent) => {
    if (!drawStart.current) return;
    const rect = rectFrom(drawStart.current, { x: e.clientX, y: e.clientY });
    drawStart.current = null;
    setDrawPreview(null);
    setDrawMode(false);
    createFenceAt(rect);
  };

  // ---- Folder dropped on empty desktop space --------------------------------------------------
  // The hint only exists while a file drag is over the BARE background. Drops on a fence, dialog or
  // button belong to that element. The hint also times out by itself (dragover repeats while a drag
  // is over the page), so a missed drop / cancelled drag can never leave it stuck on screen.
  const clearDropHint = () => {
    if (dropTimer.current !== null) {
      window.clearTimeout(dropTimer.current);
      dropTimer.current = null;
    }
    setDropActive(null);
  };

  const handleDesktopDragOver = (e: React.DragEvent) => {
    const kind = dragKind(e.dataTransfer);
    if (!kind) return;
    if (e.target !== e.currentTarget) {
      clearDropHint();
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = kind === 'item' ? 'move' : 'link';
    setDropActive(kind);
    if (dropTimer.current !== null) window.clearTimeout(dropTimer.current);
    dropTimer.current = window.setTimeout(() => {
      dropTimer.current = null;
      setDropActive(null);
    }, 700);
  };

  // Runs before ANY drop handler below it (fences stop the event from bubbling to the root)
  const handleDesktopDropCapture = (e: React.DragEvent) => {
    if (!dragKind(e.dataTransfer)) return;
    clearDropHint();
    window.electronAPI.endDragCapture?.(); // the drag is over: give the mouse back to the desktop
  };

  const handleDesktopDrop = async (e: React.DragEvent) => {
    const kind = dragKind(e.dataTransfer);
    if (!kind) return;
    e.preventDefault(); // never let the window navigate to the dropped file
    if (e.target !== e.currentTarget) return; // landed on a dialog/button, not the bare desktop

    // One of our own fence items dropped on the bare Desktop: the file goes back to the Desktop
    if (kind === 'item') {
      let payload: { itemId?: string; fenceId?: string } = {};
      try {
        payload = JSON.parse(e.dataTransfer.getData('application/json'));
      } catch {
        return;
      }
      if (!payload.itemId || !payload.fenceId) return;
      try {
        const message = await moveItemBackToDesktop(payload.fenceId, payload.itemId);
        if (message) showNotice(message);
      } catch (error) {
        showNotice(`Could not move it to the Desktop: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }

    const entries = readDroppedEntries(e.dataTransfer);

    // The browser's folder test can be wrong; the main process knows for sure
    const unsure = entries.filter((d) => d.path && !d.isDirectory);
    if (unsure.length > 0) {
      try {
        const flags = await window.electronAPI.arePathsFolders(unsure.map((d) => d.path));
        unsure.forEach((d, i) => {
          if (flags[i]) d.isDirectory = true;
        });
      } catch (error) {
        console.warn('Could not check dropped paths:', error);
      }
    }

    const folders = entries.filter((d) => d.isDirectory && d.path);
    const ignored = entries.length - folders.length;

    if (folders.length === 0) {
      showNotice(
        'Only folders create a fence, so nothing was moved. Drop files onto a fence to add them, or hold Shift while dropping to place them on the Desktop as usual.'
      );
      return;
    }

    try {
      const result = await createFencesFromFolders(folders, { x: e.clientX, y: e.clientY });
      const parts: string[] = [];
      if (result.created.length === 1) parts.push(`Created fence "${result.created[0]}".`);
      else if (result.created.length > 1) parts.push(`Created ${result.created.length} fences.`);
      if (result.existing.length > 0) parts.push(`${result.existing.map((n) => `"${n}"`).join(', ')} already has a fence.`);
      if (result.failed.length > 0) parts.push(`Could not create: ${result.failed.join('; ')}.`);
      if (ignored > 0) parts.push(`${ignored} file(s) ignored (only folders create fences).`);
      showNotice(parts.join(' '));
    } catch (error) {
      showNotice(`Could not create a fence: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Opens the same menu as right-click, from a button (empty-space right-clicks go to the real desktop)
  const openMenuFromButton = (e: React.MouseEvent) => {
    e.stopPropagation();
    setContextMenu(contextMenu ? null : {
      x: Math.max(8, window.innerWidth - 230),
      y: Math.max(8, window.innerHeight - 400),
      fromButton: true,
    });
  };

  return (
    <div
      className="w-full h-full relative"
      data-clickthrough="true"
      onContextMenu={handleContextMenu}
      onClick={() => setContextMenu(null)}
      onDragEnter={handleDesktopDragOver}
      onDragOver={handleDesktopDragOver}
      onDragLeave={clearDropHint}
      onDropCapture={handleDesktopDropCapture}
      onDrop={handleDesktopDrop}
    >
      {/* Render all fences */}
      {/* nothing is drawn until we know which monitor this window is on (no flash of every fence) */}
      {info &&
        fences
        .filter((fence) => fenceBelongsHere(fence, info))
        .map((fence) => (
          <Fence key={fence.id} fence={fence} />
        ))}

      {/* Drop hint while a folder is dragged over empty desktop space */}
      {dropActive && (
        <div className="fixed inset-4 z-40 rounded-xl border-2 border-dashed border-blue-400 bg-blue-500/10 flex items-center justify-center pointer-events-none">
          <div className="px-5 py-3 rounded-lg bg-gray-900/85 text-white text-lg shadow-lg">
            {dropActive === 'item' ? 'Drop here to move it back to the Desktop' : 'Drop a folder here to create a fence'}
          </div>
        </div>
      )}

      {/* Result of the last drop */}
      {notice && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 max-w-lg px-4 py-2 rounded-lg bg-gray-800 text-white text-sm shadow-lg pointer-events-none">
          {notice}
        </div>
      )}

      {/* Outline of the fence being drawn */}
      {drawPreview && (
        <div
          className="fixed z-[56] pointer-events-none rounded-lg border-2 border-dashed border-blue-400 bg-blue-500/15"
          style={{ left: drawPreview.x, top: drawPreview.y, width: drawPreview.width, height: drawPreview.height }}
        />
      )}

      {/* Draw mode ("New fence"): the whole monitor catches the mouse until a rectangle is drawn */}
      {drawMode && (
        <div
          className="fixed inset-0 z-[55] cursor-crosshair bg-black/10"
          onMouseDown={handleDrawDown}
          onMouseMove={handleDrawMove}
          onMouseUp={handleDrawUp}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            drawStart.current = null;
            setDrawPreview(null);
            setDrawMode(false);
          }}
        >
          {!drawPreview && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-gray-900/85 text-white text-sm shadow-lg pointer-events-none">
              Drag a rectangle to draw the new fence • Esc or right-click to cancel
            </div>
          )}
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onCreateFence={startDrawMode}
          onOpenSettings={() => {
            setShowSettings(true);
            setContextMenu(null);
          }}
          onOpenAutomation={() => {
            setShowAutomation(true);
            setContextMenu(null);
          }}
          onOpenScheduled={() => {
            setShowScheduled(true);
            setContextMenu(null);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Settings Panel */}
      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}

      {/* Automation Panel */}
      {showAutomation && (
        <AutomationPanel onClose={() => setShowAutomation(false)} />
      )}

      {/* Scheduled Tasks */}
      {showScheduled && (
        <ScheduledTasksDialog onClose={() => setShowScheduled(false)} />
      )}

      {/* Menu button (settings, automation, scheduled tasks, peek, hide) */}
      <button
        onClick={openMenuFromButton}
        className="fixed bottom-6 right-6 w-10 h-10 bg-gray-700 hover:bg-gray-600 text-white rounded-full shadow-lg flex items-center justify-center transition-all z-50"
        title="DeskFence menu"
      >
        ⋯
      </button>

    </div>
  );
}

export default App;
