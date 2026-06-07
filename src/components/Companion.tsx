// Always-on-top companion window (transparent). Renders a full card or a mini
// pill, both content-sized; a ResizeObserver reports the measured size to Rust
// (nube_resize_companion) so the OS window tracks the content exactly.

import { useEffect, useRef, type ReactNode, type Ref } from 'react'
import { listen } from '@tauri-apps/api/event'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useFocus } from '../store/focus'
import { usePrefs } from '../store/prefs'
import { armChimeUnlock, playChime } from '../lib/chime'
import { isTauri } from '../lib/api'
import { rescue } from '../lib/rescue'
import { useNube, statusFor, type NubeState } from '../lib/derive'
import { themeVars } from '../lib/clay'
import { Sky, Nube } from './NubeCreature'
import { Dot, Btn, LifeBar } from './ui'

const CARD_W = 208 // logical px — the card's fixed width; height flows from content
const PAD = 12 // transparent breathing room around the card for its soft shadow

function Grip() {
  return (
    <svg width="16" height="8" viewBox="0 0 16 8" fill="currentColor" style={{ opacity: .4 }}>
      <circle cx="3" cy="2" r="1" /><circle cx="8" cy="2" r="1" /><circle cx="13" cy="2" r="1" />
      <circle cx="3" cy="6" r="1" /><circle cx="8" cy="6" r="1" /><circle cx="13" cy="6" r="1" />
    </svg>
  )
}

function MiniStat({ tone, value, label }: { tone: string; value: ReactNode; label: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px', borderRadius: 'var(--r-sm)', background: 'var(--surface-faint)', border: '1px solid var(--line-faint)' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: tone, flexShrink: 0 }} />
      <span className="nn-num" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{value}</span>
      <span style={{ fontSize: 11, color: 'var(--faint)', fontWeight: 500 }}>{label}</span>
    </div>
  )
}

// drift countdown — net-rate seconds-to-faint with progress bar
function CompactCountdown({ s }: { s: NubeState }) {
  if (s.remaining == null) return null
  const crit = s.life < 30
  const tone = crit ? 'var(--critical)' : 'var(--warning)'
  const surf = crit ? 'var(--critical-surface)' : 'var(--warning-surface)'
  const bd = crit ? 'var(--critical-border)' : 'var(--warning-border)'
  return (
    <div style={{ background: surf, border: `1px solid ${bd}`, borderRadius: 'var(--r-md)', padding: '8px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: tone }}>
          <Dot tone={tone} size={5} pulse /> {s.fainting ? 'fainted' : 'faints in'}
        </span>
        <span className="nn-num" style={{ fontSize: 15, fontWeight: 700, color: tone, lineHeight: 1 }}>{s.fmtCountdown(s.remaining)}</span>
      </div>
      <div style={{ marginTop: 6, height: 4, borderRadius: 999, background: 'var(--surface-strong)', overflow: 'hidden' }}>
        <div style={{ width: `${s.countdownPct * 100}%`, height: '100%', background: tone, borderRadius: 999, transition: 'width 1s linear' }} />
      </div>
    </div>
  )
}

function CompanionCard({ s, onMinimize, innerRef }: { s: NubeState; onMinimize: () => void; innerRef: Ref<HTMLDivElement> }) {
  const st = statusFor(s.effState, s.appName)
  const lifeTone = s.life >= 100 ? 'var(--success)' : s.life < 30 ? 'var(--critical)' : 'var(--warning)'
  return (
    <div ref={innerRef} className="nn-ui" style={{
      width: CARD_W, borderRadius: 'var(--r-lg)', overflow: 'hidden',
      background: 'var(--surface)',
      border: '1px solid var(--line)', userSelect: 'none',
      animation: 'nn-from-tr .18s var(--ease-soft)', transformOrigin: 'top right',
    }}>
      {/* draggable creature header */}
      <div data-tauri-drag-region style={{ position: 'relative', cursor: 'grab', height: 92, borderBottom: '1px solid var(--line-faint)' }}>
        <Sky sky={s.sky} style={{ position: 'absolute', inset: 0 }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <Nube mood={s.mood} size={74} glow={s.glow} />
          </div>
        </Sky>
        <div style={{ position: 'absolute', top: 7, left: 0, right: 0, display: 'flex', justifyContent: 'center', color: 'var(--faint)', pointerEvents: 'none' }}><Grip /></div>
      </div>
      {/* body — content-sized, no fillers */}
      <div style={{ padding: '12px 13px 13px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Dot tone={st.tone} pulse={st.pulse} size={8} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.label}</span>
          <span className="nn-num" style={{ flexShrink: 0, fontSize: 14, fontWeight: 700, color: lifeTone }}>{Math.round(s.life)}%</span>
        </div>

        {/* urgency when drifting, otherwise the at-a-glance life bar */}
        <div style={{ marginTop: 11 }}>
          {s.effState === 'drifting'
            ? <CompactCountdown s={s} />
            : <LifeBar life={s.life} baseline={s.baseline} cap={s.cap} height={8} labels={false} />}
        </div>

        <div style={{ display: 'flex', gap: 7, marginTop: 12 }}>
          <MiniStat tone="var(--success)" value={s.run} label="running" />
          <MiniStat tone="var(--warning)" value={s.wait} label="waiting" />
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
          <Btn variant="soft" size="sm" full onClick={() => void rescue.openMain()}>Open Nube</Btn>
          <button onClick={onMinimize} title="Minimize" style={{ flexShrink: 0, width: 32, borderRadius: 'var(--r-md)', border: '1px solid var(--line)', background: 'var(--surface-faint)', color: 'var(--text)', cursor: 'pointer', fontSize: 15, fontWeight: 700 }}>–</button>
        </div>
      </div>
    </div>
  )
}

function CompanionMini({ s, onExpand, innerRef }: { s: NubeState; onExpand: () => void; innerRef: Ref<HTMLDivElement> }) {
  const st = statusFor(s.effState, s.appName)
  const lifeTone = s.life >= 100 ? 'var(--success)' : s.life < 30 ? 'var(--critical)' : 'var(--warning)'
  const drift = s.remaining != null
  const cdTone = s.life < 30 ? 'var(--critical)' : 'var(--warning)'
  return (
    // inline-flex → the pill is exactly as wide as its content (no trailing gap)
    <div ref={innerRef} data-tauri-drag-region title={st.label} style={{
      display: 'inline-flex', alignItems: 'center', gap: 9, height: 44, padding: '0 14px 0 6px',
      borderRadius: 'var(--r-pill)', background: 'var(--surface)',
      border: '1px solid var(--line)', cursor: 'grab', userSelect: 'none', whiteSpace: 'nowrap',
      animation: 'nn-from-tr .18s var(--ease-soft)', transformOrigin: 'top right',
    }} className="nn-ui">
      <button onClick={onExpand} title="expand" style={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, border: '1px solid var(--line-faint)', background: 'var(--surface-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer' }}>
        <Nube mood={s.mood} size={32} glow={s.glow} />
      </button>
      <span style={{ display: 'inline-flex', flexShrink: 0 }}><Dot tone={st.tone} pulse={st.pulse} size={8} /></span>
      <span className="nn-num" style={{ fontSize: 14, fontWeight: 700, color: lifeTone, flexShrink: 0 }}>{Math.round(s.life)}%</span>
      <span style={{ width: 1, height: 16, background: 'var(--line)', flexShrink: 0 }} />
      {drift && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: cdTone, flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="8" r="5" /><path d="M7 5.5V8l1.6 1" strokeLinecap="round" /><path d="M5.5 1.5h3" strokeLinecap="round" /></svg>
          <span className="nn-num" style={{ fontSize: 13.5, fontWeight: 700 }}>{s.fmtCountdown(s.remaining ?? 0)}</span>
        </span>
      )}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }} title="running"><Dot tone="var(--success)" size={6} /><span className="nn-num" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{s.run}</span></span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }} title="waiting"><Dot tone="var(--warning)" size={6} /><span className="nn-num" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{s.wait}</span></span>
    </div>
  )
}

