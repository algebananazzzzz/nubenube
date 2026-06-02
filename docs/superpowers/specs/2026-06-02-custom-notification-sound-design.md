# Custom Notification Sound

**Date:** 2026-06-02  
**Status:** Approved

## Goal

Let users replace the OS default notification chime with a custom audio file. The drift notification ("Your Nube is drifting") is the target — the in-app finish chime is already customizable.

## Approach

Approach B: macOS gets native OS notification sound (file installed to `~/Library/Sounds/`); Windows/Linux get a companion-window side-channel (`play-notification-sound` Tauri event → `<audio>` element).

## Data Model

Two new fields added to the Rust-backed `Settings` struct (and mirrored in `src/types.ts`):

```
notificationSoundName: string | null   // stem name, e.g. "nn_alert"; null = system default
notificationSoundPath: string | null   // absolute path in <app-data>/sounds/nn_alert.<ext>
```

These live in the Rust-backed settings JSON (not localStorage `prefs`) so `notify.rs` can read them without frontend involvement.

Default: both `null` → behaviour unchanged from today.

## Rust Changes

### `settings.rs`

Add fields with `#[serde(default)]` so existing settings files deserialise without error:

```rust
#[serde(default)]
pub notification_sound_name: Option<String>,
#[serde(default)]
pub notification_sound_path: Option<String>,
```

### New command: `install_notification_sound`

```rust
#[tauri::command]
async fn install_notification_sound(
    data: Vec<u8>,
    ext: String,
    state: State<'_, AppState>,
) -> Result<NotificationSoundResult, String>
```

Steps:
1. Validate `ext` is in an allowlist (`wav`, `mp3`, `aiff`, `ogg`, `flac`) — reject anything else.
2. Write bytes to `<app-data>/sounds/nn_alert.<ext>` (create dir if needed, overwrite prior file).
3. macOS only (`#[cfg(target_os = "macos")]`): copy to `~/Library/Sounds/nn_alert.<ext>`.
4. Load current settings, set `notification_sound_name = Some("nn_alert")` and `notification_sound_path = Some(<absolute-path>)`, save atomically.
5. Return `{ name: "nn_alert", path: "<absolute-path>" }`.

### New command: `remove_notification_sound`

```rust
#[tauri::command]
async fn remove_notification_sound(state: State<'_, AppState>) -> Result<(), String>
```

Steps:
1. Read `notification_sound_path` from settings; if set, delete that exact file.
2. macOS only: derive the `~/Library/Sounds/` path from the filename and delete it.
3. Clear both settings fields (`None`), save atomically.

### `notify.rs` — `drift()`

Signature gains a `sound_name: Option<&str>` and `sound_path: Option<&str>` parameter (passed from the drift watcher which already holds settings).

```rust
pub fn drift(app: &AppHandle, app_name: &str, project: &str,
             sound_name: Option<&str>, sound_path: Option<&str>)
```

Behaviour:
- macOS (`#[cfg(target_os = "macos")]`): `.sound(sound_name.unwrap_or("default"))`
- Other platforms: `.sound("default")` + if `sound_path.is_some()` emit event:
  ```rust
  let _ = app.emit("play-notification-sound", sound_path);
  ```

## Frontend Changes

### `src/types.ts`

```ts
export type Settings = {
  // ... existing fields ...
  notificationSoundName: string | null
  notificationSoundPath: string | null
}
```

### `src/lib/api.ts`

Two new invoke wrappers (both with isTauri guard and mock fallback):

```ts
installNotificationSound(data: Uint8Array, ext: string): Promise<{ name: string; path: string }>
removeNotificationSound(): Promise<void>
```

### `src/pages/Settings.tsx`

Under the "Sound" section, after the existing chime voice + volume rows, add a "Notification sound" `PrefRow` (visible only when `sound` is on):

- **Left label/desc:** "Notification sound" / "Plays when you drift to a distraction app."
- **Right controls:**
  - If no custom sound: "Browse…" button (triggers hidden `<input type="file" accept="audio/*">`)
  - If custom sound set: filename pill + preview button (▶) + remove button (×)
- On file selected: read as `ArrayBuffer` → `Uint8Array` → call `api.installNotificationSound(data, ext)` → call `loadSettings()` on the settings store to refresh (the Rust command already persisted the change).
- Preview: create a one-shot `<audio src={previewUrl}>` element (object URL from the File object before upload, or `convertFileSrc(path)` after).
- Platform note (non-macOS): small faint line "On Windows/Linux, sound plays via the companion widget."

### `src/components/Companion.tsx`

On mount, register a Tauri event listener for `play-notification-sound`:

```ts
import { listen } from '@tauri-apps/api/event'
import { convertFileSrc } from '@tauri-apps/api/core'

useEffect(() => {
  if (!isTauri) return
  const unlisten = listen<string>('play-notification-sound', ({ payload: path }) => {
    const audio = new Audio(convertFileSrc(path))
    void audio.play()
  })
  return () => { void unlisten.then(fn => fn()) }
}, [])
```

## File Layout

```
<app-data>/
  sounds/
    nn_alert.<ext>       ← canonical copy (all platforms)

~/Library/Sounds/
  nn_alert.<ext>         ← macOS only, referenced by OS notification
```

Only one custom sound is active at a time. Installing a new one overwrites the previous.

## Error Handling

- Unsupported extension → Rust returns `Err`, frontend shows a brief error message near the button.
- File write failure → same.
- `play-notification-sound` event with no companion window open → silently dropped (Tauri emits to all windows; if none are listening, nothing happens).

## Out of Scope

- Multiple saved sounds / a sound library.
- Adjusting the volume of the notification sound (OS controls that on macOS; companion audio inherits system volume).
- Linux/Windows native notification sound support (the side-channel covers it adequately).
