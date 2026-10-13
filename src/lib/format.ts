// "1h 05m" / "12m"; negative values keep a leading minus.
export function fmtHM(secs: number): string {
  const neg = secs < 0
  secs = Math.abs(Math.round(secs))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return (neg ? '−' : '') + (h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`)
}

// digital countdown: M:SS or H:MM:SS
export function fmtCountdown(secs: number): string {
  secs = Math.max(0, Math.round(secs))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
