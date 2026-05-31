// Companion — the always-on-top desktop pet (its own transparent OS window).
// Mirrors the live Nube; click to bring the main window forward. Has a small
// pause/resume control so you can stop drift tracking for lunch / meetings.

import { useEffect, type MouseEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useFocus } from '../store/focus'
import { useUsage } from '../store/usage'
import { NubeCreature } from './NubeCreature'
import { Dot, INK, SUB } from './ui'
import { PHASE_META, phaseFromTick, mmss, type Phase } from '../lib/derive'
import { isTauri } from '../lib/api'
import { rescue } from '../lib/rescue'

const TEXT: Record<Phase, string> = { working: 'thriving', idle: 'napping', waiting: 'waiting!', draining: 'come back', critical: 'gasping!', fading: 'fading…', faint: 'fainted' }

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
  const urgent = !paused && (phase === 'draining' || phase === 'critical' || phase === 'fading')
  const secs = tick.secondsSinceClaudeFinished ?? 0
  const waiting = tick.waitingSessions ?? 0

  const open = () => { if (isTauri) void invoke('nube_open_main').catch(() => {}) }
  const togglePause = (e: MouseEvent) => { e.stopPropagation(); void rescue.setPaused(!paused) }

  return (
    <div className="nn-ui" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'transparent' }}>
      <div
        onClick={open}
        role="button"
        tabIndex={0}
        aria-label="open NubeNube"
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }}
        title="open NubeNube"
        style={{
          width: 150, cursor: 'pointer', borderRadius: 22, padding: '10px 12px 11px',
          background: 'rgba(255,255,255,.82)', backdropFilter: 'blur(14px)',
          boxShadow: urgent ? '0 18px 40px -14px rgba(210,100,60,.6), 0 0 0 2px rgba(236,122,74,.5)' : '0 18px 40px -16px rgba(90,70,150,.55), 0 0 0 1px rgba(255,255,255,.6)',
          border: '1px solid rgba(255,255,255,.7)',
          filter: paused ? 'saturate(.7)' : 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', gap: 3, marginBottom: 2 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 4, height: 4, borderRadius: 99, background: 'rgba(120,100,170,.3)' }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', height: 84, alignItems: 'center' }}>
          <NubeCreature mood={paused ? 'content' : meta.mood} hue={hue} size={96} scale={1} />
        </div>
        {paused ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span className="nn-disp" style={{ fontWeight: 700, fontSize: 13, color: SUB }}>paused · resting</span>
            <button onClick={togglePause} aria-label="resume drift tracking" style={{ border: 'none', cursor: 'pointer', borderRadius: 99, padding: '5px 14px', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 11.5, background: 'linear-gradient(165deg, hsl(158 50% 60%), hsl(158 55% 50%))', color: '#fff' }}>▶ resume</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 2 }}>
              <Dot color={meta.dot} pulse={urgent || phase === 'waiting'} size={7} />
              <span className="nn-disp" style={{ fontWeight: 700, fontSize: 13, color: urgent ? 'var(--danger)' : INK }}>{TEXT[phase]}</span>
              {(urgent || phase === 'waiting') && <span className="nn-disp" style={{ fontWeight: 700, fontSize: 12, color: SUB, marginLeft: 2 }}>{mmss(secs)}</span>}
              <button onClick={togglePause} aria-label="pause drift tracking" title="pause (lunch / meeting)" style={{ border: 'none', cursor: 'pointer', borderRadius: 99, padding: '3px 8px', marginLeft: 2, fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 11, background: 'rgba(120,100,170,.12)', color: SUB }}>⏸</button>
            </div>
            {waiting > 1 && (
              <div style={{ textAlign: 'center', marginTop: 4, fontWeight: 700, fontSize: 10, color: SUB }}>{waiting} sessions waiting</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
