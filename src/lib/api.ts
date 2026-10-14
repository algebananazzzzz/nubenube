// Bridge to the native (Rust) side. Inside Tauri every call goes to Rust and its
// errors reach the caller; in a plain browser the mock engine answers instead,
// so the UI stays navigable under `npm run dev`.

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { FocusEvent, FocusTick, Insights, RangeKey, Settings, TrackingHelper } from '../types'
import { mockApps, mockEngine, mockInsights, mockSettings } from './mockData'

export const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as unknown as object)

function call<T>(cmd: string, args: Record<string, unknown>, mock: () => T): Promise<T> {
  return isTauri ? invoke<T>(cmd, args) : Promise.resolve(mock())
}

export const api = {
  getFocus: () => call<FocusTick>('get_focus', {}, mockEngine.get),
  startTimer: (minutes: number) => call<void>('start_timer', { minutes }, () => mockEngine.startTimer(minutes)),
  stopTimer: () => call<number>('stop_timer', {}, mockEngine.stopTimer),
  pauseTimer: () => call<void>('pause_timer', {}, mockEngine.pauseTimer),
  resumeTimer: () => call<void>('resume_timer', {}, mockEngine.resumeTimer),
  setTarget: (secs: number) => call<void>('set_target', { secs }, () => mockEngine.setTarget(secs)),
  setDayTarget: (day: number, secs: number | null) =>
    call<void>('set_day_target', { day, secs }, () => mockEngine.setDayTarget(day, secs)),
  setDayRest: (day: number, secs: number) => call<void>('set_day_rest', { day, secs }, () => mockEngine.setDayRest(day, secs)),
  getInsights: (range: RangeKey) => call<Insights>('get_insights', { range }, () => mockInsights(range)),
  getSettings: () => call<Settings>('get_settings', {}, () => mockSettings),
  saveSettings: (settings: Settings) => call<Settings>('save_settings', { settings }, () => settings),
  listApps: () => call<string[]>('list_apps', {}, () => mockApps),
  trackingHelper: () => call<TrackingHelper>('tracking_helper', {}, () => 'ok'),
  installTrackingHelper: () => call<TrackingHelper>('install_tracking_helper', {}, () => 'ok'),
  installBrowserExtension: () => call<string>('install_browser_extension', {}, () => '~/.local/share/com.nubenube.app/chrome-extension'),
}

function subscribe<T>(event: string, cb: (payload: T) => void, mock: (cb: (payload: T) => void) => () => void): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(mock(cb))
  return listen<T>(event, (e) => cb(e.payload))
}

export const events = {
  onFocusTick: (cb: (t: FocusTick) => void) => subscribe('focus-tick', cb, mockEngine.onTick),
  onFocusEvent: (cb: (e: FocusEvent) => void) => subscribe('focus-event', cb, mockEngine.onEvent),
}
