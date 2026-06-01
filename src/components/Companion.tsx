// Companion — the always-on-top desktop indicator (its own transparent window).
// Shows live Claude session counts + a countdown to "death". Drag it by the
// top handle; a clean click opens the main window.

import { useEffect, useRef, type MouseEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useFocus } from '../store/focus'
import { useUsage } from '../store/usage'
import { NubeCreature } from './NubeCreature'
import { Dot, INK, SUB } from './ui'
import { PHASE_META, phaseFromTick, mmss, type Phase } from '../lib/derive'
import { isTauri } from '../lib/api'
import { rescue } from '../lib/rescue'

const TEXT: Record<Phase, string> = { working: 'thriving', idle: 'napping', waiting: 'Claude finished working', draining: 'come back', critical: 'gasping!', fading: 'fading…', faint: 'fainted' }

export function Companion() {
  const tick = useFocus((s) => s.tick)
  const subscribe = useFocus((s) => s.subscribe)
  const projects = useUsage((s) => s.projects)
  const loadAll = useUsage((s) => s.loadAll)
  const dragging = useRef(false)

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
  const urgent = !paused && (phase === 'waiting' || phase === 'draining' || phase === 'critical' || phase === 'fading')
  const countdown = tick.secondsToDeath ?? null

  const open = () => { if (!dragging.current && isTauri) void invoke('nube_open_main').catch(() => {}) }
  const startDrag = (e: MouseEvent) => {
    e.stopPropagation()
    dragging.current = true
    if (isTauri) void getCurrentWindow().startDragging().catch(() => {})
    // reset the drag guard shortly after so a later click opens the app
    setTimeout(() => { dragging.current = false }, 150)
  }
  const togglePause = (e: MouseEvent) => { e.stopPropagation(); void rescue.setPaused(!paused) }

  return (
    <div className="nn-ui" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'transparent' }}>
      <div
        onClick={open}
        role="button"
        tabIndex={0}
        aria-label="open NubeNube"
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }}
        title="drag the handle to move · click to open"
        style={{
          width: 160, borderRadius: 22, padding: '8px 12px 11px', cursor: 'pointer',
          background: 'rgba(255,255,255,.84)', backdropFilter: 'blur(14px)',
          boxShadow: urgent ? '0 18px 40px -14px rgba(210,100,60,.6), 0 0 0 2px rgba(236,122,74,.55)' : '0 18px 40px -16px rgba(90,70,150,.55), 0 0 0 1px rgba(255,255,255,.6)',
          border: '1px solid rgba(255,255,255,.7)',
          filter: paused ? 'saturate(.7)' : 'none',
          animation: urgent && phase === 'waiting' ? 'nn-pulse 1.1s ease-in-out 3' : 'none',
        }}
      >
        {/* drag handle */}
        <div onMouseDown={startDrag} title="drag to move" style={{ display: 'flex', justifyContent: 'center', gap: 3, padding: '2px 0 4px', cursor: 'grab' }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 5, height: 5, borderRadius: 99, background: 'rgba(120,100,170,.34)' }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', height: 80, alignItems: 'center' }}>
          <NubeCreature mood={paused ? 'content' : meta.mood} hue={hue} size={92} scale={1} />
        </div>
        {paused ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span className="nn-disp" style={{ fontWeight: 700, fontSize: 13, color: SUB }}>paused · resting</span>
            <button onClick={togglePause} aria-label="resume drift tracking" style={{ border: 'none', cursor: 'pointer', borderRadius: 99, padding: '5px 14px', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 11.5, background: 'linear-gradient(165deg, hsl(158 50% 60%), hsl(158 55% 50%))', color: '#fff' }}>▶ resume</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 2 }}>
              <Dot color={meta.dot} pulse={urgent} size={7} />
              <span className="nn-disp" style={{ fontWeight: 700, fontSize: urgent ? 11.5 : 13, color: urgent ? 'var(--danger)' : INK }}>{TEXT[phase]}</span>
              <button onClick={togglePause} aria-label="pause drift tracking" title="pause (lunch / meeting)" style={{ border: 'none', cursor: 'pointer', borderRadius: 99, padding: '3px 8px', marginLeft: 2, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 11, background: 'rgba(120,100,170,.12)', color: SUB }}>⏸</button>
            </div>
            {/* session counts */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 5, fontWeight: 700, fontSize: 11, color: SUB }}>
              <span title="running">▶ {running} working</span>
              <span title="waiting" style={{ color: waiting > 0 ? 'var(--danger)' : SUB }}>⏸ {waiting} waiting</span>
            </div>
            {/* countdown to death (only when a session waits) */}
            {waiting > 0 && countdown != null && (
              <div style={{ textAlign: 'center', marginTop: 4, fontWeight: 800, fontSize: 12, color: 'var(--danger)' }} title="time until Nube dies if you stay on a distraction">
                ⏳ {mmss(countdown)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
