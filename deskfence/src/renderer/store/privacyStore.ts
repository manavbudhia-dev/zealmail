import { create } from 'zustand';

/** Privacy mode for ALL fences (settings.json `privacyMode`, shared by every monitor's window). */
interface PrivacyStore {
  all: boolean;
  setAll: (on: boolean) => void;
}

export const usePrivacyStore = create<PrivacyStore>((set) => ({
  all: false,
  setAll: (all) => set({ all }),
}));

/** Turns privacy mode for all fences on/off (saved; every window follows via settings-changed). */
export async function setPrivacyForAll(on: boolean): Promise<void> {
  usePrivacyStore.getState().setAll(on); // instant here; the broadcast confirms it everywhere
  await window.electronAPI.saveSettings({ privacyMode: on });
}
