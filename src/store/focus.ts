import { create } from 'zustand'
import { events } from '../lib/api'
import { mockFocusTick } from '../lib/mockData'
import type { FocusTick } from '../types'

type FocusStore = {
  tick: FocusTick
  subscribed: boolean
  subscribe: () => Promise<void>
}

export const useFocus = create<FocusStore>((set, get) => ({
  tick: mockFocusTick,
  subscribed: false,
  subscribe: async () => {
    if (get().subscribed) return
    set({ subscribed: true })
    await events.onFocusTick((t) => set({ tick: t }))
  },
}))
