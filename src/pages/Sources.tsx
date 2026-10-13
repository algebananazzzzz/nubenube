// Apps & Sites: classify apps and websites as Work / Neutral / Rest. App
// tracking is live; website tracking and the DNS shield are UI-only for now.

import { useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { useSettings } from '../store/settings'
import { say } from '../store/toast'
import { Avatar, Btn, Card, ClassSwitch, Dot, Pill, PrefRow, SegTabs, Section, ShieldIcon, SoonPill, Toggle } from '../components/ui'
import type { AppClass, Settings } from '../types'

const ORDER: Record<AppClass, number> = { rest: 0, neutral: 1, work: 2 }

function WatchCard() {
  const rows = [
    { t: 'Apps', h: 'Frontmost app', d: 'Tracks whichever app is in front. No permissions needed.', live: true },
    { t: 'Websites', h: 'Active browser tab', d: 'Reads the current tab in your browser.', live: false },
    { t: 'Blocking', h: 'Local DNS shield', d: "Rest sites won't load in any browser or app while a timer runs.", live: false },
  ]
  return (
    <Card pad={20}>
      <Section>How tracking works</Section>
      {rows.map((r) => (
        <div key={r.t} style={{ display: 'flex', gap: 12, padding: '11px 0', borderTop: '1px solid var(--line-faint)' }}>
          <span className="nn-eyebrow" style={{ width: 66, flexShrink: 0, paddingTop: 2 }}>{r.t}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>{r.h}</span>
              {r.live
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: 'var(--success)' }}><Dot tone="var(--success)" size={6} />Active</span>
                : <SoonPill />}
            </div>
            <div style={{ fontSize: 12, color: 'var(--faint)', lineHeight: 1.45, marginTop: 3, textWrap: 'pretty' }}>{r.d}</div>
          </div>
        </div>
      ))}
      <div style={{ fontSize: 12, color: 'var(--faint)', lineHeight: 1.45, paddingTop: 11, borderTop: '1px solid var(--line-faint)' }}>
        Tracking pauses after you've been idle for 2 minutes.
      </div>
    </Card>
  )
}

function ShieldCard({ s, save }: { s: Settings; save: (p: Partial<Settings>) => void }) {
  const sh = s.shield
  const set = (p: Partial<Settings['shield']>) => save({ shield: { ...sh, ...p } })
  const listed = s.sites.filter((x) => x.class === 'rest').length
  return (
    <Card pad={20}>
      <Section right={<SoonPill />}>Site blocking</Section>
      <div className="nn-mono" style={{ fontSize: 11.5, color: 'var(--faint)', padding: '8px 10px', borderRadius: 'var(--r-sm)', background: 'var(--surface-faint)', border: '1px solid var(--line-faint)' }}>
        {listed} domains on the block list
      </div>
      <PrefRow title="Block during timers" desc="Rest sites won't load during a focus session."><Toggle on={sh.enabled} onChange={(v) => set({ enabled: v })} /></PrefRow>
      <PrefRow title="Include subdomains" desc="Also blocks m.youtube.com, old.reddit.com and so on."><Toggle on={sh.subdomains} onChange={(v) => set({ subdomains: v })} /></PrefRow>
      <PrefRow title="Encrypted-DNS guard" desc="Stops browsers from getting around the block with encrypted DNS." last><Toggle on={sh.dohGuard} onChange={(v) => set({ dohGuard: v })} /></PrefRow>
    </Card>
  )
}

const cleanDomain = (v: string) => v.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#:]/)[0].replace(/\.$/, '')
const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/

