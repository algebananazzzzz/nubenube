// prefs.ts — UI-only preferences kept in localStorage (shared across all the
// app's windows since they share an origin). Theme, sound, and the companion
// toggles. Changes propagate to the other window (main ↔ companion) via the
// `storage` event so a theme flip on Settings re-themes the floating companion.

import { create } from 'zustand'

export type Theme = 'dark' | 'light'

export type Prefs = {
  theme: Theme
  sound: boolean
  companion: boolean
  companionMini: boolean
}

const DEFAULTS: Prefs = {
  theme: 'dark',
  sound: true,
  companion: true,
  companionMini: false,
}

const KEY = 'nn_prefs_v1'

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS }
}

type PrefsStore = Prefs & { set: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void }

export const usePrefs = create<PrefsStore>((set) => ({
  ...read(),
  set: (k, v) =>
    set((s) => {
      const next = { ...s, [k]: v }
      try {
        const { set: _omit, ...data } = next
        void _omit
        localStorage.setItem(KEY, JSON.stringify(data))
      } catch {
        /* ignore */
      }
      return next
    }),
}))

// Cross-window sync: another window (e.g. the main window's Settings) wrote new
// prefs → mirror them into this window's store. Fires only in OTHER documents.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return
    try {
      usePrefs.setState({ ...DEFAULTS, ...JSON.parse(e.newValue) })
    } catch {
      /* ignore */
    }
  })
}
