// Generic formatters (durations, compact counts, paths).

export function formatDuration(secs: number): string {
  if (!secs || secs < 0) return '0m'
  const s = Math.round(secs)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${sec}s`
}

/** Compact token / message counts: 1234567 -> "1.2M". */
export function formatCount(n: number): string {
  if (n == null || !isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e12) return (n / 1e12).toFixed(1) + 'T'
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return `${Math.round(n)}`
}

export function formatPct(x: number, digits = 0): string {
  if (!isFinite(x)) return '0%'
  return `${(x * 100).toFixed(digits)}%`
}

/** Trailing path components, e.g. /Users/me/code/app -> "code/app". */
export function shortPath(p: string, n = 2): string {
  if (!p) return ''
  const parts = p.replace(/\/+$/, '').split('/').filter(Boolean)
  return parts.slice(-n).join('/') || '/'
}

export function relativeTime(iso?: string | null): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (isNaN(then)) return 'never'
  const diff = Date.now() - then
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

/** Title-case a slug-ish project name. */
export function prettyName(s: string): string {
  return s
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}
