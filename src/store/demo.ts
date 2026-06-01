// demo.ts — preview overrides for the main window only. Real drift states
// (gasping / fading / faint) are rare; the demo dock (shown when running on
// sample data) lets you step through every phase without actually drifting
// for five minutes. Has no effect on live data flow.

import { create } from 'zustand'
import type { Phase } from '../lib/derive'

type DemoStore = {
  phase: Phase | null // overrides the derived phase on Home/Companion preview
  introNonce: number // bump to replay the intro
  setPhase: (p: Phase | null) => void
  replayIntro: () => void
}

export const useDemo = create<DemoStore>((set) => ({
  phase: null,
  introNonce: 0,
  setPhase: (p) => set({ phase: p }),
  replayIntro: () => set((s) => ({ introNonce: s.introNonce + 1 })),
}))
