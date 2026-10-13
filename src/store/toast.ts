import { create } from 'zustand'

// One transient message at a time, shown bottom-center in the main window.
type ToastStore = { notice: string | null; say: (n: string | null) => void }

export const useToast = create<ToastStore>((set) => ({
  notice: null,
  say: (notice) => set({ notice }),
}))

export const say = (n: string) => useToast.getState().say(n)
