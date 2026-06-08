import { create } from 'zustand'
import { api } from '../lib/api'
import type { ConnectionStatus, Insights, Project, RangeKey, Totals } from '../types'

type UsageState = {
  projects: Project[]
  totals: Totals | null
  insights: Insights | null
  connection: ConnectionStatus | null
  range: RangeKey
  live: boolean // true when data came from the real connector, false = mock
  loading: boolean
  loaded: boolean
  loadAll: () => Promise<void>
  setRange: (r: RangeKey) => Promise<void>
  refreshInsights: () => Promise<void>
  rescan: () => Promise<void>
}

export const useUsage = create<UsageState>((set, get) => ({
  projects: [],
  totals: null,
  insights: null,
  connection: null,
  range: 'today',
  live: false,
  loading: false,
  loaded: false,
  loadAll: async () => {
    set({ loading: true })
    const [p, t, i, c] = await Promise.all([
      api.getProjects(),
      api.getTotals(),
      api.getInsights(get().range),
      api.getConnection(),
    ])
    set({
      projects: p.data,
      totals: t.data,
      insights: i.data,
      connection: c.data,
      live: p.live,
      loading: false,
      loaded: true,
    })
  },
  setRange: async (r) => {
    set({ range: r })
    const i = await api.getInsights(r)
    set({ insights: i.data })
  },
  // Re-fetch only insights for the current range — keeps the concurrency graph
  // live (time axis advances, current bucket fills) without a full reload flicker.
  refreshInsights: async () => {
    const i = await api.getInsights(get().range)
    set({ insights: i.data })
  },
  rescan: async () => {
    set({ loading: true })
    const c = await api.rescanLogs()
    set({ connection: c.data })
    await get().loadAll()
  },
}))
