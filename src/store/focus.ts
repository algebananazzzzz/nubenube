import { create } from 'zustand'
import { api, events, isTauri } from '../lib/api'
import { mockEngine } from '../lib/mockData'
import type { FocusTick } from '../types'

type FocusStore = {
  tick: FocusTick
  subscribed: boolean
  subscribe: () => Promise<void>
}

const EMPTY: FocusTick = {
  state: 'idle', app: '', appClass: 'neutral', away: false, left: 0, len: 0, run: 0, pending: 0,
  weekday: (new Date().getDay() + 6) % 7,
  week: Array.from({ length: 7 }, () => ({ focus: 0, distract: 0, earned: 0, spent: 0, target: null, hit: false, bonus: 0, restPlan: 0 })),
  bank: 0,
  extension: false,
}

export const useFocus = create<FocusStore>((set, get) => ({
  tick: isTauri ? EMPTY : mockEngine.get(),
  subscribed: false,
  subscribe: async () => {
    if (get().subscribed) return
    set({ subscribed: true })
    await events.onFocusTick((t) => set({ tick: t }))
    set({ tick: await api.getFocus() })
  },
}))
