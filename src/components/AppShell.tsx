// AppShell — the main window: custom titlebar, sidebar nav, the live home-bloop
// life widget, and the rescue SUPERVISOR that drives the real OS takeover +
// companion windows from live focus-ticks. Also hosts the first-launch intro and
// (on sample data) a demo dock to preview the rare phases without drifting.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useFocus } from '../store/focus'
import { useUsage } from '../store/usage'
import { usePrefs } from '../store/prefs'
import { useDemo, type TakeoverLevel } from '../store/demo'
import { NubeCreature } from './NubeCreature'
import { LifeBar, Dot, INK, SUB, shadow, elev } from './ui'
import { IntroStory } from './IntroStory'
import { TakeoverView } from './Takeover'
import { hueClay } from '../lib/clay'
import { BASE_LIFE, phaseFromTick, lifeFromHealth, type Phase } from '../lib/derive'
import { rescue, onRescue } from '../lib/rescue'
import { playChime } from '../lib/sound'
import { isTauri } from '../lib/api'

const RANK: Record<TakeoverLevel, number> = { finish: 0, '2min': 1, '5min': 2 }
const REMIND_MIN = 2 // minutes to snooze a rescue after "I'm back" (was a user pref)

const NAV: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  { to: '/', label: 'Home', end: true, icon: <path d="M4 11 12 4l8 7v8a1.4 1.4 0 0 1-1.4 1.4H5.4A1.4 1.4 0 0 1 4 19z" /> },
  { to: '/insights', label: 'Insights', icon: <path d="M4 17 9 11l3.5 3.5L20 6" /> },
  { to: '/settings', label: 'Settings', icon: <g><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" /></g> },
]

const DEMO_PHASES: Phase[] = ['working', 'idle', 'waiting', 'draining', 'critical', 'fading', 'faint']

function NavItem({ to, label, icon, end, hue }: { to: string; label: string; icon: ReactNode; end?: boolean; hue: number }) {
  const c = hueClay(hue)
  return (
    <NavLink to={to} end={end} style={{ textDecoration: 'none' }}>
      {({ isActive }) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', borderRadius: 11, padding: '9px 12px', background: isActive ? '#fff' : 'transparent', boxShadow: isActive ? shadow.sm : 'none', border: isActive ? elev.border : '1px solid transparent', transition: 'background .15s ease' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isActive ? c.deep : 'rgba(96,86,134,.7)'} strokeWidth={isActive ? 2.3 : 2} strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
          <span style={{ fontWeight: isActive ? 800 : 600, fontSize: 13.5, color: isActive ? INK : 'rgba(80,72,118,.78)', letterSpacing: '.01em' }}>{label}</span>
        </div>
      )}
    </NavLink>
  )
}

function DockBtn({ on, onClick, children, danger }: { on: boolean; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button onClick={onClick} style={{ border: 'none', cursor: 'pointer', borderRadius: 8, padding: '6px 10px', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 11.5, background: on ? (danger ? 'linear-gradient(165deg,#f3a86a,#e87a52)' : 'rgba(255,255,255,.94)') : 'rgba(255,255,255,.1)', color: on ? (danger ? '#fff' : '#36324f') : 'rgba(255,255,255,.72)', transition: 'all .15s ease', whiteSpace: 'nowrap' }}>{children}</button>
  )
}

