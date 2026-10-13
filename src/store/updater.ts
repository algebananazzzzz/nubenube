import { create } from 'zustand'

// In-app update UX state. Wry doesn't render native window.confirm()/alert(), so
// checkForUpdates() stashes a found update here and <UpdatePrompt> renders it.
export type PendingUpdate = { version: string; current: string; notes: string | null }

type UpdaterStore = {
  pending: PendingUpdate | null // a found, not-yet-installed update → shows the modal
  installing: boolean
  setPending: (p: PendingUpdate | null) => void
  setInstalling: (b: boolean) => void
}

export const useUpdater = create<UpdaterStore>((set) => ({
  pending: null,
  installing: false,
  setPending: (pending) => set({ pending }),
  setInstalling: (installing) => set({ installing }),
}))
