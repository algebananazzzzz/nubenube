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
`baseline = 100` (full / "par") and the **bonus is hardcoded at 30% of baseline**,
so `cap = baseline · 1.3 = 130`.

```
 cap  ┌─────┐ 130  ← over-charged (banked burst) → "thriving"
      │▒▒▒▒▒│      ↑ BONUS = 30% of baseline (HARDCODED): focus
 base ├─────┤ 100  │   credit earned by working, spent on distraction
      │█████│      ↓ BELOW 100% = deficit → escalating distress
   0  └─────┘   0  ← "faint"
```

- **baseline = 100** — full/normal life; the daily reset level. Not a slider.
- **bonus = 0.3 · baseline = 30** (hardcoded) — over-charge headroom above 100%
  you bank by working; `cap = 130`.
- At/above 100% = healthy, optionally spending banked burst. Below 100% = real
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

Default `T = 12 min`, `baseline = 100` → `R ≈ 8.33 %/min`. At `ratio = 0.1`, one
running window heals `≈ 0.83 %/min`, so **10 min of one running window = 1 min of
one ignored waiting session** — the user's intended rule. The banked bonus (up to
+30) buys extra survival time on top of `T`.

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
| `timeToDeathMin` (`T`) | 12 | minutes of one-session distraction, baseline → 0 |
| `healDrainRatio` | 0.1 | heal-per-running ÷ drain-per-waiting |
| `graceSecs` | 10 | delay after Claude finishes before drift can start |
| `idleThresholdSecs` | 120 | away-time that freezes the meter |
| `resetTimeLocal` | 05:00 | daily reset time |

**Hardcoded (not sliders):** `baseline = 100`, `bonus = 0.3 · baseline = 30`
(→ `cap = 130`). The life bar is fixed 0–130 with the 100% baseline marker; the
banked-burst region (100–130) renders as an over-charge above the line.

## 8. Data flow & components (what changes)

- **`settings.rs`** — replace `Sensitivity` fields: drop `decay_per_min` and
  `recovery_per_token`; add `time_to_death_min` and `heal_drain_ratio`. Keep
  `grace_secs`, `idle_threshold_secs`. `baseline` (100) and the bonus ratio (0.3)
  are module constants, not settings. Distraction list default stays empty (prior
  fix). Add a settings version/migration so old files upgrade cleanly.
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
  bonus you'd banked the day before. **Decided:** hard reset to `baseline = 100`
  each day ("fresh day"). Banked burst does not carry over.

## 12. Session lifecycle — close removes from counts

Closing a Claude session (Ctrl+D, or Ctrl+C that exits) must **immediately** drop
it from the running/waiting counts so the overlay never shows a phantom
"waiting"/"working" for a session you've left.

**Confirmed hook behavior (Claude Code docs):**
- **Ctrl+D** → `SessionEnd` (`reason: prompt_input_exit`) → `handle_end` removes it.
- **Ctrl+C that exits** → `SessionEnd` (`reason: other`) → removed.
- **Ctrl+C/Esc interrupt mid-turn** → `Stop` fires (session stays alive) →
  `Running → Waiting`. `SessionEnd` does NOT fire (correct — session continues).
- **Force-kill (SIGKILL) / abrupt terminal close** → `SessionEnd` is NOT
  guaranteed → needs an app-side fallback.

**Implemented:** the existing `events_tail → handle_end` path satisfies the user's
ask (Ctrl+D / Ctrl+C remove the session immediately). For the force-kill gap, the
staleness fallback `ABANDON_SECS` is lowered **1800s → 600s** (its clock is frozen
while idle/away, so it's active-waiting time): a killed terminal stops being a
phantom "waiting"/"working" within ~10 min instead of 30. User-visible contract:
**close it → it leaves the counts within a tick or two.**

## 13. Implementation contract (fixed names — parallel agents implement to this)

**Constants (`drift.rs`):** `BASELINE: f64 = 100.0`, `BONUS_RATIO: f64 = 0.3`,
`CAP: f64 = BASELINE * (1.0 + BONUS_RATIO)` = 130.0.

**Settings (`settings.rs`, camelCase JSON):** in the sensitivity block, **remove**
`decayPerMin`, `recoveryPerToken`; **add** `timeToDeathMin: f64 = 12.0`,
`healDrainRatio: f64 = 0.1`; **keep** `graceSecs (=10)`, `idleThresholdSecs (=120)`,
`windowGranularity`. Top-level `Settings` unchanged except behavior of
`resetTimeLocal` is now honored. `waterRates`/`water.rs` stay (Insights analytics).

**FocusTick DTO (`dto.rs` ⇄ `types.ts`, camelCase):** keep all current fields;
**repurpose `cloudHealth` to mean `life` on the 0..130 scale** (do NOT rename — keep
`cloudHealth`/`cloud_health` to limit churn); **add** `baseline: f64` (100) and
`cap: f64` (130). `secondsToDeath` stays but is now the honest **net-rate**
countdown (Some only while net-draining). `state` ∈
`{"drifting","waiting","working","idle","paused"}` (rename old `"growing"`→`"working"`).

**Pure, unit-tested fns (`drift.rs`):**
- `life_rate(on_distraction, waiting, running, baseline, time_to_death_min, ratio) -> f64`
  returns net %-points/min = `ratio·R·running − (on_distraction ? R·waiting : 0)`,
  where `R = baseline / time_to_death_min`.
- `apply_life(life, dt, rate, frozen) -> f64` = `frozen ? life : clamp(life + rate·dt/60, 0, CAP)`.
- `countdown_secs(life, rate) -> Option<i64>` = `rate < 0 ? Some((life / -rate)·60) : None`.

**Persistence/migration (`db.rs`):** `load_health` default and `reset_all_health`
baseline become `BASELINE` (100). Old `cloud_health` values are on the 0..1 scale;
on upgrade, reset all `biome_state.cloud_health` to `BASELINE` once (bump a stored
schema/settings version, or detect value ≤ `CAP/100` and reset). Daily reset sets
`cloud_health = BASELINE`.

**Frontend (`derive.ts`):** rebase `BASE_LIFE`→100, `lifeFromHealth(h)=round(clamp(h,0,cap))`,
mood thresholds per §4 relative to `baseline`/`cap`; drop the 120/300s escalation.
`Companion.tsx` overlay states per §5 (already mostly aligned). `Settings.tsx`
swaps the two sliders for the §7 set and renders the 0–130 bar with a 100 marker.

**Disjoint file sets** → backend (`*.rs`) and frontend (`src/**`) can be built in
parallel against this contract; integration verified by `cargo test` + `npm run build`.
