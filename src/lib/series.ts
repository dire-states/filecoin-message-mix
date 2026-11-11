import type { MixIndex, MixRow } from './types.ts'

export const HOUR = 3600
export const DAY = 86400
// Ranges up to this span plot hourly from the day files; longer ones plot daily from daily.csv.
export const HOURLY_MAX_SPAN = 7 * DAY

export type Preset = '24h' | '7d' | '30d' | 'all'
export const PRESETS: Record<Exclude<Preset, 'all'>, number> = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY }

export interface Range {
  from: number
  to: number
}

export const methodKey = (r: { actor: string; method: string }) => `${r.actor}.${r.method}`

// Unix seconds of a height.
export function heightTime(index: MixIndex, height: number): number {
  return index.genesisTimestamp + height * 30
}

// The covered time span: from the first counted height to the end of the last.
export function coverage(index: MixIndex): Range {
  return { from: heightTime(index, index.fromHeight), to: heightTime(index, index.toHeight + 1) }
}

export function bucketOf(range: Range): number {
  return range.to - range.from <= HOURLY_MAX_SPAN ? HOUR : DAY
}

// UTC days a range touches, as YYYY-MM-DD.
export function daysIn(range: Range): string[] {
  const out: string[] = []
  for (let t = Math.floor(range.from / DAY) * DAY; t < range.to; t += DAY) out.push(new Date(t * 1000).toISOString().slice(0, 10))
  return out
}

// Bucket starts covering a range, aligned to the bucket size.
export function bucketTimes(range: Range, bucket: number): number[] {
  const out: number[] = []
  for (let t = Math.floor(range.from / bucket) * bucket; t < range.to; t += bucket) out.push(t)
  return out
}

// Buckets with no data at all (before coverage, after it, or inside a gap) plot as breaks, not zeros.
export function missing(index: MixIndex, times: number[], bucket: number): boolean[] {
  const cov = coverage(index)
  const gaps = index.gaps.map(([a, b]) => [heightTime(index, a), heightTime(index, b + 1)])
  return times.map((t) => t + bucket <= cov.from || t >= cov.to || gaps.some(([a, b]) => t >= a && t + bucket <= b))
}

export interface Series {
  id: string
  label: string
  color: string
  values: (number | null)[]
  // For a folded "other" series: the entities it combines.
  members?: string[]
}

// Sums rows into one value array per group, aligned to `times`.
export function sumBy(
  rows: MixRow[],
  times: number[],
  bucket: number,
  gone: boolean[],
  group: (r: MixRow) => string | null,
): Map<string, (number | null)[]> {
  const pos = new Map(times.map((t, i) => [t, i]))
  const out = new Map<string, (number | null)[]>()
  for (const r of rows) {
    const g = group(r)
    if (g === null) continue
    const i = pos.get(Math.floor(r.time / bucket) * bucket)
    if (i === undefined) continue
    let arr = out.get(g)
    if (!arr) {
      arr = times.map((_, j) => (gone[j] ? null : 0))
      out.set(g, arr)
    }
    arr[i] = (arr[i] ?? 0) + r.messages
  }
  return out
}

export function inRange(rows: MixRow[], range: Range): MixRow[] {
  return rows.filter((r) => r.time >= range.from && r.time < range.to)
}

export function total(values: (number | null)[]): number {
  return values.reduce<number>((a, v) => a + (v ?? 0), 0)
}
