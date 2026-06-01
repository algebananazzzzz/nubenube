// rescue.ts — thin frontend wrappers over the Rust window-control commands that
// drive the real OS companion window. All no-ops outside Tauri.

import { invoke } from '@tauri-apps/api/core'
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
  setCompanion: (visible: boolean) => safe('nube_set_companion', { visible }),
  openMain: () => safe('nube_open_main'),
  setPaused: (paused: boolean) => safe('nube_set_paused', { paused }),
}
