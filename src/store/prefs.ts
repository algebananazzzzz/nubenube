// UI-only prefs in localStorage. The storage event syncs writes across the
// app's windows (main ↔ companion), so a theme flip on one re-themes the other.

import { create } from 'zustand'
import { CHIME_VOICES, type ChimeVoice } from '../lib/chime'

export type Theme = 'dark' | 'light'

export type Prefs = {
  theme: Theme
  sound: boolean // master toggle for chimes
  chimeVoice: ChimeVoice // timbre of the "Claude finished" chime
  chimeVolume: number // 0..1
  companion: boolean
  companionMini: boolean
}

const DEFAULTS: Prefs = {
  theme: 'dark',
  sound: true,
  chimeVoice: 'bell',
  chimeVolume: 0.6,
  companion: true,
  companionMini: false,
}

// localStorage is untyped — coerce a persisted voice back into the known set.
function normalize(p: Prefs): Prefs {
  return {
    ...p,
    chimeVoice: CHIME_VOICES.includes(p.chimeVoice) ? p.chimeVoice : DEFAULTS.chimeVoice,
    chimeVolume: Math.max(0, Math.min(1, Number(p.chimeVolume) || DEFAULTS.chimeVolume)),
  }
}

const KEY = 'nn_prefs_v1'

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return normalize({ ...DEFAULTS, ...JSON.parse(raw) })
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
      usePrefs.setState(normalize({ ...DEFAULTS, ...JSON.parse(e.newValue) }))
    } catch {
      /* ignore */
    }
  })
}
