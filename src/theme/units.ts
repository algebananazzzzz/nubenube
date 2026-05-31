import type { TokenBreakdown } from '../types'

// ===========================================================================
//  Water model
// ---------------------------------------------------------------------------
//  "Water" is a REAL volume derived from token counts. Reading (input + cached
//  context) is ~10x cheaper than writing (generated output). Rates are in
//  mL per token, grounded — as order-of-magnitude estimates, NOT verbatim
//  figures — in the AI water-footprint literature cited below. Tunable in
//  Settings; this is the single source of truth for the conversion.
// ===========================================================================

export type WaterRates = { read: number; write: number }

export const DEFAULT_WATER_RATES: WaterRates = {
  read: 0.0002, // mL/token — input, cache_read, cache_creation. lit. range ~0.0001–0.0003
  write: 0.0015, // mL/token — output (generation). lit. range ~0.001–0.002
}

/** Derive water volume (mL) from a deduped token breakdown. */
export function waterMlFromTokens(t: TokenBreakdown, rates: WaterRates = DEFAULT_WATER_RATES): number {
  const read = (t.input || 0) + (t.cacheRead || 0) + (t.cacheCreate || 0)
  const write = t.output || 0
  return rates.read * read + rates.write * write
}

export const WATER_CITATIONS = [
  {
    authors: 'Li, Yang, Islam & Ren',
    title: 'Making AI Less "Thirsty": Uncovering and Addressing the Secret Water Footprint of AI Models',
    venue: 'Communications of the ACM, 2025',
    arxiv: '2304.03271',
    url: 'https://arxiv.org/abs/2304.03271',
    note: 'Water-footprint methodology; ≈500 mL of water per 10–50 medium responses.',
  },
  {
    authors: 'Jegham, Abdelatti, Koh, Elmoubarki & Hendawi',
    title: 'How Hungry is AI? Benchmarking Energy, Water, and Carbon Footprint of LLM Inference',
    venue: 'arXiv, 2025',
    arxiv: '2505.09598',
    url: 'https://arxiv.org/abs/2505.09598',
    note: 'Per-query water by input/output size (e.g. GPT-4o ≈3–4 mL short, ≈9–10 mL medium): output ≫ input.',
  },
] as const

// ===========================================================================
//  Display helpers
// ===========================================================================

/** Precise, honest volume string (mL / L) for stats. */
export function formatWater(ml: number): string {
  if (!isFinite(ml) || ml <= 0) return '0 mL'
  if (ml < 1000) return `${ml < 10 ? ml.toFixed(2) : Math.round(ml)} mL`
  const liters = ml / 1000
  if (liters < 10) return `${liters.toFixed(2)} L`
  if (liters < 1000) return `${liters.toFixed(1)} L`
  return `${Math.round(liters).toLocaleString()} L`
}

type WaterUnit = { name: string; plural: string; ml: number }
const FUN_LADDER: WaterUnit[] = [
  { name: 'eyedropper', plural: 'eyedroppers', ml: 0.05 },
  { name: 'teaspoon', plural: 'teaspoons', ml: 5 },
  { name: 'shot glass', plural: 'shot glasses', ml: 44 },
  { name: 'glass of water', plural: 'glasses of water', ml: 250 },
  { name: 'water bottle', plural: 'water bottles', ml: 500 },
  { name: 'watering can', plural: 'watering cans', ml: 9_000 },
  { name: 'bathtub', plural: 'bathtubs', ml: 150_000 },
  { name: 'hot tub', plural: 'hot tubs', ml: 1_500_000 },
  { name: 'backyard pool', plural: 'backyard pools', ml: 50_000_000 },
  { name: 'Olympic pool', plural: 'Olympic pools', ml: 2_500_000_000 },
  { name: 'small lake', plural: 'small lakes', ml: 1_000_000_000_000 },
]

/** Comical real-world comparison for celebratory views (Insights hero). */
export function funWater(ml: number): { count: string; unit: string } {
  if (!isFinite(ml) || ml <= 0) return { count: '0', unit: 'drops' }
  let chosen = FUN_LADDER[0]
  for (const u of FUN_LADDER) {
    if (ml / u.ml >= 1) chosen = u
    else break
  }
  const n = ml / chosen.ml
  const count = n >= 100 ? Math.round(n).toLocaleString() : n >= 10 ? n.toFixed(0) : n.toFixed(1)
  const isOne = Math.abs(parseFloat(count.replace(/,/g, '')) - 1) < 1e-9
  return { count, unit: isOne ? chosen.name : chosen.plural }
}
