// Apps & Sites: classify apps and websites as Work / Neutral / Rest. Sites are
// tracked and blocked through the Chrome extension (src-tauri/browser-extension).

import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { useFocus } from '../store/focus'
import { useSettings } from '../store/settings'
import { say } from '../store/toast'
import { Avatar, Btn, Card, ClassSwitch, Dot, Pill, PrefRow, SegTabs, Section, ShieldIcon, Toggle } from '../components/ui'
import type { AppClass, Settings, TrackingHelper } from '../types'

const ORDER: Record<AppClass, number> = { rest: 0, neutral: 1, work: 2 }

const STATUS = { active: ['var(--success)', 'Active'], setup: ['var(--warning)', 'Needs setup'], off: ['var(--faint)', 'Off'] } as const

function WatchCard({ helper, extension, blockSites }: { helper: TrackingHelper; extension: boolean; blockSites: boolean }) {
  const ext = extension ? 'active' : 'setup'
  const rows = [
    { t: 'Apps', h: 'Frontmost app', d: 'Tracks whichever app is in front. No permissions needed.', status: helper === 'ok' ? 'active' : 'setup' },
    { t: 'Websites', h: 'Active browser tab', d: 'The Chrome extension reports the site in front. Unlisted sites count as the browser.', status: ext },
    { t: 'Blocking', h: 'Chrome extension', d: "Rest sites won't load in Chrome while a timer runs.", status: blockSites ? ext : 'off' },
  ] as const
  return (
    <Card pad={20}>
      <Section>How tracking works</Section>
      {rows.map((r) => (
        <div key={r.t} style={{ display: 'flex', gap: 12, padding: '11px 0', borderTop: '1px solid var(--line-faint)' }}>
          <span className="nn-eyebrow" style={{ width: 66, flexShrink: 0, paddingTop: 2 }}>{r.t}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>{r.h}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: STATUS[r.status][0] }}>
                <Dot tone={STATUS[r.status][0]} size={6} />{STATUS[r.status][1]}
              </span>
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

function BlockingCard({ s, save }: { s: Settings; save: (p: Partial<Settings>) => void }) {
  const listed = s.sites.filter((x) => x.class === 'rest').length
  return (
    <Card pad={20}>
      <Section>Site blocking</Section>
      <div className="nn-mono" style={{ fontSize: 11.5, color: 'var(--faint)', padding: '8px 10px', borderRadius: 'var(--r-sm)', background: 'var(--surface-faint)', border: '1px solid var(--line-faint)' }}>
        {listed} domains on the block list
      </div>
      <PrefRow title="Block during timers" desc="Rest sites and their subdomains won't load in Chrome during a focus session." last>
        <Toggle on={s.blockSites} onChange={(v) => save({ blockSites: v })} />
      </PrefRow>
    </Card>
  )
}

const CODE = { fontSize: 11.5, color: 'var(--ink)', background: 'var(--surface-faint)', border: '1px solid var(--line-faint)', borderRadius: 'var(--r-sm)', padding: '1px 5px', userSelect: 'text', wordBreak: 'break-all' } as const

function ExtensionNotice() {
  const extension = useFocus((st) => st.tick.extension)
  const [dir, setDir] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (extension) return null
  const install = async () => {
    setBusy(true)
    try {
      setDir(await api.installBrowserExtension())
    } catch (e) {
      say(`Couldn't set up the extension: ${e}`)
    } finally {
      setBusy(false)
    }
  }
  const copy = () => navigator.clipboard.writeText(dir ?? '').then(() => say('Folder path copied'), (e) => say(`Couldn't copy: ${e}`))
  return (
    <div style={{ padding: '10px 12px', marginBottom: 10, borderRadius: 'var(--r-md)', background: 'var(--warning-surface)', border: '1px solid var(--warning-border)', fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>
      {dir ? (
        <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li>In Chrome, open <code className="nn-mono" style={CODE}>chrome://extensions</code> and turn on Developer mode.</li>
          <li>
            Click Load unpacked and choose <code className="nn-mono" style={CODE}>{dir}</code>{' '}
            <Btn variant="line" size="sm" onClick={() => void copy()} style={{ marginLeft: 4 }}>Copy</Btn>
          </li>
          <li>This notice goes away once the extension connects.</li>
        </ol>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, textWrap: 'pretty' }}>To track and block websites, add the Nube Nube extension to Chrome.</div>
          <Btn variant="soft" size="sm" onClick={() => void install()} disabled={busy}>{busy ? 'Setting up…' : 'Set up'}</Btn>
        </div>
      )}
    </div>
  )
}

const INPUT = { fontSize: 12.5, color: 'var(--ink)', background: 'var(--surface-faint)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', padding: '8px 11px', outline: 'none', userSelect: 'text' } as const

function RemoveBtn({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={`Remove ${name}`} title="Remove" className="nn-ui"
      style={{ width: 26, height: 26, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', color: 'var(--faint)', cursor: 'pointer', borderRadius: 'var(--r-sm)', fontSize: 16, lineHeight: 1 }}>×</button>
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
  const hint: Record<AppClass, string> = { rest: s.blockSites ? 'blocked during focus sessions' : 'costs rest', neutral: 'neutral', work: 'counts as work' }
  const sorted = [...s.sites].sort((a, b) => ORDER[a.class] - ORDER[b.class] || a.domain.localeCompare(b.domain))
  return (
    <>
      <ExtensionNotice />
      <form onSubmit={submit} style={{ display: 'flex', gap: 8, marginBottom: err ? 6 : 10 }}>
        <input value={q} onChange={(e) => { setQ(e.target.value); setErr(null) }} placeholder="Add a domain, like tiktok.com" aria-invalid={!!err} className="nn-mono"
          style={{ ...INPUT, flex: 1, minWidth: 0, border: `1px solid ${err ? 'var(--critical)' : 'var(--line)'}` }} />
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
          <RemoveBtn name={x.domain} onClick={() => remove(x.domain)} />
        </div>
      ))}
    </>
  )
}

function HelperNotice({ helper, setHelper }: { helper: TrackingHelper; setHelper: (h: TrackingHelper) => void }) {
  const [busy, setBusy] = useState(false)
  if (helper === 'ok') return null
  const install = async () => {
    setBusy(true)
    try {
      setHelper(await api.installTrackingHelper())
    } catch (e) {
      say(`Install failed: ${e}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', marginBottom: 10, borderRadius: 'var(--r-md)', background: 'var(--warning-surface)', border: '1px solid var(--warning-border)' }}>
      <div style={{ flex: 1, fontSize: 12, color: 'var(--text)', lineHeight: 1.45, textWrap: 'pretty' }}>
        {helper === 'missing'
          ? 'To track apps on GNOME, NubeNube needs a small extension. Install it, then log out and back in.'
          : 'Installed. Log out and back in to start tracking apps.'}
      </div>
      {helper === 'missing' && <Btn variant="soft" size="sm" onClick={() => void install()} disabled={busy}>{busy ? 'Installing…' : 'Install'}</Btn>}
    </div>
  )
}

function AppsList({ s, save }: { s: Settings; save: (p: Partial<Settings>) => void }) {
  const [q, setQ] = useState('')
  const [options, setOptions] = useState<string[]>([])
  useEffect(() => {
    api.listApps().then(setOptions).catch((e) => say(`Couldn't load your apps: ${e}`))
  }, [])
  const apps = Object.keys(s.apps).sort((a, b) => a.localeCompare(b))
  const listed = new Set(apps.map((n) => n.toLowerCase()))
  const needle = q.trim().toLowerCase()
  const matches = needle ? options.filter((n) => n.toLowerCase().includes(needle) && !listed.has(n.toLowerCase())).slice(0, 6) : []
  const setClass = (n: string, c: AppClass) => save({ apps: { ...s.apps, [n]: c } })
  const add = (n: string) => {
    save({ apps: { [n]: 'rest', ...s.apps } })
    setQ('')
  }
  const remove = (n: string) => save({ apps: Object.fromEntries(Object.entries(s.apps).filter(([k]) => k !== n)) })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (matches[0]) add(matches[0])
  }
  const hint: Record<AppClass, string> = { rest: 'costs rest', neutral: 'neutral', work: 'counts as work' }
  return (
    <>
      <form onSubmit={submit} style={{ marginBottom: 10 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQ('') }} placeholder="Search your apps, like Spotify"
          style={{ ...INPUT, width: '100%', boxSizing: 'border-box' }} />
        {needle && (
          <div style={{ marginTop: 6, border: '1px solid var(--line-faint)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
            {matches.length
              ? matches.map((n, i) => (
                <button key={n} type="button" onClick={() => add(n)} className="nn-ui"
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 10px', border: 'none', borderTop: i ? '1px solid var(--line-faint)' : 'none', background: i ? 'transparent' : 'var(--surface-faint)', color: 'var(--ink)', fontSize: 12.5, fontWeight: 600, textAlign: 'left', cursor: 'pointer' }}>
                  <Avatar name={n} size={22} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--faint)' }}>Add</span>
                </button>
              ))
              : <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--faint)' }}>No app matches “{q.trim()}”.</div>}
          </div>
        )}
      </form>
      {!apps.length && <div style={{ fontSize: 12, color: 'var(--faint)', lineHeight: 1.45 }}>Add the apps you want to count as rest or work. Apps not on this list are neutral.</div>}
      {apps.map((n, i) => (
        <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 2px', borderBottom: i === apps.length - 1 ? 'none' : '1px solid var(--line-faint)' }}>
          <Avatar name={n} size={28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</div>
            <div style={{ fontSize: 11.5, color: s.apps[n] === 'rest' ? 'var(--critical)' : 'var(--faint)', marginTop: 2 }}>{hint[s.apps[n]]}</div>
          </div>
          <ClassSwitch value={s.apps[n]} onChange={(v) => setClass(n, v)} />
          <RemoveBtn name={n} onClick={() => remove(n)} />
        </div>
      ))}
    </>
  )
}

export function Sources() {
  const s = useSettings((st) => st.settings)
  const saveAsync = useSettings((st) => st.save)
  const [tab, setTab] = useState<'sites' | 'apps'>('apps')
  const [helper, setHelper] = useState<TrackingHelper>('ok')
  const extension = useFocus((st) => st.tick.extension)
  useEffect(() => {
    api.trackingHelper().then(setHelper).catch((e) => say(`Couldn't check app tracking: ${e}`))
  }, [])
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
        {tab === 'sites' ? <SitesList s={s} save={save} /> : <><HelperNotice helper={helper} setHelper={setHelper} /><AppsList s={s} save={save} /></>}
      </Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <BlockingCard s={s} save={save} />
        <WatchCard helper={helper} extension={extension} blockSites={s.blockSites} />
      </div>
    </div>
  )
}
