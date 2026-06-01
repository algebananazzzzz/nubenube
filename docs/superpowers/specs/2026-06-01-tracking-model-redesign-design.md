# Tracking model redesign — "Responsiveness to Claude"

**Date:** 2026-06-01
**Status:** Approved design (pending spec review)
**Supersedes:** the two-meter (health + token-water) drift model in `drift.rs` / `settings.rs` / `water.rs` / `derive.ts`.

## 1. Why

The current model conflates three meanings (live focus, daily life, lifetime
size-from-tokens) and its math has accumulated contradictions:

- The death/severity escalation (`draining → critical → fading`) is timed from
  *when Claude finished*, not from actual life — so the overlay can read "fading,
  almost gone" at 100% health.
- Recovery is token-driven and spiky: a single turn's `cache_create` (often
  50k–200k tokens) can refill 20–80% of life in one tick, making drift weightless.
- The "Nube dies after X min" slider is anchored to base life (0.70) while the
  countdown and real death use current health (up to 1.0) — they disagree.
- `resetTimeLocal` is a live setting in the UI but is **ignored**; reset happens
  at calendar midnight.
- Linear per-session decay stacking, with no offsetting reward for running many
  Claude windows.

This redesign collapses everything to **one time-based meter** whose single
meaning is **responsiveness to Claude**: when Claude finishes and waits on you,
are you there to continue, or did you drift to a distraction?

## 2. Core concept

One value per project, `life`, on a bar from `0` to `cap`, where
`cap = baseline + bonus`.

```
 cap  ┌─────┐ 100  ← fully banked → "thriving"
      │▓▓▓▓▓│      ↑ BONUS (default 30): focus credit, earned by
 base ├─────┤  70  │   working, spent on distraction
      │░░░░░│      ↓ BELOW BASELINE = deficit → escalating distress
   0  └─────┘   0  ← "faint"
```

- **baseline** (default 70) — the daily reset level ("par").
- **bonus** (default 30) — headroom above baseline you can bank by working; the
  top of the bar.
- Above baseline = spending earned credit (Nube is fine). Below baseline = real
  deficit (Nube suffers, escalating as it falls).

The token→water→**size** meter is **removed**. The creature's size becomes fixed
/ cosmetic. Token analytics on the Insights page are a separate concern and are
out of scope (they may stay as-is).

## 3. The two forces

Evaluated every watcher tick (~2s) over the real elapsed `dt` seconds:

```
life += ( HEAL·running − DRAIN·waiting ) · (dt / 60)      // then clamp to [0, cap]
```

- `running`  = number of Claude sessions currently **Running** (Claude working).
- `waiting`  = number of Claude sessions **Waiting** past **grace** (finished,
  blocked on you).
- **DRAIN** applies **only when the foreground app is a distraction** (exact,
  case-insensitive match against the user's list). Otherwise the DRAIN term is 0.
  - `DRAIN = R · waiting`
- **HEAL** applies whenever `running > 0`, **regardless of foreground** (it's
  "Claude is working for you"). **More windows heal faster.**
  - `HEAL = ratio · R · running`   (`ratio` default 0.1)
- **Freeze:** when **idle** (`idle_secs > idle_threshold`) or **paused**, no
  change at all, and every Waiting session's clock is frozen (a break never ages
  the wait).
- The HEAL and DRAIN terms **net** in the same tick (approved decision). On a
  distraction app with running windows, the windows soften — or fully offset —
  the bleed.

### Base rate `R` from "time-to-death"

`R` is derived from the configurable **time-to-death** `T` (approved anchor =
**baseline → 0**):

```
R = baseline / T          // %-points per minute, per waiting session
```

Default `T = 12 min`, `baseline = 70` → `R ≈ 5.83 %/min`. At `ratio = 0.1`, one
running window heals `≈ 0.58 %/min`, so **10 min of one running window = 1 min of
one ignored waiting session** — the user's intended rule. Banked bonus buys extra
survival time on top of `T`.

## 4. Severity tracks `life` (not the clock)

Mood/text is a pure function of where `life` sits between `0`, `baseline`, `cap`.
This removes the "100% but says almost gone" contradiction. With deficit
`d = (baseline − life) / baseline`:

| condition | mood |
|---|---|
| `life ≥ 0.95·cap` | thriving |
| `baseline ≤ life < 0.95·cap` | content (banked bonus) |
| below baseline, `d < 0.30` | worried |
| `0.30 ≤ d < 0.60` | gasping |
| `0.60 ≤ d < 0.95` | fading |
| `life ≈ 0` (`d ≥ 0.95`) | faint |

"napping" is **not** a life level — it's the calm activity state shown when
nothing is active (no running/waiting sessions, neutral foreground), orthogonal
to the life-based mood above. Separately, an instantaneous **drifting** flag
drives the urgent overlay (see §5).

## 5. Overlay states (Companion)

Driven by foreground class, waiting/running counts, and the net rate:

- **Not on a distraction:** mood text per §4 (thriving / napping / …). No countdown.
- **On a distraction, nothing waiting (`waiting = 0`):** amber, `on {app}` — detected,
  not draining (HEAL may even be lifting life).
