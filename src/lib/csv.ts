import type { MixRow } from './types.ts'

// The CSVs hold identifiers and numbers only, so no quoting is needed.
// days/YYYY/MM/YYYY-MM-DD.csv: hour,actor,method,messages  (hour as 2026-11-11T07:00Z)
// daily.csv:                    date,actor,method,messages  (date as 2026-11-11)

export const DAY_HEADER = 'hour,actor,method,messages'
export const DAILY_HEADER = 'date,actor,method,messages'

export function parseRows(text: string): MixRow[] {
  const rows: MixRow[] = []
  for (const line of text.split('\n').slice(1)) {
    if (!line) continue
    const [time, actor, method, messages] = line.split(',')
    // Both "2026-11-11T07:00Z" and "2026-11-11" parse as UTC.
    rows.push({ time: Date.parse(time.length === 10 ? `${time}T00:00Z` : time) / 1000, actor, method, messages: +messages })
  }
  return rows
}

function compare(a: MixRow, b: MixRow): number {
  return a.time - b.time || a.actor.localeCompare(b.actor) || a.method.localeCompare(b.method)
}

export function formatDayRows(rows: MixRow[]): string {
  const lines = [...rows].sort(compare).map((r) => `${new Date(r.time * 1000).toISOString().slice(0, 13)}:00Z,${r.actor},${r.method},${r.messages}`)
  return [DAY_HEADER, ...lines].join('\n') + '\n'
}

export function formatDailyRows(rows: MixRow[]): string {
  const lines = [...rows].sort(compare).map((r) => `${new Date(r.time * 1000).toISOString().slice(0, 10)},${r.actor},${r.method},${r.messages}`)
  return [DAILY_HEADER, ...lines].join('\n') + '\n'
}

export function dayPath(day: string): string {
  return `days/${day.slice(0, 4)}/${day.slice(5, 7)}/${day}.csv`
}
