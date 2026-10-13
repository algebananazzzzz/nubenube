// Always-on-top companion window (transparent). Renders a full card or a mini
// pill, both content-sized; a ResizeObserver reports the measured size to Rust
// (nube_resize_companion) so the OS window tracks the content exactly.

import { useEffect, useRef, type Ref } from 'react'
import { useFocus } from '../store/focus'
import { usePrefs } from '../store/prefs'
import { useSettings } from '../store/settings'
import { armChimeUnlock, playChime } from '../lib/chime'
import { events } from '../lib/api'
import { rescue } from '../lib/rescue'
import { hueSwatch, themeVars } from '../lib/clay'
import { statusLine, useFocusView, type FocusView } from '../lib/derive'
import { fmtCountdown, fmtHM } from '../lib/format'
import { Sky, Nube } from './NubeCreature'
import { Bar, Btn, Dot } from './ui'

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

// The headline number: the countdown inside a timer, the rest bank otherwise.
function headline(f: FocusView) {
  if (f.inTimer) {
    return {
      value: fmtCountdown(f.left), label: 'left',
      tone: f.state === 'timerDrift' ? 'var(--critical)' : 'var(--ink)',
      pct: 1 - f.left / Math.max(1, f.len),
      bar: f.state === 'timerDrift' ? 'var(--critical)' : hueSwatch(f.phase.hue, f.dark),
    }
  }
  return { value: fmtHM(f.bank), label: 'rest', tone: f.hpTone, pct: f.hp, bar: f.hpTone }
}

function CompanionCard({ f, onMinimize, innerRef }: { f: FocusView; onMinimize: () => void; innerRef: Ref<HTMLDivElement> }) {
  const st = statusLine(f)
  const h = headline(f)
  return (
    <div ref={innerRef} className="nn-ui" style={{
      width: CARD_W, borderRadius: 'var(--r-lg)', overflow: 'hidden', background: 'var(--surface)',
      border: '1px solid var(--line)', userSelect: 'none', animation: 'nn-from-tr .18s var(--ease-soft)', transformOrigin: 'top right',
    }}>
      <div data-tauri-drag-region="deep" style={{ position: 'relative', cursor: 'grab', height: 92, borderBottom: '1px solid var(--line-faint)' }}>
        <Sky sky={f.sky} style={{ position: 'absolute', inset: 0 }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <Nube mood={f.mood} size={74} glow={f.glow} />
          </div>
        </Sky>
        <div style={{ position: 'absolute', top: 7, left: 0, right: 0, display: 'flex', justifyContent: 'center', color: 'var(--faint)', pointerEvents: 'none' }}><Grip /></div>
      </div>
      <div style={{ padding: '12px 13px 13px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Dot tone={st.tone} pulse={st.pulse} size={8} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.inTimer ? (f.state === 'timerDrift' ? `Drifted · ${f.app}` : 'Focusing') : st.text}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 10 }}>
          <span className="nn-num" style={{ fontSize: 26, fontWeight: 700, color: h.tone, lineHeight: 1 }}>{h.value}</span>
          <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{h.label}</span>
        </div>
        <div style={{ marginTop: 8 }}><Bar pct={h.pct} color={h.bar} height={6} /></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '7px 9px', borderRadius: 'var(--r-sm)', background: 'var(--surface-faint)', border: '1px solid var(--line-faint)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: f.phase.tone, flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.phase.name}</span>
          {f.inTimer && <span className="nn-num" style={{ fontSize: 11.5, color: f.hpTone }}>{fmtHM(f.bank)}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
          <Btn variant="soft" size="sm" full onClick={() => void rescue.openMain()}>Open Nube</Btn>
          <button onClick={onMinimize} title="Minimize" style={{ flexShrink: 0, width: 32, borderRadius: 'var(--r-md)', border: '1px solid var(--line)', background: 'var(--surface-faint)', color: 'var(--text)', cursor: 'pointer', fontSize: 15, fontWeight: 700 }}>–</button>
        </div>
      </div>
    </div>
  )
}

function CompanionMini({ f, onExpand, innerRef }: { f: FocusView; onExpand: () => void; innerRef: Ref<HTMLDivElement> }) {
  const st = statusLine(f)
  const h = headline(f)
  return (
    // inline-flex → the pill is exactly as wide as its content (no trailing gap)
    <div ref={innerRef} data-tauri-drag-region="deep" title={st.text} className="nn-ui" style={{
      display: 'inline-flex', alignItems: 'center', gap: 9, height: 44, padding: '0 14px 0 6px',
      borderRadius: 'var(--r-pill)', background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'grab',
      userSelect: 'none', whiteSpace: 'nowrap', animation: 'nn-from-tr .18s var(--ease-soft)', transformOrigin: 'top right',
    }}>
      <button onClick={onExpand} title="expand" style={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, border: '1px solid var(--line-faint)', background: 'var(--surface-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer' }}>
        <Nube mood={f.mood} size={32} glow={f.glow} />
      </button>
      <span style={{ display: 'inline-flex', flexShrink: 0 }}><Dot tone={st.tone} pulse={st.pulse} size={8} /></span>
      <span className="nn-num" style={{ fontSize: 14, fontWeight: 700, color: h.tone, flexShrink: 0 }}>{h.value}</span>
      <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{h.label}</span>
      <span style={{ width: 1, height: 16, background: 'var(--line)', flexShrink: 0 }} />
      <span title={f.phase.name} style={{ width: 8, height: 8, borderRadius: '50%', background: f.phase.tone, flexShrink: 0 }} />
    </div>
  )
}

export function Companion() {
  const subscribe = useFocus((st) => st.subscribe)
  const loadSettings = useSettings((st) => st.load)
  const state = useFocus((st) => st.tick.state)
  const mini = usePrefs((st) => st.companionMini)
  const setPref = usePrefs((st) => st.set)
  const f = useFocusView()
  const cardRef = useRef<HTMLDivElement>(null)
  const prevState = useRef(state)

  useEffect(() => {
    document.documentElement.classList.add('nn-transparent')
    armChimeUnlock()
    void subscribe()
    void loadSettings()
    return () => document.documentElement.classList.remove('nn-transparent')
  }, [subscribe, loadSettings])

  // The companion is the single audio owner so chimes never double across windows.
  useEffect(() => {
    const off = events.onFocusEvent((e) => {
      const p = usePrefs.getState()
      if (e.kind === 'timerFinished' && p.sound) playChime(p.chimeVoice, p.chimeVolume, 'finish')
    })
    return () => { void off.then((fn) => fn()) }
  }, [])

  useEffect(() => {
    const resting = (s: string) => s === 'drift' || s === 'timerDrift'
    const started = resting(state) && !resting(prevState.current)
    prevState.current = state
    const p = usePrefs.getState()
    if (started && p.sound) playChime(p.chimeVoice, p.chimeVolume, 'drift')
  }, [state])

  useEffect(() => { document.documentElement.setAttribute('data-theme', f.theme) }, [f.theme])

  // Drive the real OS window size from the measured card/pill (+ shadow padding).
  // Re-bound on `mini` because the observed element itself swaps (card ⇄ pill).
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
    <div className="nn-app" data-theme={f.theme} style={{ ...themeVars(f.theme, f.clay), width: 'fit-content', padding: PAD, background: 'transparent' }}>
      {mini
        ? <CompanionMini f={f} innerRef={cardRef} onExpand={() => setPref('companionMini', false)} />
        : <CompanionCard f={f} innerRef={cardRef} onMinimize={() => setPref('companionMini', true)} />}
    </div>
  )
}
