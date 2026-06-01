// Companion — the always-on-top desktop indicator (its own transparent window).
// The card FILLS the window via flexbox (the creature row absorbs slack), so the
// content can never clip. The whole card is a Tauri drag region: non-interactive
// content uses pointer-events:none so the press falls through and drags it; the
// pause button re-enables pointer-events. Open the main window from the tray.

import { useEffect, useState, type MouseEvent } from 'react'
import { useFocus } from '../store/focus'
import { useUsage } from '../store/usage'
import { NubeCreature } from './NubeCreature'
import { Dot, INK, SUB } from './ui'
import { PHASE_META, phaseFromTick, mmss, type Phase } from '../lib/derive'
import { rescue } from '../lib/rescue'

const TEXT: Record<Phase, string> = {
  working: 'thriving',
  idle: 'napping',
  waiting: 'Claude finished — your turn',
  draining: 'come back to Claude',
  critical: 'gasping!',
  fading: 'fading…',
  faint: 'fainted',
}
const PASS = { pointerEvents: 'none' as const } // fall through to the drag region
const CLICK = { pointerEvents: 'auto' as const } // re-enable for a control
const DRAINING: Phase[] = ['draining', 'critical', 'fading']

export function Companion() {
  const tick = useFocus((s) => s.tick)
  const subscribe = useFocus((s) => s.subscribe)
  const projects = useUsage((s) => s.projects)
  const loadAll = useUsage((s) => s.loadAll)

  useEffect(() => {
    document.documentElement.classList.add('nn-transparent')
    void subscribe()
    void loadAll()
    return () => document.documentElement.classList.remove('nn-transparent')
  }, [subscribe, loadAll])

  const paused = tick.state === 'paused'
  const phase = phaseFromTick(tick)
  const meta = PHASE_META[phase]
  const project = projects.find((p) => p.id === tick.activeProjectId)
  const hue = project?.colorHue ?? 268
  const waiting = tick.waitingSessions ?? 0
  const running = tick.runningSessions ?? 0
  const urgent = !paused && (phase === 'waiting' || DRAINING.includes(phase))
  const backendCountdown = tick.secondsToDeath ?? null

  // Smooth real-time countdown: re-anchor to the backend value on each tick, and
  // tick down locally every second WHILE actively draining (on a distraction).
  // When merely waiting (you're not distracted) it holds — the meter is paused,
  // so the timer is too.
  const [shown, setShown] = useState<number | null>(backendCountdown)
  useEffect(() => { setShown(backendCountdown) }, [backendCountdown])
  useEffect(() => {
    if (!DRAINING.includes(phase)) return
    const id = setInterval(() => setShown((s) => (s == null ? s : Math.max(0, s - 1))), 1000)
    return () => clearInterval(id)
  }, [phase])

  const togglePause = (e: MouseEvent) => { e.stopPropagation(); void rescue.setPaused(!paused) }
  const showCountdown = waiting > 0 && shown != null

  return (
    <div className="nn-ui" style={{ position: 'fixed', inset: 0, padding: 8, background: 'transparent' }}>
      <div
        data-tauri-drag-region
        title="drag anywhere to move"
        style={{
          width: '100%', height: '100%', boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          borderRadius: 24, padding: '10px 12px 12px', cursor: 'grab', overflow: 'hidden',
          background: 'rgba(255,255,255,.87)', backdropFilter: 'blur(16px)',
          boxShadow: urgent
            ? '0 16px 38px -14px rgba(210,100,60,.55), 0 0 0 2px rgba(236,122,74,.55)'
            : '0 16px 38px -16px rgba(90,70,150,.5), 0 0 0 1px rgba(255,255,255,.6)',
          border: '1px solid rgba(255,255,255,.7)',
          filter: paused ? 'saturate(.7)' : 'none',
          animation: urgent && phase === 'waiting' ? 'nn-pulse 1.1s ease-in-out 3' : 'none',
        }}
      >
        {/* grab hint */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 3, ...PASS }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 5, height: 5, borderRadius: 99, background: 'rgba(120,100,170,.32)' }} />
          ))}
        </div>

        {/* creature — flex:1 absorbs slack so the layout never clips */}
        <div style={{ flex: 1, minHeight: 76, display: 'flex', alignItems: 'center', justifyContent: 'center', ...PASS }}>
          <NubeCreature mood={paused ? 'content' : meta.mood} hue={hue} size={84} scale={1} />
        </div>

        {paused ? (
          <button
            onClick={togglePause}
            aria-label="resume drift tracking"
            style={{ ...CLICK, border: 'none', cursor: 'pointer', borderRadius: 99, padding: '6px 16px', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 12, background: 'linear-gradient(165deg, hsl(158 50% 60%), hsl(158 55% 50%))', color: '#fff' }}
          >
            ▶ resume
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: '100%' }}>
            {/* status line */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, ...PASS }}>
              <Dot color={meta.dot} pulse={urgent} size={7} />
              <span className="nn-disp" style={{ fontWeight: 800, fontSize: 12.5, color: urgent ? 'var(--danger)' : INK, textAlign: 'center', lineHeight: 1.15 }}>{TEXT[phase]}</span>
            </div>

            {/* session counts */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, fontWeight: 700, fontSize: 11, ...PASS }}>
              <span style={{ color: running > 0 ? '#2f8a76' : SUB }}>▶ {running} working</span>
              <span style={{ width: 3, height: 3, borderRadius: 99, background: 'rgba(120,100,170,.4)' }} />
              <span style={{ color: waiting > 0 ? 'var(--danger)' : SUB }}>⏸ {waiting} waiting</span>
            </div>

            {/* countdown — appears the moment a session waits; ticks while drifting */}
            {showCountdown && (
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 1, fontWeight: 800, fontSize: 14, color: 'var(--danger)', fontVariantNumeric: 'tabular-nums', ...PASS }}
                title="time until Nube dies if you stay on a distraction"
              >
                <span style={{ fontSize: 11 }}>⏳</span> {mmss(shown!)}
              </div>
            )}

            {/* pause control */}
            <button
              onClick={togglePause}
              aria-label="pause drift tracking"
              title="pause (lunch / meeting)"
              style={{ ...CLICK, marginTop: 2, border: 'none', cursor: 'pointer', borderRadius: 99, padding: '3px 12px', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 10.5, background: 'rgba(120,100,170,.12)', color: SUB }}
            >
              ⏸ pause
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
