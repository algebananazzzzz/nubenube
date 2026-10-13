// Renders the update modal in-app; Wry can't show native confirm()/alert().

import { useUpdater } from '../store/updater'
import { installPendingUpdate } from '../lib/updater'
import { Card, Btn } from './ui'

export function UpdatePrompt() {
  const pending = useUpdater((s) => s.pending)
  const installing = useUpdater((s) => s.installing)
  const setPending = useUpdater((s) => s.setPending)

  if (!pending) return null
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(2px)',
    }}>
      <Card pad={24} style={{ width: 380, maxWidth: '90vw', boxShadow: 'var(--shadow-lg)', animation: 'nn-from-tr .18s var(--ease-soft)' }}>
        <div className="nn-disp" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>Update available</div>
        <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.5, marginTop: 8 }}>
          NubeNube <b>{pending.version}</b> is ready — you're on {pending.current}.
        </div>
        {pending.notes && (
          <div style={{ fontSize: 12.5, color: 'var(--faint)', lineHeight: 1.5, marginTop: 8, maxHeight: 140, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{pending.notes}</div>
        )}
        <div style={{ display: 'flex', gap: 9, marginTop: 20 }}>
          <Btn variant="primary" full onClick={() => void installPendingUpdate()} disabled={installing}>
            {installing ? 'Installing…' : 'Install & restart'}
          </Btn>
          <Btn variant="soft" onClick={() => setPending(null)} disabled={installing}>Later</Btn>
        </div>
      </Card>
    </div>
  )
}