function SitesList({ s, save }: { s: Settings; save: (p: Partial<Settings>) => void }) {
  const [q, setQ] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const setClass = (domain: string, c: AppClass) => save({ sites: s.sites.map((x) => (x.domain === domain ? { ...x, class: c } : x)) })
  const remove = (domain: string) => save({ sites: s.sites.filter((x) => x.domain !== domain) })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const d = cleanDomain(q)
    if (!d) return
    if (!DOMAIN_RE.test(d)) return setErr("That isn't a valid domain.")
    if (s.sites.some((x) => x.domain === d)) return setErr(`${d} is already on your list.`)
    save({ sites: [{ domain: d, class: 'rest' }, ...s.sites] })
    setQ('')
  }
  const hint: Record<AppClass, string> = { rest: 'blocked during focus sessions', neutral: 'not counted', work: 'counts as work' }
  const sorted = [...s.sites].sort((a, b) => ORDER[a.class] - ORDER[b.class] || a.domain.localeCompare(b.domain))
  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--faint)', lineHeight: 1.45, marginBottom: 10 }}>
        Website tracking and blocking are coming soon. Your list is saved for when they land.
      </div>
      <form onSubmit={submit} style={{ display: 'flex', gap: 8, marginBottom: err ? 6 : 10 }}>
        <input value={q} onChange={(e) => { setQ(e.target.value); setErr(null) }} placeholder="Add a domain, like tiktok.com" aria-invalid={!!err} className="nn-mono"
          style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--ink)', background: 'var(--surface-faint)', border: `1px solid ${err ? 'var(--critical)' : 'var(--line)'}`, borderRadius: 'var(--r-md)', padding: '8px 11px', outline: 'none', userSelect: 'text' }} />
        <Btn variant="soft" size="sm" disabled={!q.trim()}>Add</Btn>
      </form>
      {err && <div style={{ fontSize: 12, color: 'var(--critical)', marginBottom: 10 }}>{err}</div>}
      {sorted.map((x, i) => (
        <div key={x.domain} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 2px', borderBottom: i === sorted.length - 1 ? 'none' : '1px solid var(--line-faint)' }}>
          <Avatar name={x.domain} size={28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="nn-mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.domain}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: x.class === 'rest' ? 'var(--critical)' : 'var(--faint)', marginTop: 2 }}>
              {x.class === 'rest' && <ShieldIcon size={11} />}{hint[x.class]}
            </div>
          </div>
          <ClassSwitch value={x.class} onChange={(v) => setClass(x.domain, v)} />
          <button onClick={() => remove(x.domain)} aria-label={`Remove ${x.domain}`} title="Remove" className="nn-ui"
            style={{ width: 26, height: 26, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', color: 'var(--faint)', cursor: 'pointer', borderRadius: 'var(--r-sm)', fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      ))}
    </>
  )
}

function AppsList({ s, save }: { s: Settings; save: (p: Partial<Settings>) => void }) {
  const [scanning, setScanning] = useState(false)
  const apps = Object.keys(s.apps).sort((a, b) => a.localeCompare(b))
  const setClass = (n: string, c: AppClass) => save({ apps: { ...s.apps, [n]: c } })
  // Adds every app seen in front or running now, as Neutral, without touching existing ones.
  const scan = async () => {
    setScanning(true)
    try {
      const [known, running] = await Promise.all([api.getKnownApps(), api.listRunningApps()])
      const found = [...known.map((k) => k.name), ...running].filter((n) => n.trim() && !(n in s.apps))
      if (found.length) save({ apps: { ...Object.fromEntries(found.map((n) => [n, 'neutral' as const])), ...s.apps } })
      say(found.length ? `Found ${found.length} new app${found.length === 1 ? '' : 's'}` : 'No new apps found')
    } catch (e) {
      say(`Scan failed: ${e}`)
    } finally {
      setScanning(false)
    }
  }
  const hint: Record<AppClass, string> = { rest: 'costs rest', neutral: 'not counted', work: 'counts as work' }
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--faint)' }}>{apps.length ? '' : 'Scan to list the apps you use.'}</span>
        <Btn variant="line" size="sm" onClick={() => void scan()} disabled={scanning}>{scanning ? 'Scanning…' : 'Scan apps'}</Btn>
      </div>
      {apps.map((n, i) => (
        <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 2px', borderBottom: i === apps.length - 1 ? 'none' : '1px solid var(--line-faint)' }}>
          <Avatar name={n} size={28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</div>
            <div style={{ fontSize: 11.5, color: s.apps[n] === 'rest' ? 'var(--critical)' : 'var(--faint)', marginTop: 2 }}>{hint[s.apps[n]]}</div>
          </div>
          <ClassSwitch value={s.apps[n]} onChange={(v) => setClass(n, v)} />
        </div>
      ))}
    </>
  )
}

export function Sources() {
  const s = useSettings((st) => st.settings)
  const saveAsync = useSettings((st) => st.save)
  const [tab, setTab] = useState<'sites' | 'apps'>('apps')
  if (!s) return null
  const save = (p: Partial<Settings>) => void saveAsync(p)
  const classes: AppClass[] = tab === 'sites' ? s.sites.map((x) => x.class) : Object.values(s.apps)
  const count = (k: AppClass) => classes.filter((c) => c === k).length
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 14, alignItems: 'start', maxWidth: 1100 }}>
      <Card pad={20}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <SegTabs tabs={[{ key: 'apps', label: `Apps · ${Object.keys(s.apps).length}` }, { key: 'sites', label: `Websites · ${s.sites.length}` }]} value={tab} onChange={setTab} size="sm" />
          <span style={{ flex: 1 }} />
          <Pill tone="danger" style={{ fontSize: 11 }}>{`${count('rest')} rest`}</Pill>
          <Pill tone="mint" style={{ fontSize: 11 }}>{`${count('work')} work`}</Pill>
        </div>
        {tab === 'sites' ? <SitesList s={s} save={save} /> : <AppsList s={s} save={save} />}
      </Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ShieldCard s={s} save={save} />
        <WatchCard />
      </div>
    </div>
  )
}
