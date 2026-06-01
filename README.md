# NubeNube ☁️

A candy-pastel **desktop focus companion** (Tauri + React + TypeScript) built around the Claude Design
prototype. Your attention is the sun: productive Claude Code usage "evaporates water" (tokens) that grows
a per-project clay cloud-bloop — a **Nube**. The moment Claude finishes a turn and waits for you, if you
drift off to YouTube the Nube starts to weep its water away — draining → gasping → drying to a tadpole →
fainting. A **Tamagotchi life model** (life rests at a 70% base each morning and you *earn up to +30%* by
working) drives the whole UI. Local-first, no accounts, no servers.

> Status: **redesigned around the prototype + wired to real `~/.claude` data.** The candy aesthetic lives
> in `src/theme/tokens.css` + `src/lib/clay.ts`; the live behaviour comes from the real Rust backend via
> `src/lib/derive.ts` (FocusTick → phase/mood/life, tokens → water/donut). Two real OS windows — an
> always-on-top **companion pet** and a system-wide full-screen **rescue takeover** — surface when drift
> escalates.

## Screens

- **Home** — the live Nube in its biome (sky/clouds/sun/rain), the 70/30 LifeBar, status strip + away-from-Claude timer.
- **Projects** — a garden of bloops sized by lifetime water; click one for its **detail**: token-composition donut (cache read / input / output / cache write), focus vs. drift, last-7-days.
- **Insights** — total water evaporated (escalating units), the global token composition across all projects, focus/drift, water-by-project.
- **Settings** — distraction-app toggles, numeric tuning (*"Nube dies after N min"* → decay rate, grace, reminder), aggression presets, full-screen-rescue toggles, sound, daily reset, pause, and Claude Code connection (install hook / rescan).
- **First-launch storybook intro**, the **companion pet**, and the **rescue takeover** (finish / 2 min / 5 min).

On sample data (a plain browser via `npm run dev`) a small **demo dock** lets you step through every phase and preview the rescue without drifting.

## Run it

```bash
npm install
npm run tauri dev      # desktop app (Vite dev server + Rust)
# or, frontend only in a browser (uses mock data):
npm run dev
```

