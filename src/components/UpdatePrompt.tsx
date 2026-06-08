// Renders update UX in-app (Wry can't show native confirm()/alert()): a modal
// when an update is found, and a transient notice for the manual "Check" button.

import { useEffect } from 'react'
import { useUpdater } from '../store/updater'
import { installPendingUpdate } from '../lib/updater'
import { Card, Btn } from './ui'

export function UpdatePrompt() {
  const pending = useUpdater((s) => s.pending)
  const notice = useUpdater((s) => s.notice)
  const installing = useUpdater((s) => s.installing)
  const setPending = useUpdater((s) => s.setPending)
  const setNotice = useUpdater((s) => s.setNotice)

  // auto-dismiss the notice toast
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4200)
    return () => clearTimeout(t)
  }, [notice, setNotice])

  return (
    <>
      {notice && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 22, transform: 'translateX(-50%)', zIndex: 60,
          display: 'flex', alignItems: 'center', gap: 12, maxWidth: '90vw',
          padding: '10px 14px', borderRadius: 'var(--r-md)', background: 'var(--surface-strong)',
          border: '1px solid var(--line)', boxShadow: 'var(--shadow-md)',
          animation: 'nn-from-tr .18s var(--ease-soft)',
        }}>
          <span style={{ fontSize: 13, color: 'var(--text)' }}>{notice}</span>
          <button onClick={() => setNotice(null)} style={{ flexShrink: 0, border: 'none', background: 'none', color: 'var(--faint)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      )}

      {pending && (
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
      )}
    </>
  )
}
