// Home — the live hero. The Nube in its biome + the 70%-base / 30%-earned life
// model, all driven by the real `focus-tick` (cloudHealth, state, away-timer).

import { useFocus } from '../store/focus'
import { useUsage } from '../store/usage'
import { useDemo } from '../store/demo'
import { NubeCreature } from '../components/NubeCreature'
import { Sky, Cloud, Sun, Rain, Twinkles, Zzz } from '../components/Biome'
import { Btn, Dot, LifeBar, INK, SUB, FAINT, shadow, elev } from '../components/ui'
import { hueClay } from '../lib/clay'
import {
  BASE_LIFE,
  PHASE_META,
  phaseFromTick,
  lifeFromHealth,
  sizeFor,
  mmss,
  greeting,
  type Phase,
} from '../lib/derive'
import { rescue } from '../lib/rescue'
import { isTauri } from '../lib/api'
import type { Project } from '../types'

// Representative life + away-time for the demo dock (browser preview only).
const DEMO_LIFE: Record<Phase, number> = { working: 90, idle: 70, waiting: 86, draining: 62, critical: 36, fading: 13, faint: 0 }
const DEMO_SECS: Record<Phase, number> = { working: 0, idle: 0, waiting: 6, draining: 48, critical: 132, fading: 322, faint: 0 }

function homeProject(projects: Project[], activeId?: string): Project | null {
  if (!projects.length) return null
  return projects.find((p) => p.id === activeId) ?? [...projects].sort((a, b) => b.waterMl - a.waterMl)[0]
}

