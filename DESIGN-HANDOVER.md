# Nube Nube — Design Handover (simplified redesign)

> Brief for the Claude Design pass. The current build is too complex; this is the **trimmed,
> corrected vision**. Design for calm and simplicity — a companion, not a dashboard.

## The core loop (this is the whole product)

- You work with Claude → **water evaporates → your Nube grows**. 🌱
- When **Claude finishes a turn and is waiting for you**, and you wander off to non-work apps,
  the Nube's **health gently fades**.
- Come back / send the next prompt → the waiting ends, health holds.

### ⚠️ The metric that was wrong — read this

We are **NOT** tracking "how long you were distracted" as an always-on surveillance timer.
We **ARE** tracking **"how long Claude was waiting for you while you drifted away."**

- It only counts in the **post-finish waiting window**: from when Claude finishes (Stop) until you
  re-engage (next prompt) or return to a work app.
- Frame it from the **Nube's / Claude's** point of view — *"Claude's been waiting 6 min"*, *"your Nube
  missed you"* — never *"you've been slacking for 6 min."*
- Health resets gently each morning. Water (size) accumulates per project forever and is **never** lost.

Tone everywhere: **gentle, celebratory, never shaming.**

---

## Pages — there are only three

### 1. Home — "Today"
The reason to open the app. The **Nube hero** + exactly **four numbers**. No charts needed.

1. **Water evaporated today** — across all projects. Big, with a playful real-world comparison
   (*"≈ 3 glasses"*).
2. **Time Claude spent working today** — collated across **all** sessions.
3. **Time Claude spent waiting for you** — while you'd drifted away (the gentle drift number above).
4. **Nube health** — the creature's state today, shown by how the creature looks.

The creature is the emotional centerpiece; the four numbers sit around it. That's the whole screen.

### 2. Projects — tokenomics breakdown
A simple list of every project and where the water went.
- Per row: project name, **lifetime water**, today / this month, and a small **honest token breakdown**
  (cache vs output vs input) with a one-line caveat.
- Tap a project for a little more (its Nube, totals). Sorted by water. This is the "where did my
  water go?" view.

### 3. Settings — minimal
- **Connect Claude Code** — one button to install the hook + a status line. Nothing fiddly.
- **Classify apps via a DROPDOWN** — pick an app from a list of detected/known apps and tag it
  **Work / Distraction / Ignore**. (No free-text typing of app names.)
- **A couple of simple dials** — daily reset time, drift sensitivity, pause/break. Keep it tiny.

---

## Removed — do NOT design these
The old build had too many screens. Cut entirely:
- ❌ Insights page (all the charts/heatmaps)
- ❌ Nube Close-up page
- ❌ Drift Moment page → it's just a **gentle native notification**, not a screen
- ❌ Morning Reset page → a quiet automatic reset (at most a soft line on Home), not a screen
- ❌ Multi-step Onboarding → fold "connect" into Settings or a one-time inline step

## The assets to design
1. **The Nube creature** — the hero. States from **thriving → happy → okay → sleepy → fading**; grows
   with accumulated water; gentle motion. This is THE thing to get right.
2. **Theme tokens** — one file of colors / type / spacing / motion (light + dark) drives the whole app.

## Layout feeling
Spacious, soft, low-information-density. One glanceable Home, one calm list, one tiny Settings.
If a screen feels like a "dashboard," it's too much.
