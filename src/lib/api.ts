// The single bridge to the native (Rust) side. Every call gracefully falls back
// to the mock layer when a command is missing or we're running in a plain
// browser (vite dev without Tauri), so the UI is always navigable.

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  ConnectionStatus,
  DayPoint,
  FocusTick,
  Insights,
  KnownApp,
  Project,
  RangeKey,
  Settings,
  Totals,
} from '../types'
import {
  mockConnection,
  mockInsights,
  mockProjectByDay,
  mockProjects,
  mockSettings,
  mockTotals,
} from './mockData'

export const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as unknown as object)

export type Result<T> = { data: T; live: boolean }

async function call<T>(cmd: string, args: Record<string, unknown>, fallback: () => T): Promise<Result<T>> {
  if (isTauri) {
    try {
      const data = await invoke<T>(cmd, args)
      return { data, live: true }
    } catch (e) {
      console.warn(`[nube] invoke('${cmd}') failed — using mock data:`, e)
    }
  }
  return { data: fallback(), live: false }
}

export type ProjectDetail = { project: Project; byDay: DayPoint[] }

export const api = {
  getProjects: () => call<Project[]>('get_projects', {}, () => mockProjects),
  getTotals: () => call<Totals>('get_totals', {}, () => mockTotals),
  getInsights: (range: RangeKey) => call<Insights>('get_insights', { range }, () => mockInsights(range)),
  getConnection: () => call<ConnectionStatus>('get_connection_status', {}, () => mockConnection),
  getSettings: () => call<Settings>('get_settings', {}, () => mockSettings),
  saveSettings: (settings: Settings) => call<Settings>('save_settings', { settings }, () => settings),
  rescanLogs: () => call<ConnectionStatus>('rescan_logs', {}, () => mockConnection),
  installHooks: () =>
    call<ConnectionStatus>('install_hooks', {}, () => ({ ...mockConnection, hooksInstalled: true })),
  uninstallHooks: () =>
    call<ConnectionStatus>('uninstall_hooks', {}, () => ({ ...mockConnection, hooksInstalled: false })),
  requestPermission: (kind: 'screenRecording' | 'automation') =>
    call<ConnectionStatus>('request_permission', { kind }, () => mockConnection),
  getProjectDetail: (id: string) =>
    call<ProjectDetail>('get_project_detail', { id }, () => ({
      project: mockProjects.find((p) => p.id === id) ?? mockProjects[0],
      byDay: mockProjectByDay(id),
    })),
  resetToday: () => call<void>('reset_today', {}, () => undefined),
  getKnownApps: () => call<KnownApp[]>('get_known_apps', {}, () => []),
  listRunningApps: () => call<string[]>('list_running_apps', {}, () => []),
  exportData: () => call<string>('export_data', {}, () => JSON.stringify({ projects: mockProjects }, null, 2)),
}

async function subscribe<T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri) return () => {}
  try {
    return await listen<T>(event, (e) => cb(e.payload))
  } catch {
    return () => {}
  }
}

export const events = {
  onFocusTick: (cb: (t: FocusTick) => void) => subscribe<FocusTick>('focus-tick', cb),
  onUsageUpdated: (cb: () => void) => subscribe<unknown>('usage-updated', () => cb()),
  onDriftMoment: (cb: (t: FocusTick) => void) => subscribe<FocusTick>('drift-moment', cb),
}
