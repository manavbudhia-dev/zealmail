import React, { useEffect, useRef } from 'react';

interface ContextMenuProps {
  x: number;
  y: number;
  onCreateFence: () => void;
  onOpenSettings: () => void;
  onOpenAutomation: () => void;
  onOpenScheduled: () => void;
  onOrganize: () => void;
  onClose: () => void;
}

const MENU_WIDTH = 220;
const MENU_HEIGHT = 340;

/** The DeskFence menu (right-click on a fence area, or the ⋯ button). */
const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  onCreateFence,
  onOpenSettings,
  onOpenAutomation,
  onOpenScheduled,
  onOrganize,
  onClose,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  // Escape closes it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const item = (label: string, action: () => void, hint?: string) => (
    <button
      className="w-full text-left px-4 py-2 hover:bg-gray-700 flex items-center justify-between"
      onClick={(e) => {
        e.stopPropagation();
        action();
      }}
    >
      <span>{label}</span>
      {hint && <span className="text-xs text-gray-400 whitespace-nowrap">{hint}</span>}
    </button>
  );

  return (
    <div
      ref={ref}
      className="fixed z-[60] bg-gray-800 border border-gray-600 rounded-lg shadow-2xl py-1 text-sm text-white"
      style={{
        width: MENU_WIDTH,
        left: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - MENU_HEIGHT - 8)),
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {item('➕ New fence', onCreateFence, 'drag to draw')}
      {item('🧹 Organize my Desktop…', onOrganize)}
      <div className="my-1 border-t border-gray-700" />
      {item('⚡ Automation rules', onOpenAutomation)}
      {item('🗓 Scheduled tasks', onOpenScheduled)}
      {item('⚙️ Settings', onOpenSettings)}
      <div className="my-1 border-t border-gray-700" />
      {item('👁 Peek (hide all fences)', () => {
        onClose();
        window.electronAPI.togglePeek();
      })}
      {item('🙈 Hide DeskFence', () => {
        onClose();
        window.electronAPI.closeWindow();
      })}
    </div>
  );
};

export default ContextMenu;