export function AppShell() {
  const tick = useFocus((s) => s.tick)
  const subscribe = useFocus((s) => s.subscribe)
  const projects = useUsage((s) => s.projects)
  const loadAll = useUsage((s) => s.loadAll)
  const live = useUsage((s) => s.live)
  const connection = useUsage((s) => s.connection)
  const prefs = usePrefs()
  const demo = useDemo()

  const [introOpen, setIntroOpen] = useState(!prefs.introDone)
  const shownLevel = useRef<TakeoverLevel | null>(null)
  const snoozedLevel = useRef<TakeoverLevel | null>(null)
  const snoozeUntil = useRef(0)

  useEffect(() => { void subscribe(); void loadAll() }, [subscribe, loadAll])

  // companion window follows the pref
  useEffect(() => { if (isTauri) void rescue.setCompanion(prefs.companion) }, [prefs.companion])

  // intro replay (demo)
  useEffect(() => { if (demo.introNonce > 0) setIntroOpen(true) }, [demo.introNonce])

  // listen for what the user did in the takeover window.
  // 'back' = a short grace to switch apps (else the supervisor would re-pop the
  // takeover next tick since we're still on the distraction app). 'snooze' = the
  // user's reminder cadence. Reads live prefs via getState() to stay fresh.
  useEffect(() => {
    let un: (() => void) | undefined
    let dead = false
    onRescue((a) => {
      const p = usePrefs.getState()
      snoozeUntil.current = Date.now() + (a === 'snooze' ? REMIND_MIN * 60_000 : 12_000)
      snoozedLevel.current = shownLevel.current
      shownLevel.current = null
      if (p.sound) playChime('relief')
    }).then((f) => { if (dead) f(); else un = f })
    return () => { dead = true; un?.() }
  }, [])

  // the supervisor: decide whether the real takeover window should be up.
  // A strictly-worse level bypasses an active snooze so escalation is never muted.
  useEffect(() => {
    if (!isTauri) return
    const phase = phaseFromTick(tick)
    let target: TakeoverLevel | null = null
    if (phase === 'waiting' || phase === 'draining') target = prefs.takeoverFinish ? 'finish' : null
    else if (phase === 'critical') target = prefs.takeover2 ? '2min' : prefs.takeoverFinish ? 'finish' : null
    else if (phase === 'fading') target = prefs.takeover5 ? '5min' : prefs.takeover2 ? '2min' : prefs.takeoverFinish ? 'finish' : null

    const now = Date.now()
    const escalated = target != null && snoozedLevel.current != null && RANK[target] > RANK[snoozedLevel.current]
    const snoozed = now < snoozeUntil.current && !escalated

    if (target && !snoozed) {
      if (shownLevel.current !== target) {
        shownLevel.current = target
        snoozeUntil.current = 0
        snoozedLevel.current = null
        void rescue.showTakeover()
        if (prefs.sound) playChime('danger')
      }
    } else if (!target && shownLevel.current !== null) {
      shownLevel.current = null
      void rescue.hideTakeover()
      if (prefs.sound) playChime('relief')
    }
  }, [tick, prefs.takeoverFinish, prefs.takeover2, prefs.takeover5, prefs.sound])

  const phase = demo.phase ?? phaseFromTick(tick)
  const project = projects.find((p) => p.id === tick.activeProjectId) ?? [...projects].sort((a, b) => b.waterMl - a.waterMl)[0]
  const hue = project?.colorHue ?? 268
  const c = hueClay(hue)
  const DEMO_LIFE: Record<Phase, number> = { working: 90, idle: 70, waiting: 86, draining: 62, critical: 36, fading: 13, faint: 0 }
  const life = demo.phase ? DEMO_LIFE[phase] : lifeFromHealth(tick.cloudHealth)
  const urgent = phase === 'draining' || phase === 'critical' || phase === 'fading'

  const finishIntro = () => { prefs.set('introDone', true); setIntroOpen(false) }
  const showDock = !live && !introOpen

  return (
    <div className="nn-ui" style={{ position: 'fixed', inset: 0, background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* custom titlebar (native traffic lights overlay on the left on macOS) */}
      <div data-tauri-drag-region style={{ height: 42, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 15px 0 78px', background: 'rgba(255,255,255,.66)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(70,52,130,.08)' }}>
        <div style={{ width: 130 }} />
        <div className="nn-disp" style={{ fontWeight: 800, fontSize: 13.5, color: '#615a82', letterSpacing: '.02em', pointerEvents: 'none' }}>NubeNube</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: 130 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 11, color: connection?.connected ? SUB : '#b3adc8' }}>
            <Dot color={connection?.connected ? '#54c489' : '#cfc8e0'} size={7} /> Claude Code
          </span>
        </div>
      </div>

      {/* body */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* sidebar */}
        <div style={{ width: 196, flexShrink: 0, display: 'flex', flexDirection: 'column', padding: 13, gap: 4, background: 'linear-gradient(180deg, rgba(255,255,255,.5), rgba(255,255,255,.16))', borderRight: '1px solid rgba(70,52,130,.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 8px 14px' }}>
            <div style={{ width: 30, height: 30, marginTop: -2 }}><NubeCreature mood="content" hue={hue} size={30} scale={1.12} idle={false} /></div>
            <span className="nn-disp" style={{ fontWeight: 800, fontSize: 16.5, color: INK, letterSpacing: '.01em' }}>NubeNube</span>
          </div>
          {NAV.map((n) => <NavItem key={n.to} {...n} hue={hue} />)}
          <div style={{ flex: 1 }} />
          <div style={{ borderRadius: 14, padding: 13, background: `linear-gradient(165deg, ${c.soft}, #fff)`, border: elev.border, boxShadow: shadow.sm }}>
            <div style={{ fontWeight: 700, fontSize: 9.5, color: SUB, textTransform: 'uppercase', letterSpacing: '.06em' }}>home bloop</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
              <span style={{ width: 12, height: 12, borderRadius: 99, background: `radial-gradient(circle at 35% 30%, ${c.light}, ${c.deep})` }} />
              <span style={{ fontWeight: 700, fontSize: 12.5, color: c.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{project?.name ?? 'no project yet'}</span>
            </div>
            <div style={{ marginTop: 9 }}><LifeBar life={life} base={BASE_LIFE} hue={hue} height={9} draining={urgent} /></div>
          </div>
        </div>

        {/* content */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <Outlet />
          {introOpen && <IntroStory onDone={finishIntro} />}
        </div>
      </div>

      {/* in-app takeover overlay (browser/demo preview only — real Tauri uses the OS window) */}
      {!isTauri && demo.takeover && (
        <TakeoverView level={demo.takeover} secs={demo.takeover === 'finish' ? 6 : demo.takeover === '2min' ? 132 : 322} life={demo.takeover === 'finish' ? 86 : demo.takeover === '2min' ? 36 : 13} hue={hue} onBack={() => { demo.setTakeover(null); if (prefs.sound) playChime('relief') }} onSnooze={() => { demo.setTakeover(null); if (prefs.sound) playChime('relief') }} />
      )}

      {/* demo dock (sample-data mode) */}
      {showDock && (
        <div style={{ position: 'fixed', bottom: 15, left: '50%', transform: 'translateX(-50%)', zIndex: 400, display: 'flex', alignItems: 'center', gap: 11, background: 'rgba(44,37,68,.84)', backdropFilter: 'blur(16px)', borderRadius: 14, padding: '8px 13px', boxShadow: '0 20px 44px -18px rgba(36,28,66,.7)', border: '1px solid rgba(255,255,255,.08)' }}>
          <span style={{ fontWeight: 700, fontSize: 9.5, color: 'rgba(255,255,255,.5)', letterSpacing: '.08em', textTransform: 'uppercase' }}>demo</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {DEMO_PHASES.map((p) => <DockBtn key={p} on={demo.phase === p} onClick={() => demo.setPhase(demo.phase === p ? null : p)}>{p}</DockBtn>)}
          </div>
          <span style={{ width: 1, height: 19, background: 'rgba(255,255,255,.18)' }} />
          <span style={{ fontWeight: 700, fontSize: 9.5, color: 'rgba(255,255,255,.5)' }}>rescue</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['finish', '2min', '5min'] as TakeoverLevel[]).map((l) => <DockBtn key={l} on danger onClick={() => { demo.setTakeover(l); if (prefs.sound) playChime('danger') }}>{l}</DockBtn>)}
          </div>
          <span style={{ width: 1, height: 19, background: 'rgba(255,255,255,.18)' }} />
          <DockBtn on={false} onClick={() => demo.replayIntro()}>↻ intro</DockBtn>
        </div>
      )}
    </div>
  )
}
