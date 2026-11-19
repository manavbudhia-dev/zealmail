import { create } from 'zustand';
import type { Fence, FenceItem } from '../../shared/types';
import { applyIncomingFences } from '../utils/fence-merge';

/** Ids this window has seen. An id that was known but is gone now = deleted here (sent on save). */
export const knownFenceIds = new Set<string>();
/** Ids brought back on purpose (import / restore) that main may have tombstoned this session. */
const revivedFenceIds = new Set<string>();
let loaded = false;

const now = () => Date.now();
/** Every change stamps the fence, so the newest change wins when windows merge. */
const touch = (fence: Fence, updates: Partial<Fence> = {}): Fence => ({ ...fence, ...updates, updatedAt: now() });
const remember = (fences: Fence[]) => fences.forEach((f) => knownFenceIds.add(f.id));

interface FenceStore {
  fences: Fence[];
  isPeekMode: boolean;
  selectedFenceId: string | null;
  selectedItemId: string | null;
  /** A fence that was just drawn: its title opens for typing once (view state only). */
  renameFenceId: string | null;

  // Actions
  setFences: (fences: Fence[]) => void; // replaces everything (import); stamps all fences as new
  applyIncoming: (fences: Fence[], deleted?: string[]) => void;
  addFence: (fence: Fence) => void;
  updateFence: (fenceId: string, updates: Partial<Fence>) => void;
  deleteFence: (fenceId: string) => void;

  addItemToFence: (fenceId: string, item: FenceItem) => void;
  removeItemFromFence: (fenceId: string, itemId: string) => void;
  updateItemInFence: (fenceId: string, itemId: string, updates: Partial<FenceItem>) => void;
  moveItemBetweenFences: (fromFenceId: string, toFenceId: string, itemId: string) => void;

  setPeekMode: (isPeekMode: boolean) => void;
  setSelectedFence: (fenceId: string | null) => void;
  setSelectedItem: (itemId: string | null) => void;
  setRenameFence: (fenceId: string | null) => void;

  loadFences: () => Promise<void>;
  saveFences: () => Promise<void>;
}

export const useFenceStore = create<FenceStore>((set, get) => ({
  fences: [],
  isPeekMode: false,
  selectedFenceId: null,
  selectedItemId: null,
  renameFenceId: null,

  setFences: (fences) => {
    const stamped = fences.map((f) => touch(f));
    // an imported backup may reuse ids deleted earlier this session: tell main they are wanted again
    stamped.forEach((f) => revivedFenceIds.add(f.id));
    remember(stamped);
    set({ fences: stamped });
  },

  applyIncoming: (fences, deleted = []) => {
    set((state) => ({ fences: applyIncomingFences(state.fences, fences, deleted, knownFenceIds) }));
    for (const id of deleted) knownFenceIds.delete(id);
    remember(get().fences);
  },

  addFence: (fence) => {
    knownFenceIds.add(fence.id);
    set((state) => ({ fences: [...state.fences, touch(fence)] }));
  },

  updateFence: (fenceId, updates) => set((state) => ({
    fences: state.fences.map((f) =>
      f.id === fenceId ? touch(f, updates) : f
    ),
  })),

  deleteFence: (fenceId) => set((state) => ({
    fences: state.fences.filter((f) => f.id !== fenceId),
    selectedFenceId: state.selectedFenceId === fenceId ? null : state.selectedFenceId,
  })),

  addItemToFence: (fenceId, item) => set((state) => ({
    fences: state.fences.map((f) =>
      f.id === fenceId
        ? touch(f, { items: [...f.items, item] })
        : f
    ),
  })),

  removeItemFromFence: (fenceId, itemId) => set((state) => ({
    fences: state.fences.map((f) =>
      f.id === fenceId
        ? touch(f, { items: f.items.filter((item) => item.id !== itemId) })
        : f
    ),
  })),

  updateItemInFence: (fenceId, itemId, updates) => set((state) => ({
    fences: state.fences.map((f) =>
      f.id === fenceId
        ? touch(f, {
            items: f.items.map((item) =>
              item.id === itemId ? { ...item, ...updates } : item
            ),
          })
        : f
    ),
  })),

  moveItemBetweenFences: (fromFenceId, toFenceId, itemId) => set((state) => {
    const fromFence = state.fences.find((f) => f.id === fromFenceId);
    const item = fromFence?.items.find((i) => i.id === itemId);

    if (!item) return state;

    return {
      fences: state.fences.map((f) => {
        if (f.id === fromFenceId) {
          return touch(f, { items: f.items.filter((i) => i.id !== itemId) });
        }
        if (f.id === toFenceId) {
          return touch(f, { items: [...f.items, item] });
        }
        return f;
      }),
    };
  }),

  setPeekMode: (isPeekMode) => set({ isPeekMode }),
  setSelectedFence: (fenceId) => set({ selectedFenceId: fenceId }),
  setSelectedItem: (itemId) => set({ selectedItemId: itemId }),
  setRenameFence: (fenceId) => set({ renameFenceId: fenceId }),

  loadFences: async () => {
    try {
      const fromDisk = (await window.electronAPI.getFences()) || [];
      // merge instead of replace: a fence created while loading must not be thrown away
      set((state) => ({ fences: applyIncomingFences(state.fences, fromDisk, [], knownFenceIds) }));
      remember(get().fences);
      loaded = true;
    } catch (error) {
      console.error('Failed to load fences:', error);
    }
  },

  saveFences: async () => {
    // Never save before the saved fences have been read: an empty/partial list must not be able
    // to replace what is on disk.
    if (!loaded) {
      await get().loadFences();
      if (!loaded) {
        console.warn('Fences are not loaded yet, not saving.');
        return;
      }
    }
    try {
      const fences = get().fences;
      const ids = new Set(fences.map((f) => f.id));
      const deleted = [...knownFenceIds].filter((id) => !ids.has(id));
      const revived = [...revivedFenceIds].filter((id) => ids.has(id));

      const result = await window.electronAPI.saveFences(fences, deleted, revived);
      if (result && result.success) {
        revived.forEach((id) => revivedFenceIds.delete(id));
        // The reply is the merged list: a newer copy from another window may have won.
        // Our edits made while this save was in flight are newer, so they are kept.
        get().applyIncoming(result.fences || fences, [...deleted, ...(result.deleted || [])]);
      } else {
        console.error('Saving fences was refused:', result && (result as any).error);
      }
    } catch (error) {
      console.error('Failed to save fences:', error);
    }
  },
}));
