import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { usePrefs } from '../store/prefs';
import { useUpdater } from '../store/updater';

type UpdateInfo = { version: string; current: string; notes: string | null };

// The release track is resolved in Rust (the updater plugin can't switch
// endpoints from JS), so we just hand it the user's channel preference.
//
// Wry does NOT render native window.confirm()/alert(), so a found update is
// surfaced through the updater store + <UpdatePrompt> modal rather than a native
// dialog. `manual` shows the "you're up to date" / failure notice for the
// Settings button; the launch check only pops the modal on a real update.
export async function checkForUpdates(opts?: { manual?: boolean }): Promise<void> {
  const u = useUpdater.getState();
  if (import.meta.env.DEV) {
    if (opts?.manual) u.setNotice('Update checks are disabled in dev builds.');
    return;
  }
  if (getCurrentWebviewWindow().label !== 'main') return;
  const channel = usePrefs.getState().updateChannel;
  try {
    const info = await invoke<UpdateInfo | null>('check_update', { channel });
    if (!info) {
      if (opts?.manual) u.setNotice(`You're on the latest ${channel} build.`);
      return;
    }
    u.setPending(info);
  } catch (e) {
    // A 404 on the stable endpoint means no production release exists yet — give
    // a friendlier nudge to Beta instead of the raw fetch error.
    if (opts?.manual) {
      const msg = String(e);
      const noStableRelease = channel === 'stable' && /release JSON|fetch|404/i.test(msg);
      u.setNotice(
        noStableRelease
          ? 'No stable release published yet — switch to Beta for the latest builds.'
          : `Update check failed: ${e}`
      );
    }
    // launch check stays silent on failure
  }
}

// Confirmed from the modal: download, install, relaunch (handled in Rust).
export async function installPendingUpdate(): Promise<void> {
  const channel = usePrefs.getState().updateChannel;
  const u = useUpdater.getState();
  u.setInstalling(true);
  try {
    await invoke('install_update', { channel });
  } catch (e) {
    u.setInstalling(false);
    u.setPending(null);
    u.setNotice(`Update failed: ${e}`);
  }
}
