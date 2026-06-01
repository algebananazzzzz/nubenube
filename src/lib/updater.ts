import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

export async function checkForUpdates(): Promise<void> {
  if (import.meta.env.DEV) return;
  if (getCurrentWebviewWindow().label !== 'main') return;
  try {
    const update = await check();
    if (!update) return;
    const ok = confirm(
      `NubeNube ${update.version} is available.\n\n${update.body ?? ''}\n\nInstall now?`
    );
    if (ok) {
      await update.downloadAndInstall();
      await relaunch();
    }
  } catch {
    // don't surface updater failures to the user
  }
}
