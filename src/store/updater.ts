import { create } from 'zustand'

// In-app update UX state. Wry doesn't render native window.confirm()/alert(), so
// checkForUpdates() stashes its result here and <UpdatePrompt> renders it.
export type PendingUpdate = { version: string; current: string; notes: string | null }

type UpdaterStore = {
  pending: PendingUpdate | null // a found, not-yet-installed update → shows the modal
  notice: string | null // transient message for the manual "Check" button
  installing: boolean
  setPending: (p: PendingUpdate | null) => void
  setNotice: (n: string | null) => void
  setInstalling: (b: boolean) => void
}

export const useUpdater = create<UpdaterStore>((set) => ({
  pending: null,
  notice: null,
  installing: false,
  setPending: (pending) => set({ pending }),
  setNotice: (notice) => set({ notice }),
  setInstalling: (installing) => set({ installing }),
}))
