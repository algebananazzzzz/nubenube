// Main-window chrome: drag titlebar, sidebar nav + live status chip, page
// header, toast. Injects theme + accent/clay CSS vars on the root.

import { useEffect, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useFocus } from '../store/focus'
import { usePrefs } from '../store/prefs'
import { useSettings } from '../store/settings'
import { useToast, say } from '../store/toast'
import { events, isTauri } from '../lib/api'
import { rescue } from '../lib/rescue'
import { statusLine, useFocusView } from '../lib/derive'
import { themeVars } from '../lib/clay'
import { fmtHM } from '../lib/format'
import { Nube } from './NubeCreature'
import { Bar, Dot } from './ui'
import { UpdatePrompt } from './UpdatePrompt'

type NavDef = { to: string; label: string; icon: (a: boolean) => ReactNode }

const NAV: NavDef[] = [
  { to: '/', label: 'Home', icon: (a) => <path d="M3 9.5L11 3l8 6.5V19a1 1 0 0 1-1 1h-4v-6H8v6H4a1 1 0 0 1-1-1z" fill={a ? 'currentColor' : 'none'} stroke={a ? 'none' : 'currentColor'} strokeWidth="1.6" strokeLinejoin="round" /> },
  { to: '/insights', label: 'Insights', icon: () => <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 19V5" /><path d="M4 19h15" /><path d="M8 15l3-4 3 2 4-6" /></g> },
  { to: '/rules', label: 'Rules', icon: () => <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 6h16M3 11h16M3 16h16" /><circle cx="8" cy="6" r="2" fill="var(--surface-faint)" /><circle cx="14" cy="11" r="2" fill="var(--surface-faint)" /><circle cx="7" cy="16" r="2" fill="var(--surface-faint)" /></g> },
  { to: '/sources', label: 'Apps & Sites', icon: (a) => <g fill={a ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="12" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="12" width="7" height="7" rx="1.5" /><rect x="12" y="12" width="7" height="7" rx="1.5" /></g> },
  { to: '/settings', label: 'Settings', icon: () => <g fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="11" cy="11" r="3" /><path d="M11 1.5v3M11 17.5v3M1.5 11h3M17.5 11h3M4.5 4.5l2 2M15.5 15.5l2 2M17.5 4.5l-2 2M6.5 15.5l-2 2" strokeLinecap="round" /></g> },
]

function NavItem({ item }: { item: NavDef }) {
  return (
    <NavLink to={item.to} end={item.to === '/'} style={{ textDecoration: 'none' }}>
      {({ isActive }) => (
        <div className="nn-ui" style={{
          position: 'relative', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', borderRadius: 'var(--r-md)',
          background: isActive ? 'var(--surface-strong)' : 'transparent',
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

function SideChip() {
  const f = useFocusView()
  const s = statusLine(f)
  return (
    <NavLink to="/" end style={{ textDecoration: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 'var(--r-md)', border: '1px solid var(--line)', background: 'var(--surface)' }}>
        <div style={{ width: 38, height: 38, borderRadius: 'var(--r-sm)', overflow: 'hidden', flexShrink: 0, border: '1px solid var(--line-faint)', background: 'var(--surface-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Nube mood={f.mood} size={36} glow={f.glow} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span className="nn-num" style={{ fontSize: 14, fontWeight: 700, color: f.hpTone, lineHeight: 1, whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtHM(f.bank)}</span>
            <span style={{ fontSize: 11, color: 'var(--faint)', whiteSpace: 'nowrap' }}>rest</span>
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: f.phase.tone, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.phase.name}</div>
          <div style={{ marginTop: 5 }}><Bar pct={f.hp} color={f.hpTone} height={4} /></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5 }}>
            <Dot tone={s.tone} size={6} pulse={s.pulse} />
            <span className="nn-num" style={{ flex: 1, minWidth: 0, fontSize: 11, color: s.tone, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.text}</span>
          </div>
        </div>
      </div>
    </NavLink>
  )
}

function Toast() {
  const notice = useToast((s) => s.notice)
  const dismiss = useToast((s) => s.say)
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => dismiss(null), 4200)
    return () => clearTimeout(t)
  }, [notice, dismiss])
  if (!notice) return null
  return (
    <div style={{
      position: 'fixed', left: '50%', bottom: 22, transform: 'translateX(-50%)', zIndex: 60,
      display: 'flex', alignItems: 'center', gap: 12, maxWidth: '90vw', padding: '10px 14px', borderRadius: 'var(--r-md)',
      background: 'var(--surface-strong)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-md)', animation: 'nn-from-tr .18s var(--ease-soft)',
    }}>
      <span style={{ fontSize: 13, color: 'var(--text)' }}>{notice}</span>
      <button onClick={() => dismiss(null)} style={{ flexShrink: 0, border: 'none', background: 'none', color: 'var(--faint)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
    </div>
  )
}

const TITLES: Record<string, string> = { insights: 'Insights', rules: 'Rules', sources: 'Apps & Sites', settings: 'Settings' }
const IS_MAC = navigator.userAgent.includes('Mac')

export function AppShell() {
  const subscribe = useFocus((s) => s.subscribe)
  const loadSettings = useSettings((s) => s.load)
  const companion = usePrefs((s) => s.companion)
  const f = useFocusView()
  const loc = useLocation()

  useEffect(() => { void subscribe(); void loadSettings() }, [subscribe, loadSettings])
  useEffect(() => { document.documentElement.setAttribute('data-theme', f.theme) }, [f.theme])
  useEffect(() => { if (isTauri) void rescue.setCompanion(companion) }, [companion])
  useEffect(() => {
    const off = events.onFocusEvent((e) => {
      if (e.kind === 'timerFinished') say(`Session done! +${fmtHM(e.earned)} rest earned`)
      else say(`Target hit! +${fmtHM(e.bonus)} rest earned`)
    })
    return () => { void off.then((fn) => fn()) }
  }, [])

  const title = TITLES[loc.pathname.split('/')[1]] ?? 'Home'

  return (
    <div className="nn-app" data-theme={f.theme} style={{ ...themeVars(f.theme, f.clay), position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--page)' }}>
      {/* macOS overlays the traffic lights on the page; elsewhere the OS titlebar already shows the name */}
      {IS_MAC && <div data-tauri-drag-region style={{ position: 'relative', height: 40, flexShrink: 0, borderBottom: '1px solid var(--line-faint)', background: 'var(--surface-faint)' }}>
        <span className="nn-disp" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--text)', pointerEvents: 'none' }}>NubeNube</span>
      </div>}

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ width: 210, flexShrink: 0, background: 'var(--surface-faint)', borderRight: '1px solid var(--line-faint)', display: 'flex', flexDirection: 'column', padding: 13 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {NAV.map((it) => <NavItem key={it.to} item={it} />)}
          </div>
          <div style={{ flex: 1 }} />
          <SideChip />
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ height: 60, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 24px', borderBottom: '1px solid var(--line-faint)' }}>
            <div className="nn-disp" style={{ fontSize: 16, color: 'var(--ink)', lineHeight: 1.1 }}>{title}</div>
          </div>
          <div key={loc.pathname} style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '22px 24px 26px' }}>
            <Outlet />
          </div>
        </div>
      </div>
      <Toast />
      <UpdatePrompt />
    </div>
  )
}
