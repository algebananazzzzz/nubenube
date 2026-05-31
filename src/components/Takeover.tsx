// Takeover — the full-screen rescue. Used two ways: as its own always-on-top OS
// window (TakeoverWindow, driven by the live tick + the main-window supervisor),
// and as an in-app overlay for browser/demo preview (TakeoverView). Ported from
// overlays.jsx.

import { useEffect } from 'react'
import { useFocus } from '../store/focus'
import { useUsage } from '../store/usage'
import { NubeCreature } from './NubeCreature'
import { Rain } from './Biome'
import { hueClay } from '../lib/clay'
import { phaseFromTick, lifeFromHealth, mmss, type NubeMood, type Phase } from '../lib/derive'
import { rescue, emitRescue } from '../lib/rescue'
import type { TakeoverLevel } from '../store/demo'

type TK = { mood: NubeMood; hue: number; bg: string; accent: number; kicker: string; title: string; sub: string; alarm: boolean; rain: boolean }
const TKS: Record<TakeoverLevel, TK> = {
  finish: { mood: 'alert', hue: 205, bg: 'radial-gradient(120% 120% at 50% 30%, #cfe0f6, #b8c9ee 60%, #9fb0e0)', accent: 205, kicker: 'Claude Code finished', title: "Nube's waiting for you", sub: 'hop back before it starts to drift', alarm: false, rain: false },
  '2min': { mood: 'gasping', hue: 28, bg: 'radial-gradient(120% 120% at 50% 30%, #ffe0b0, #ffb886 58%, #f59264)', accent: 28, kicker: "you've been gone 2 minutes", title: 'Nube is gasping', sub: 'it is losing water fast — come back now', alarm: true, rain: true },
  '5min': { mood: 'fading', hue: 8, bg: 'radial-gradient(120% 120% at 50% 30%, #ffd0c0, #f59a84 52%, #e06a52)', accent: 8, kicker: 'five minutes away', title: 'Nube is fading away', sub: 'a few more seconds and it faints — save it!', alarm: true, rain: true },
}

export function TakeoverView({ level, secs = 0, life = 100, hue = 270, onBack, onSnooze }: { level: TakeoverLevel; secs?: number; life?: number; hue?: number; onBack: () => void; onSnooze: () => void }) {
  const t = TKS[level]
  const c = hueClay(t.hue)
  return (
    <div className="nn-ui" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: t.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {t.alarm && <div style={{ position: 'absolute', inset: 0, boxShadow: `inset 0 0 200px 40px ${c.deep}`, animation: 'nbDangerGlow 1.3s ease-in-out infinite', pointerEvents: 'none' }} />}
      {t.rain && <Rain count={26} area={{ w: 1200, h: 500 }} color="rgba(255,255,255,.6)" />}

      <div style={{ position: 'relative', textAlign: 'center', maxWidth: 700, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', animation: 'nnPop .4s ease both' }}>
        <div className="nn-disp" style={{ fontWeight: 800, fontSize: 14, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.9)' }}>{t.kicker}</div>
        <div style={{ margin: '6px auto 4px' }}>
          <NubeCreature mood={t.mood} hue={hue} size={240} scale={1} />
        </div>
        <div className="nn-disp" style={{ fontWeight: 800, fontSize: 42, color: '#fff', lineHeight: 1.08, textShadow: '0 2px 18px rgba(120,60,30,.3)', whiteSpace: 'nowrap' }}>{t.title}</div>
        <div style={{ fontWeight: 700, fontSize: 17, color: 'rgba(255,255,255,.92)', marginTop: 6 }}>{t.sub}</div>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 18, marginTop: 18, background: 'rgba(255,255,255,.22)', backdropFilter: 'blur(8px)', borderRadius: 18, padding: '12px 22px' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="nn-disp" style={{ fontWeight: 800, fontSize: 30, color: '#fff', lineHeight: 1 }}>{mmss(secs)}</div>
            <div style={{ fontWeight: 700, fontSize: 11, color: 'rgba(255,255,255,.85)' }}>away from Claude</div>
          </div>
          <div style={{ width: 1, height: 34, background: 'rgba(255,255,255,.4)' }} />
          <div style={{ textAlign: 'center' }}>
            <div className="nn-disp" style={{ fontWeight: 800, fontSize: 30, color: '#fff', lineHeight: 1 }}>{Math.round(life)}%</div>
            <div style={{ fontWeight: 700, fontSize: 11, color: 'rgba(255,255,255,.85)' }}>life remaining</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 24 }}>
          <button onClick={onBack} style={{ border: 'none', cursor: 'pointer', borderRadius: 99, padding: '16px 44px', fontFamily: 'var(--font-disp)', fontWeight: 800, fontSize: 20, background: '#fff', color: c.ink, boxShadow: '0 16px 36px -14px rgba(80,40,20,.5)', transition: 'transform .12s ease' }} onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.04)')} onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}>
            {level === 'finish' ? "I'm back →" : 'Rescue Nube →'}
          </button>
          <button onClick={onSnooze} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'rgba(255,255,255,.8)', fontFamily: 'var(--font-disp)', fontWeight: 700, fontSize: 13.5 }}>
            {level === '5min' ? '😢 snooze (it keeps fading)' : '😔 snooze a little'}
          </button>
        </div>
      </div>
    </div>
  )
}

const LEVEL_FOR: Partial<Record<Phase, TakeoverLevel>> = { waiting: 'finish', draining: 'finish', critical: '2min', fading: '5min' }

export function TakeoverWindow() {
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

  const phase = phaseFromTick(tick)
  const level = LEVEL_FOR[phase]
  if (!level) return <div style={{ position: 'fixed', inset: 0, background: 'transparent' }} />

  const hue = projects.find((p) => p.id === tick.activeProjectId)?.colorHue ?? 270
  return (
    <TakeoverView
      level={level}
      secs={tick.secondsSinceClaudeFinished ?? 0}
      life={lifeFromHealth(tick.cloudHealth)}
      hue={hue}
      onBack={() => { void rescue.hideTakeover(); void rescue.openMain(); emitRescue('back') }}
      onSnooze={() => { void rescue.hideTakeover(); emitRescue('snooze') }}
    />
  )
}
