import { create } from 'zustand'
import { api } from '../lib/api'
import { say } from './toast'
import type { Settings } from '../types'

type SettingsStore = {
  settings: Settings | null
  load: () => Promise<void>
  save: (patch: Partial<Settings>) => Promise<void>
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: null,
  load: async () => {
    set({ settings: await api.getSettings() })
  },
  save: async (patch) => {
    const cur = get().settings
    if (!cur) return
    const next: Settings = { ...cur, ...patch }
    set({ settings: next }) // optimistic
    try {
      await api.saveSettings(next)
    } catch (e) {
      say(`Couldn't save settings: ${e}`)
      await get().load()
    }
  },
}))
