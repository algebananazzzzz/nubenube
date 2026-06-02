// Bridge to the native (Rust) side. Every call falls back to mock data when the
// command is missing or running outside Tauri, so the UI is always navigable.

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  ConnectionStatus,
  FocusTick,
  Insights,
  KnownApp,
  Project,
  ProjectDetail,
  RangeKey,
  Settings,
  Totals,
} from '../types'
import {
  mockConnection,
  mockInsights,
  mockKnownApps,
  mockProjectDetail,
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
  getProjectDetail: (id: string, range: RangeKey) =>
    call<ProjectDetail | null>('get_project_detail', { id, range }, () => mockProjectDetail(id, range)),
  getKnownApps: () => call<KnownApp[]>('get_known_apps', {}, () => mockKnownApps),
  listRunningApps: () => call<string[]>('list_running_apps', {}, () => mockKnownApps.map((a) => a.name)),
  installNotificationSound: (data: Uint8Array, ext: string) =>
    call<{ name: string; path: string }>('install_notification_sound', { data: Array.from(data), ext }, () => ({ name: '', path: '' })),
  removeNotificationSound: () =>
    call<void>('remove_notification_sound', {}, () => undefined),
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
}
