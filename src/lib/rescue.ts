// rescue.ts — thin frontend wrappers over the Rust window-control commands that
// drive the real OS companion + full-screen takeover windows. All no-ops outside
// Tauri (browser preview falls back to in-app overlays).

import { invoke } from '@tauri-apps/api/core'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTauri } from './api'

async function safe(cmd: string, args?: Record<string, unknown>) {
  if (!isTauri) return
  try {
    await invoke(cmd, args)
  } catch (e) {
    console.warn(`[nube] ${cmd} failed`, e)
  }
}

export const rescue = {
  showTakeover: () => safe('nube_show_takeover'),
  hideTakeover: () => safe('nube_hide_takeover'),
  setCompanion: (visible: boolean) => safe('nube_set_companion', { visible }),
  openMain: () => safe('nube_open_main'),
  setPaused: (paused: boolean) => safe('nube_set_paused', { paused }),
}

// The takeover window tells the main-window supervisor what the user did.
export type RescueAction = 'back' | 'snooze'

export function emitRescue(action: RescueAction) {
  if (isTauri) void emit('nn-rescue', { action })
}

export async function onRescue(cb: (action: RescueAction) => void): Promise<UnlistenFn> {
  if (!isTauri) return () => {}
  try {
    return await listen<{ action: RescueAction }>('nn-rescue', (e) => cb(e.payload.action))
  } catch {
    return () => {}
  }
}
