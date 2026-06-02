import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { usePrefs } from '../store/prefs';

type UpdateInfo = { version: string; current: string; notes: string | null };

// The release track is resolved in Rust (the updater plugin can't switch
// endpoints from JS), so we just hand it the user's channel preference.
// `manual` surfaces "you're up to date" / failure feedback for the Settings
// button; the launch check stays silent.
export async function checkForUpdates(opts?: { manual?: boolean }): Promise<void> {
  if (import.meta.env.DEV) return;
  if (getCurrentWebviewWindow().label !== 'main') return;
  const channel = usePrefs.getState().updateChannel;
  try {
    const info = await invoke<UpdateInfo | null>('check_update', { channel });
    if (!info) {
      if (opts?.manual) alert(`You're on the latest ${channel} build.`);
      return;
    }
    const ok = confirm(
      `NubeNube ${info.version} is available (${channel}).\n\n${info.notes ?? ''}\n\nInstall now? The app will restart.`
    );
    if (ok) await invoke('install_update', { channel }); // downloads, installs, relaunches
  } catch (e) {
    if (opts?.manual) alert(`Update check failed: ${e}`);
    // launch check stays silent on failure
  }
}
