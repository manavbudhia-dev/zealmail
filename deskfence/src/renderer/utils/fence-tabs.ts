import type { Fence, FenceItem, FenceTab } from '../../shared/types';

/*
 * Tabs model: `fence.items` is ALWAYS the visible (active) tab's items, so drops, removal, rules
 * and portals keep working unchanged. Inactive tabs keep their own items in `tabs[i].items`.
 * All tabs of a fence share the fence's one real folder (Documents\DeskFence\<name>).
 */

export function hasTabs(fence: Fence): boolean {
  return !!fence.tabs && fence.tabs.length > 1;
}

export function activeTabId(fence: Fence): string | undefined {
  if (!fence.tabs || fence.tabs.length === 0) return undefined;
  return fence.tabs.some((t) => t.id === fence.activeTabId) ? fence.activeTabId : fence.tabs[0].id;
}

/** Every item of the fence, across all tabs. */
export function allFenceItems(fence: Fence): FenceItem[] {
  if (!fence.tabs || fence.tabs.length === 0) return fence.items;
  const active = activeTabId(fence);
  return fence.tabs.flatMap((tab) => (tab.id === active ? fence.items : tab.items));
}

function newTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Tabs with the active tab's current items written back into its slot. */
function snapshot(fence: Fence): FenceTab[] {
  const active = activeTabId(fence);
  return (fence.tabs || []).map((tab) => (tab.id === active ? { ...tab, items: fence.items } : tab));
}

/** Adds a tab and switches to it. The first call turns a normal fence into a 2-tab fence. */
export function addTab(fence: Fence): Partial<Fence> {
  const existing: FenceTab[] =
    fence.tabs && fence.tabs.length > 0 ? snapshot(fence) : [{ id: newTabId(), name: 'Tab 1', items: fence.items }];
  const created: FenceTab = { id: newTabId(), name: `Tab ${existing.length + 1}`, items: [] };
  return { tabs: [...existing, created], activeTabId: created.id, items: [] };
}

export function switchTab(fence: Fence, tabId: string): Partial<Fence> {
  if (!fence.tabs || tabId === activeTabId(fence)) return {};
  const target = fence.tabs.find((t) => t.id === tabId);
  if (!target) return {};
  return { tabs: snapshot(fence), activeTabId: tabId, items: target.items };
}

export function renameTab(fence: Fence, tabId: string, name: string): Partial<Fence> {
  const clean = name.trim();
  if (!fence.tabs || !clean) return {};
  return { tabs: fence.tabs.map((t) => (t.id === tabId ? { ...t, name: clean.slice(0, 40) } : t)) };
}

/**
 * Closes a tab. Its items are NOT lost: they move to the neighbouring tab.
 * Closing down to one tab turns the fence back into a normal (tab-less) fence.
 */
export function removeTab(fence: Fence, tabId: string): Partial<Fence> {
  if (!fence.tabs || fence.tabs.length < 2) return {};
  const tabs = snapshot(fence);
  const index = tabs.findIndex((t) => t.id === tabId);
  if (index < 0) return {};

  const removed = tabs[index];
  const neighbourIndex = index > 0 ? index - 1 : 1;
  const neighbour = tabs[neighbourIndex];
  const merged = tabs
    .filter((t) => t.id !== tabId)
    .map((t) => (t.id === neighbour.id ? { ...t, items: [...t.items, ...removed.items] } : t));

  const wasActive = activeTabId(fence) === tabId;
  const nextActiveId = wasActive ? neighbour.id : (activeTabId(fence) as string);
  const nextActive = merged.find((t) => t.id === nextActiveId) as FenceTab;

  if (merged.length === 1) {
    return { tabs: undefined, activeTabId: undefined, items: nextActive.items };
  }
  return { tabs: merged, activeTabId: nextActiveId, items: nextActive.items };
}

/** Moves a visible item into another tab of the same fence. */
export function moveItemToTab(fence: Fence, itemId: string, tabId: string): Partial<Fence> {
  if (!fence.tabs || tabId === activeTabId(fence)) return {};
  const item = fence.items.find((i) => i.id === itemId);
  if (!item || !fence.tabs.some((t) => t.id === tabId)) return {};
  return {
    items: fence.items.filter((i) => i.id !== itemId),
    tabs: snapshot(fence).map((t) => (t.id === tabId ? { ...t, items: [...t.items, item] } : t)),
  };
}
