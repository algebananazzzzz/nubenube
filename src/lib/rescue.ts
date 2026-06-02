// Wrappers over the Rust window-control commands for the companion window.
// All no-ops outside Tauri.

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
  // Size the OS companion window to the content the webview measured (logical px).
  resizeCompanion: (width: number, height: number) => safe('nube_resize_companion', { width, height }),
  openMain: () => safe('nube_open_main'),
  setPaused: (paused: boolean) => safe('nube_set_paused', { paused }),
}