export function Companion() {
  const subscribe = useFocus((st) => st.subscribe)
  const tick = useFocus((st) => st.tick)
  const mini = usePrefs((st) => st.companionMini)
  const setPref = usePrefs((st) => st.set)
  const sound = usePrefs((st) => st.sound)
  const chimeVoice = usePrefs((st) => st.chimeVoice)
  const chimeVolume = usePrefs((st) => st.chimeVolume)
  const s = useNube()
  const cardRef = useRef<HTMLDivElement>(null)
  const prevWaiting = useRef(tick.waitingSessions)

  useEffect(() => {
    document.documentElement.classList.add('nn-transparent')
    armChimeUnlock()
    void subscribe()
    return () => document.documentElement.classList.remove('nn-transparent')
  }, [subscribe])

  // Windows/Linux: play the custom notification sound when a drift alert fires.
  // macOS handles this via the OS notification sound mechanism instead.
  useEffect(() => {
    if (!isTauri) return
    const unlisten = listen<string>('play-notification-sound', ({ payload: path }) => {
      const a = new Audio(convertFileSrc(path))
      void a.play()
    })
    return () => { void unlisten.then((fn) => fn()) }
  }, [])

  // The Companion is the single audio owner (so the chime never doubles across
  // windows): when a session newly enters the waiting phase — Claude finished a
  // turn and is now waiting on you — ring the chime. Keyed off waitingSessions
  // (which counts regardless of foreground app), so it fires even if you've
  // already wandered off.
  useEffect(() => {
    const rose = tick.waitingSessions > prevWaiting.current
    prevWaiting.current = tick.waitingSessions
    if (rose && sound) playChime(chimeVoice, chimeVolume)
  }, [tick.waitingSessions, sound, chimeVoice, chimeVolume])

  useEffect(() => { document.documentElement.setAttribute('data-theme', s.theme) }, [s.theme])

  // Drive the real OS window size from the measured card/pill (+ shadow padding).
  // Observing the content element means every layout change — mini⇄full, the
  // drift countdown appearing, a longer app name — re-fits the window. Re-bound
  // on `mini` because the observed element itself swaps (card ⇄ pill).
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    let last = ''
    let raf = 0
    const measure = () => {
      const w = Math.ceil(el.offsetWidth) + PAD * 2
      const h = Math.ceil(el.offsetHeight) + PAD * 2
      const key = `${w}x${h}`
      if (w > 1 && h > 1 && key !== last) { last = key; void rescue.resizeCompanion(w, h) }
    }
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure) })
    ro.observe(el)
    measure()
    return () => { ro.disconnect(); cancelAnimationFrame(raf) }
  }, [mini])

  return (
    // fit-content + padding → the wrapper hugs the card and leaves room for the
    // soft shadow; the window is then sized to (card + padding) by the effect.
    <div className="nn-app" data-theme={s.theme} style={{ ...themeVars(s.theme, s.clay), width: 'fit-content', padding: PAD, background: 'transparent' }}>
      {mini
        ? <CompanionMini s={s} innerRef={cardRef} onExpand={() => setPref('companionMini', false)} />
        : <CompanionCard s={s} innerRef={cardRef} onMinimize={() => setPref('companionMini', true)} />}
    </div>
  )
}
