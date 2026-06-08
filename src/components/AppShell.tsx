// Main-window chrome: drag titlebar, sidebar nav + live status chip, page
// header. Injects theme + accent/clay CSS vars on the root and renders <Outlet>.

import { useEffect, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useFocus } from '../store/focus'
import { useUsage } from '../store/usage'
import { usePrefs } from '../store/prefs'
import { isTauri } from '../lib/api'
import { rescue } from '../lib/rescue'
import { useNube, statusFor } from '../lib/derive'
import { themeVars } from '../lib/clay'
import { Nube } from './NubeCreature'
import { Dot } from './ui'

type NavDef = { key: string; to: string; label: string; icon: (a: boolean) => ReactNode }

const NAV: NavDef[] = [
  { key: 'home', to: '/', label: 'Home', icon: (a) => <path d="M3 9.5L11 3l8 6.5V19a1 1 0 0 1-1 1h-4v-6H8v6H4a1 1 0 0 1-1-1z" fill={a ? 'currentColor' : 'none'} stroke={a ? 'none' : 'currentColor'} strokeWidth="1.6" strokeLinejoin="round" /> },
  { key: 'insights', to: '/insights', label: 'Insights', icon: () => <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 19V5" /><path d="M4 19h15" /><path d="M8 15l3-4 3 2 4-6" /></g> },
  { key: 'settings', to: '/settings', label: 'Settings', icon: () => <g fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="11" cy="11" r="3" /><path d="M11 1.5v3M11 17.5v3M1.5 11h3M17.5 11h3M4.5 4.5l2 2M15.5 15.5l2 2M17.5 4.5l-2 2M6.5 15.5l-2 2" strokeLinecap="round" /></g> },
]

const HEADERS: Record<string, { title: string; subtitle: string }> = {
  home: { title: 'Home', subtitle: 'Your live companion' },
  insights: { title: 'Insights', subtitle: 'Focus and output over time' },
  settings: { title: 'Settings', subtitle: 'Tune how Nube responds' },
  project: { title: 'Project', subtitle: 'Token composition' },
}

function NavItem({ item }: { item: NavDef }) {
  return (
    <NavLink to={item.to} end={item.to === '/'} style={{ textDecoration: 'none' }}>
      {({ isActive }) => (
        <div className="nn-ui" style={{
          position: 'relative', display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
          padding: '8px 11px', borderRadius: 'var(--r-md)',
          background: isActive ? 'var(--surface-strong)' : 'transparent',
          border: '1px solid transparent',
          color: isActive ? 'var(--ink)' : 'var(--faint)', fontSize: 13.5, fontWeight: isActive ? 600 : 500,
          transition: 'background .14s var(--ease), color .14s',
        }}>
          {isActive && <span style={{ position: 'absolute', left: -13, top: '50%', transform: 'translateY(-50%)', width: 3, height: 18, borderRadius: 2, background: 'var(--accent)' }} />}
          <svg width="19" height="19" viewBox="0 0 22 22" style={{ color: isActive ? 'var(--accent-text)' : 'currentColor' }}>{item.icon(isActive)}</svg>
          {item.label}
        </div>
      )}
    </NavLink>
  )
}

// sidebar status chip: life % + state label, or budget-left while on a distraction; links Home
function HomeBloop() {
  const s = useNube()
  const st = statusFor(s.effState, s.appName)
  const drift = s.effState === 'drifting' || s.effState === 'chillin'
  const cdTone = s.life < 30 ? 'var(--critical)' : 'var(--warning)'
  return (
    <NavLink to="/" end style={{ textDecoration: 'none' }}>
      <div className="nn-ui" style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 10px',
        borderRadius: 'var(--r-md)', border: '1px solid var(--line)', background: 'var(--surface)', textAlign: 'left',
      }}>
        <div style={{ width: 38, height: 38, borderRadius: 'var(--r-sm)', overflow: 'hidden', flexShrink: 0, border: '1px solid var(--line-faint)', background: 'var(--surface-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Nube mood={s.mood} size={36} glow={s.glow} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span className="nn-num" style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>{Math.round(s.life)}</span>
            <span className="nn-num" style={{ fontSize: 11, color: 'var(--faint)' }}>%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
            <Dot tone={drift ? cdTone : st.tone} size={6} pulse={st.pulse} />
            <span className={drift ? 'nn-num' : undefined} style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: drift ? cdTone : 'var(--faint)', fontWeight: drift ? 600 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {drift ? `${s.fmtClock(s.budgetLeft)} left` : st.label}
            </span>
          </div>
        </div>
      </div>
    </NavLink>
  )
}

export function AppShell() {
  const subscribe = useFocus((s) => s.subscribe)
  const loadAll = useUsage((s) => s.loadAll)
  const companion = usePrefs((s) => s.companion)
  const s = useNube()
  const loc = useLocation()

  useEffect(() => { void subscribe(); void loadAll() }, [subscribe, loadAll])
  useEffect(() => { document.documentElement.setAttribute('data-theme', s.theme) }, [s.theme])
  useEffect(() => { if (isTauri) void rescue.setCompanion(companion) }, [companion])

  const seg = loc.pathname.startsWith('/insights') ? 'insights'
    : loc.pathname.startsWith('/settings') ? 'settings'
    : loc.pathname.startsWith('/project') ? 'project'
    : 'home'
  const head = HEADERS[seg]

  return (
    <div className="nn-app" data-theme={s.theme} style={{ ...themeVars(s.theme, s.clay), position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--page)' }}>
      {/* titlebar — native traffic lights overlay the left inset */}
      <div data-tauri-drag-region style={{ position: 'relative', height: 40, flexShrink: 0, borderBottom: '1px solid var(--line-faint)', background: 'var(--surface-faint)' }}>
        <span className="nn-disp" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--text)', fontWeight: 600, pointerEvents: 'none' }}>NubeNube</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* sidebar */}
        <div style={{ width: 210, flexShrink: 0, background: 'var(--surface-faint)', borderRight: '1px solid var(--line-faint)', display: 'flex', flexDirection: 'column', padding: 13 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {NAV.map((it) => <NavItem key={it.key} item={it} />)}
          </div>
          <div style={{ flex: 1 }} />
          <HomeBloop />
        </div>

        {/* content */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', background: 'var(--page)' }}>
          <div style={{ height: 60, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px', borderBottom: '1px solid var(--line-faint)' }}>
            <div style={{ minWidth: 0 }}>
              <div className="nn-disp" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.1 }}>{head.title}</div>
              <div style={{ marginTop: 3, fontSize: 12.5, color: 'var(--faint)' }}>{head.subtitle}</div>
            </div>
            <div style={{ flex: 1 }} />
          </div>
          <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '22px 24px 26px' }}>
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}
