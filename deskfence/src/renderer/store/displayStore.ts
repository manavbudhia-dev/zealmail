import { create } from 'zustand';
import type { Fence } from '../../shared/types';
import type { WindowInfo } from '../types';

interface DisplayStore {
  info: WindowInfo | null;
  setInfo: (info: WindowInfo) => void;
}

export const useDisplayStore = create<DisplayStore>((set) => ({
  info: null,
  setInfo: (info) => set({ info }),
}));

export async function loadWindowInfo(): Promise<WindowInfo> {
  const info = await window.electronAPI.getWindowInfo();
  useDisplayStore.getState().setInfo(info);
  return info;
}

/** The monitor a fence is drawn on: its own, or the primary one if that monitor is gone / unset. */
export function fenceDisplayId(fence: Fence, info: WindowInfo): number {
  const known = fence.displayId !== undefined && info.displays.some((d) => d.id === fence.displayId);
  return known ? (fence.displayId as number) : info.primaryDisplayId;
}

export function fenceBelongsHere(fence: Fence, info: WindowInfo): boolean {
  return fenceDisplayId(fence, info) === info.displayId;
}

export function nextDisplayId(fence: Fence, info: WindowInfo): number {
  const ids = info.displays.map((d) => d.id);
  const current = ids.indexOf(fenceDisplayId(fence, info));
  return ids[(current + 1) % ids.length];
}
