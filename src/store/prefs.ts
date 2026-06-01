// prefs.ts — UI-only preferences kept in localStorage (shared across all the
// app's windows since they share an origin). These are the bits the prototype's
// Settings exposed that don't map to the Rust-backed Settings struct: which
// full-screen rescues fire, reminder cadence, sound, and the companion toggle.

import { create } from 'zustand'

export type Prefs = {
  sound: boolean
  companion: boolean
  introDone: boolean
}

const DEFAULTS: Prefs = {
  sound: true,
  companion: true,
  introDone: false,
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