- **On a distraction, waiting > 0, net ≥ 0** (running windows offset the bleed):
  amber, `on {app} — holding`. No countdown; life is not falling.
- **On a distraction, waiting > 0, net < 0** (truly losing life): **red**,
  `drifting on {app}`, with the **countdown**.

### Countdown = honest net rate

```
net_drain = DRAIN − HEAL            // %-points per minute, only meaningful when > 0
time_to_0 = life / net_drain  (minutes)  →  ×60 seconds
```

Shown only while `net_drain > 0` on a distraction app. If running windows
out-heal the waiting session, there is **no countdown** — because life is not
dropping.

## 6. Daily reset

At the configured local time (`resetTimeLocal`, default `05:00`, **now honored**),
`life` is set to `baseline`. This clears both banked bonus and any deficit — a
clean daily slate. (Reset fires on the first tick at/after the configured time on
a new local day.)

## 7. Configuration (Settings sliders)

All live, replacing today's two sliders:

| setting | default | meaning |
|---|---|---|
| `baseline` | 70 | daily reset level; bottom-of-bonus line |
| `bonus` | 30 | headroom above baseline; `cap = baseline + bonus` |
| `timeToDeathMin` (`T`) | 12 | minutes of one-session distraction, baseline → 0 |
| `healDrainRatio` | 0.1 | heal-per-running ÷ drain-per-waiting |
| `graceSecs` | 10 | delay after Claude finishes before drift can start |
| `idleThresholdSecs` | 120 | away-time that freezes the meter |
| `resetTimeLocal` | 05:00 | daily reset time |

The life bar visually rescales to `baseline + bonus`, with a baseline marker.

## 8. Data flow & components (what changes)

- **`settings.rs`** — replace `Sensitivity` fields: drop `decay_per_min` and
  `recovery_per_token`; add `baseline`, `bonus`, `time_to_death_min`,
  `heal_drain_ratio`. Keep `grace_secs`, `idle_threshold_secs`. Distraction list
  default stays empty (prior fix). Add a settings version/migration so old files
  upgrade cleanly.
- **`drift.rs`** —
  - Replace `apply_focus` with the net-rate formula (§3). Keep it a pure,
    unit-tested function: `apply_life(life, dt, cap, R, ratio, running, waiting, on_distraction) -> f64`.
  - `R = baseline / T` computed per tick from settings.
  - Replace `seconds_to_death`/`countdown_secs` with an honest net-rate countdown
    (§5), pure + tested.
  - Daily reset keyed to `resetTimeLocal` (§6), not calendar midnight.
  - Drop token-driven recovery (`project_token_total` delta no longer feeds life).
  - `state`/emitted DTO: replace `cloud_health` semantics with `life` (0..cap),
    and emit `baseline`, `cap`, `on_distraction`, `net_draining` so the frontend
    needn't re-derive rates.
- **`water.rs`** — no longer feeds the creature; size becomes static. (Keep the
  module only if Insights still uses `water_ml`; otherwise remove its use from the
  creature path.)
- **`dto.rs` / `types.ts`** — `FocusTick` gains `life`, `baseline`, `cap`,
  `onDistraction`, `netDraining`; drops `cloudHealth` (or repurposes it as `life`),
  `secondsToDeath` stays (now net-based).
- **`derive.ts`** — `phaseFromTick`/`moodFromHealth` rebased on `life` vs
  `baseline`/`cap` (§4); remove the hard-coded 120/300s thresholds.
- **`Companion.tsx`** — overlay states per §5 (mostly already aligned from the
  distraction-detection work; switch the countdown/severity inputs to the new
  fields).
- **`Settings.tsx`** — swap the two sliders for the §7 set; render the bar with a
  baseline marker.

## 9. Testing

Pure functions get unit tests (Rust `cargo test`):

- `apply_life`: drain-only, heal-only, **net (heal offsets drain)**, freeze
  (idle/paused), clamp at `0` and `cap`, multi-session scaling (`waiting`,
  `running`).
- `R = baseline / T` derivation; the "10 min work = 1 min distraction" identity.
- countdown: net-draining → finite; net ≥ 0 → `None`; scales with `waiting`,
  shrinks with `running`.
- daily reset: fires at `resetTimeLocal`, sets `life = baseline`, once per day.
- severity mapping: thriving / content / worried / gasping / fading / faint
  boundaries relative to configurable `baseline`/`cap`.

Verification gate (per repo memory): `npm run build` + `cargo test` (not
`npm run lint`).

## 10. Out of scope

- Insights/analytics token visualizations (separate from the creature state).
- Per-project vs single-global Nube: keep the existing per-project `life`
  (persisted in `biome_state`), just with the new formula.
- Creature art / size animation changes beyond making size static.

## 11. Open question (carry into planning)

- **Reset wiping banked bonus:** §6 resets `life = baseline`, discarding any
  bonus you'd banked the day before. Alternative: reset only lifts you *up* to
  baseline if below, preserving banked bonus. Default chosen = hard reset to
  baseline (simplest, "fresh day"); revisit if it feels punishing.
