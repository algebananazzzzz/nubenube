// Compact count formatting: 1234567 → "1.2M".
export function formatCount(n: number): string {
  if (n == null || !isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e12) return (n / 1e12).toFixed(1) + 'T'
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return `${Math.round(n)}`
}
