import { create } from 'zustand'
import { api } from '../lib/api'
import type { Settings } from '../types'

type SettingsStore = {
  settings: Settings | null
  live: boolean
  loaded: boolean
  load: () => Promise<void>
  save: (patch: Partial<Settings>) => Promise<void>
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: null,
  live: false,
  loaded: false,
  load: async () => {
    const r = await api.getSettings()
    set({ settings: r.data, live: r.live, loaded: true })
  },
  save: async (patch) => {
    const cur = get().settings
    if (!cur) return
    const next: Settings = { ...cur, ...patch }
    set({ settings: next }) // optimistic
    await api.saveSettings(next)
  },
}))