Build: `npm run tauri build`. Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml`.

## Install

Download the latest release from the [GitHub Releases page](https://github.com/OWNER/nubenube/releases).

| Platform | File |
|---|---|
| Linux (Ubuntu/Debian) | `.deb` |
| Linux (universal) | `.AppImage` — run `chmod +x` then execute |
| macOS | `.dmg` |
| Windows | `.msi` or `.exe` (NSIS installer) |

**macOS note:** The `.dmg` is unsigned. On first open, right-click the app → **Open** to bypass Gatekeeper. You only need to do this once — subsequent auto-updates are silent.

## Releases

- **Beta** (`vX.Y.Z-beta`): published automatically on every merge to `main`. Install to test before stable.
- **Stable** (`vX.Y.Z`): promoted manually via GitHub Actions → `4 - Production Release`. Existing installs auto-update silently.

## The water model (real, research-grounded)

Water is a **real volume** derived from token counts. Reading is ~10× cheaper than writing:

| Class | tokens | mL / token |
|---|---|---|
| **read** | input, cache_read, cache_creation | **0.0002** |
| **write** | output | **0.0015** |

`water_mL = 0.0002·(input + cache_read + cache_create) + 0.0015·output`. Tunable in Settings; the single
source of truth is `src/theme/units.ts` (mirrored in `src-tauri/src/water.rs`). Shown in liters with
comically escalating units (mL → glass → bathtub → pool → lake). These rates are order-of-magnitude
estimates **derived from** — not stated verbatim by — the AI water-footprint literature:

- Li, Yang, Islam & Ren, *Making AI Less "Thirsty"* — **arXiv:2304.03271** (CACM 2025).
- Jegham, Abdelatti, Koh, Elmoubarki & Hendawi, *How Hungry is AI?* — **arXiv:2505.09598** (2025).

The UI labels water honestly and surfaces the real 4-field token breakdown with a caveat: Claude's logs
under-report `input`, and cached context (`cache_read`) dominates the total.

## The usage connector (verified against real `~/.claude`)

Rust, runs in a background thread. Discovers log roots (`CLAUDE_CONFIG_DIR` → `$XDG_CONFIG_HOME/claude`
→ `~/.claude`), recursively reads `projects/**/*.jsonl` (incl. nested `subagents/*.jsonl`), and:

1. keeps only `type=="assistant"` records with usage (skips `<synthetic>`),
2. **dedups by `(message.id, requestId)`** — naive sums overcount 1.7–3.9×,
3. attributes to a stable project id (the dir segment after `projects/`); displays the modal `cwd`,
4. sums all four token fields (cache dominates ~97%), bucketed by **local** day / month / hour,
5. persists to SQLite (`rusqlite`, WAL) idempotently (`INSERT OR IGNORE`), tailing files incrementally.

Verified on the real machine: **35,371 deduped messages, 26 projects, dedup ratio 2.17, ~689 L lifetime.**

## Drift tracking (active-window + idle — never network)

- A non-destructive installer adds `Stop` + `UserPromptSubmit` hooks to `~/.claude/settings.json`
  (preserving existing hooks / statusline, with a backup) that append events to
  `~/.claude/hooks/nube/events.jsonl`; the app tails that file.
- A ~2 s watcher reads the frontmost app (`active-win-pos-rs`, zero-permission on macOS) + idle time
  (`user-idle`, zero-permission) and runs a state machine: `growing → grace → drifting → idle`.
- Two forces: **water grows the Nube's size** (persistent per project); **focus-vs-drift drives health**
  (resets daily). Idle *freezes* health (away ≠ drifting). Sustained post-finish drift → a gentle native
  notification (configurable).

## Architecture

```
src/                      React/TS — candy-pastel UI on real data
  theme/tokens.css        light candy palette + all keyframes
  theme/units.ts          water rates + escalating units + citations
  lib/clay.ts             per-hue clay palette (hueClay)
  lib/derive.ts           the bridge: FocusTick→phase/mood/life, tokens→donut, water→size
  lib/api.ts rescue.ts    invoke + mock fallback; OS-window control wrappers
  components/             ui.tsx, NubeCreature.tsx, Biome.tsx, AppShell.tsx,
                          IntroStory.tsx, Companion.tsx, Takeover.tsx
  store/                  zustand: usage / focus / settings / prefs / demo
  pages/                  Home, Projects, ProjectDetail, Insights, Settings
src-tauri/src/            Rust native layer
  connector.rs db.rs store_paths.rs model.rs water.rs   # M1 usage connector
  watcher.rs drift.rs settings.rs notify.rs             # M2 drift
  hooks_installer.rs events_tail.rs                     # M3 hook bridge
  commands.rs lib.rs                                    # commands + tray + companion/takeover windows
```

Every screen falls back to mock data when not connected, so the UI is always navigable in a plain browser.

## Not yet (by design / next)

- Creature customization (hats/colours) and sound assets (the toggle exists; chimes are stubbed).
- macOS window-title / browser-URL drift granularity (opt-in behind Screen Recording / Automation).
- Linux Wayland active-window is best-effort (app-level fallback); transparent companion needs a
  compositor. Multi-monitor takeover currently targets the primary/active monitor.
- Mobile companion + site blocking (phase 2).

## Contributing — first-time release setup

Before the release workflows can sign and publish builds, you need a signing keypair:

1. Generate the ed25519 keypair: `cargo tauri signer generate -w ~/.tauri/nubenube.key`
2. Copy the public key printed to stdout into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
3. Update the `endpoints` URL in `src-tauri/tauri.conf.json` → `plugins.updater.endpoints[0]` with the real GitHub `OWNER/repo` path
4. Add two GitHub repo secrets (Settings → Secrets and variables → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.tauri/nubenube.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the passphrase you chose
