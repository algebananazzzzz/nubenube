// ProjectDetail — one project's token composition, filterable by
// day / week / month / all-time. Slim by design. From get_project_detail.

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { usePrefs } from '../store/prefs'
import { hueSwatch } from '../lib/clay'
import { formatCount } from '../lib/format'
import type { ProjectDetail as PD, RangeKey } from '../types'
import { Card, Pill, Btn, Eyebrow, Donut, SegTabs } from '../components/ui'

const RANGE_LABEL: Record<RangeKey, string> = { today: 'today', week: 'this week', month: 'this month', all: 'all-time' }

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const dark = usePrefs((s) => s.theme) === 'dark'
  const [range, setRange] = useState<RangeKey>('all')
  const [data, setData] = useState<PD | null>(null)

  useEffect(() => {
    if (!id) return
    let alive = true
    void api.getProjectDetail(decodeURIComponent(id), range).then((r) => { if (alive) setData(r.data) })
    return () => { alive = false }
  }, [id, range])

  const back = (
    <Btn variant="ghost" size="sm" onClick={() => navigate('/insights')} style={{ gap: 6 }}>
      <span style={{ fontSize: 14, lineHeight: 1 }}>←</span> Insights
    </Btn>
  )

  if (!data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {back}
        <div style={{ color: 'var(--faint)', fontSize: 13 }}>Loading…</div>
      </div>
    )
  }

  const T = data.tokens
  const toks = [
    { label: 'cache read', value: T.cacheRead, color: 'var(--accent)' },
    { label: 'cache write', value: T.cacheCreate, color: '#a5b4fc' },
    { label: 'output', value: T.output, color: '#c7d2fe' },
    { label: 'input', value: T.input, color: '#4f46e5' },
  ]
  const totalTok = toks.reduce((a, t) => a + t.value, 0) || 1
  const litres = Math.round(data.waterMl / 1000)
  const rl = RANGE_LABEL[range]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        {back}
        <SegTabs<RangeKey>
          tabs={[{ key: 'today', label: 'Today' }, { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }, { key: 'all', label: 'All-time' }]}
          value={range} onChange={setRange} size="sm" />
      </div>

      {/* identity */}
      <Card pad={20}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: hueSwatch(data.colorHue, dark), flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="nn-disp" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.name}</div>
            <div className="nn-mono" style={{ fontSize: 12, color: 'var(--faint)', marginTop: 2 }}>{data.rootPath}</div>
          </div>
          <Pill kind="neutral" style={{ fontSize: 12 }}>{litres.toLocaleString()} L · {formatCount(totalTok)} tokens</Pill>
        </div>
      </Card>

      {/* token composition */}
      <Card pad={20}>
        <Eyebrow style={{ fontSize: 10.5 }}>Token composition · {rl}</Eyebrow>
        <div style={{ fontSize: 12.5, color: 'var(--faint)', margin: '6px 0 16px', lineHeight: 1.5 }}>Where this project's tokens went — cache reads dominate as Claude re-reads your code.</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <Donut segments={toks.map((t) => ({ value: t.value, color: t.color }))} label={formatCount(totalTok)} sub="tokens" size={128} thickness={16} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minWidth: 0 }}>
            {toks.map((t) => (
              <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: t.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 500, color: 'var(--ink)', flex: 1 }}>{t.label}</span>
                <span className="nn-num" style={{ color: 'var(--text)', fontWeight: 600 }}>{formatCount(t.value)}</span>
                <span className="nn-num" style={{ color: 'var(--faint)', fontWeight: 500, width: 34, textAlign: 'right' }}>{Math.round((t.value / totalTok) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}