export function Home() {
  const tick = useFocus((s) => s.tick)
  const projects = useUsage((s) => s.projects)
  const demoPhase = useDemo((s) => s.phase)

  const phase: Phase = demoPhase ?? phaseFromTick(tick)
  const meta = PHASE_META[phase]
  const project = homeProject(projects, tick.activeProjectId)
  const hue = project?.colorHue ?? 268
  const c = hueClay(hue)
  const name = project?.name ?? tick.activeProjectName ?? 'your project'

  const maxW = Math.max(...projects.map((p) => p.waterMl), 1)
  const water = project?.waterMl ?? maxW
  const scale = sizeFor(water, maxW)

  const life = demoPhase ? DEMO_LIFE[phase] : lifeFromHealth(tick.cloudHealth)
  const secs = demoPhase ? DEMO_SECS[phase] : tick.secondsSinceClaudeFinished ?? 0
  const waiting = demoPhase ? 0 : tick.waitingSessions ?? 0
  const above = life >= BASE_LIFE
  const earned = Math.max(0, life - BASE_LIFE)
  const urgent = phase === 'draining' || phase === 'critical' || phase === 'fading'
  const lifeCol = urgent || phase === 'faint' ? 'var(--danger)' : c.ink

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const onAct = () => { if (isTauri) void rescue.openMain().catch(() => {}) }

  return (
    <div className="nn-ui" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 14, padding: '20px 22px', overflow: 'hidden' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div className="nn-disp" style={{ fontWeight: 800, fontSize: 23, color: INK, lineHeight: 1, letterSpacing: '-.01em' }}>{greeting()}</div>
          <div style={{ fontWeight: 600, fontSize: 12.5, color: SUB, marginTop: 4, whiteSpace: 'nowrap' }}>
            {today} · your home bloop is <b style={{ color: c.ink }}>{name}</b>
          </div>
        </div>
      </div>

      {/* hero biome */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, borderRadius: 20, overflow: 'hidden', border: elev.border, boxShadow: shadow.md }}>
        <Sky state={meta.sky}>
          {phase === 'working' && <Sun x={'76%'} y={24} size={62} />}
          <Cloud x={-26} y={36} scale={0.66} health={phase === 'faint' ? 0.4 : 1} dur={18} anim="drift1" />
          <Cloud x={'68%'} y={'58%'} scale={0.56} health={phase === 'faint' ? 0.4 : 1} dur={24} delay={2} anim="drift2" />
          {phase === 'working' && <Twinkles count={8} area={{ w: 760, h: 340 }} />}
          {meta.distract && <Rain count={phase === 'fading' ? 22 : phase === 'critical' ? 16 : 10} area={{ w: 760, h: 300 }} color={c.mid} />}
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-52%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <NubeCreature mood={meta.mood} hue={hue} size={phase === 'faint' ? 200 : 184} scale={scale} />
            {phase === 'idle' && <Zzz x={118} y={-148} />}
          </div>
        </Sky>

        {/* status strip */}
        <div style={{ position: 'absolute', left: 16, top: 14, display: 'inline-flex', alignItems: 'center', gap: 9, background: 'rgba(255,255,255,.86)', backdropFilter: 'blur(10px)', borderRadius: 99, padding: '7px 14px 7px 11px', boxShadow: shadow.sm, border: '1px solid rgba(255,255,255,.6)' }}>
          <Dot color={meta.dot} pulse={urgent} />
          <span className="nn-disp" style={{ fontWeight: 700, fontSize: 13, color: INK, whiteSpace: 'nowrap' }}>{meta.head}</span>
          {waiting > 1 && (
            <span style={{ fontWeight: 700, fontSize: 11, color: SUB, background: 'rgba(120,100,170,.12)', borderRadius: 99, padding: '2px 8px', whiteSpace: 'nowrap' }}>{waiting} waiting</span>
          )}
        </div>

        {/* away timer */}
        {(urgent || phase === 'waiting') && (
          <div style={{ position: 'absolute', right: 14, top: 12, textAlign: 'right', background: 'rgba(255,255,255,.84)', backdropFilter: 'blur(10px)', borderRadius: 14, padding: '7px 13px', boxShadow: shadow.sm, border: '1px solid rgba(255,255,255,.6)' }}>
            <div style={{ fontWeight: 700, fontSize: 9.5, color: SUB, letterSpacing: '.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{phase === 'waiting' ? 'waiting' : 'away from Claude'}</div>
            <div className="nn-num" style={{ fontWeight: 800, fontSize: 24, lineHeight: 1.05, color: urgent ? 'var(--danger)' : c.ink }}>{mmss(secs)}</div>
          </div>
        )}
      </div>

      {/* life panel */}
      <div style={{ padding: '16px 20px', background: 'var(--surface)', borderRadius: 16, border: elev.border, boxShadow: shadow.md }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 10.5, color: FAINT, letterSpacing: '.06em', textTransform: 'uppercase' }}>life today</span>
            <span className="nn-num" style={{ fontWeight: 800, fontSize: 28, lineHeight: 1, color: lifeCol }}>
              {Math.round(life)}
              <span style={{ fontSize: 16 }}>%</span>
            </span>
          </div>
          {meta.cta && (
            <Btn hue={urgent ? 26 : hue} size="sm" onClick={onAct}>
              {meta.cta}
            </Btn>
          )}
        </div>
        <LifeBar life={life} base={BASE_LIFE} hue={hue} draining={urgent} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 11 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: above ? c.mid : 'rgba(150,130,180,.4)' }} />
            <span style={{ fontWeight: 700, fontSize: 11.5, color: SUB }}>base {BASE_LIFE}%</span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: above ? c.deep : '#ea7458' }} />
            <span style={{ fontWeight: 700, fontSize: 11.5, color: SUB }}>{above ? `earned +${Math.round(earned)}%` : `${Math.round(BASE_LIFE - life)}% below base`}</span>
          </span>
          <span style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 11, color: FAINT }}>work earns up to +30%</span>
        </div>
        <div style={{ fontWeight: 600, fontSize: 12, color: urgent ? '#c9633c' : SUB, marginTop: 9 }}>{meta.sub}</div>
      </div>
    </div>
  )
}
