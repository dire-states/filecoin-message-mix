import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import BottomPane from './components/BottomPane'
import Header from './components/Header'
import MainPane from './components/MainPane'
import MethodList from './components/MethodList'
import { OTHER_COLOR, SERIES_SLOTS, seriesColor, useDarkMode } from './lib/colors'
import { dayPath, parseRows } from './lib/csv'
import { NETWORKS, netFromUrl, type NetKey } from './lib/networks'
import {
  bucketOf,
  bucketTimes,
  coverage,
  DAY,
  daysIn,
  HOUR,
  inRange,
  methodKey,
  missing,
  PRESETS,
  sumBy,
  type Range,
  type Series,
} from './lib/series'
import type { MixIndex, MixRow } from './lib/types'

class NotFound extends Error {}

async function get(base: string, path: string): Promise<Response> {
  const res = await fetch(base + path)
  if (res.status === 404) throw new NotFound(path)
  if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`)
  return res
}

// Snaps a range to whole buckets of the granularity it will be plotted at.
function snap(r: Range): Range {
  const bucket = bucketOf(r)
  return { from: Math.floor(r.from / bucket) * bucket, to: Math.ceil(r.to / bucket) * bucket }
}

// Range, selection and network live in the URL so a view can be shared.
function readUrl(): { range: Range | null; selected: string[] } {
  const p = new URLSearchParams(window.location.search)
  const from = Number(p.get('from'))
  const to = Number(p.get('to'))
  return {
    range: from && to > from ? { from, to } : null,
    selected: (p.get('m') ?? '').split(',').filter(Boolean),
  }
}

function writeUrl(net: NetKey, range: Range | null, selected: string[]) {
  const url = new URL(window.location.href)
  const set = (k: string, v: string | null) => (v ? url.searchParams.set(k, v) : url.searchParams.delete(k))
  set('net', net === 'calibnet' ? null : net)
  set('from', range ? String(range.from) : null)
  set('to', range ? String(range.to) : null)
  set('m', selected.length ? selected.join(',') : null)
  window.history.replaceState(null, '', url)
}

function App() {
  const [net, setNet] = useState<NetKey>(netFromUrl)
  const switchNet = (next: NetKey) => {
    writeUrl(next, null, [])
    setNet(next)
  }
  return <Dashboard key={net} net={net} onNet={switchNet} />
}

function Dashboard({ net, onNet }: { net: NetKey; onNet: (net: NetKey) => void }) {
  const base = NETWORKS[net].base
  const dark = useDarkMode()
  const [initial] = useState(readUrl)
  const [index, setIndex] = useState<MixIndex | null>(null)
  const [daily, setDaily] = useState<MixRow[] | null>(null)
  const [dayRows, setDayRows] = useState<Map<string, MixRow[]>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [rangeState, setRange] = useState<Range | null>(initial.range)
  const [selected, setSelected] = useState<string[]>(initial.selected)
  // Line color slot per selected method, stable while it stays selected (as in sector-spiegel).
  const [slots, setSlots] = useState<Map<string, number>>(() => new Map(initial.selected.map((k, i) => [k, i])))

  useEffect(() => {
    get(base, 'index.json')
      .then((r) => r.json() as Promise<MixIndex>)
      .then(setIndex)
      .catch((err: Error) => setError(err instanceof NotFound ? `No ${NETWORKS[net].label} data yet.` : err.message))
    get(base, 'daily.csv')
      .then((r) => r.text())
      .then((t) => setDaily(parseRows(t)))
      .catch((err: Error) => !(err instanceof NotFound) && setError(err.message))
  }, [base, net])

  // Default view: the last 7 days of data, or everything when there's less.
  // A range that misses the data entirely (e.g. an old shared link) falls back to the default too.
  const range = useMemo(() => {
    if (!index) return rangeState
    const cov = coverage(index)
    if (rangeState && rangeState.to > cov.from && rangeState.from < cov.to) return rangeState
    return snap({ from: Math.max(cov.from, cov.to - PRESETS['7d']), to: cov.to })
  }, [rangeState, index])

  const setView = useCallback(
    (r: Range | null, sel: string[] = selected) => {
      const next = r ? snap(r) : null
      setRange(next)
      writeUrl(net, next, sel)
    },
    [net, selected],
  )

  function select(keys: string[]) {
    const next = new Map<string, number>()
    for (const k of keys) if (slots.has(k)) next.set(k, slots.get(k)!)
    const used = new Set(next.values())
    for (const k of keys) {
      if (next.has(k)) continue
      let slot = 0
      while (used.has(slot)) slot++
      next.set(k, slot)
      used.add(slot)
    }
    setSelected(keys)
    setSlots(next)
    writeUrl(net, rangeState, keys)
  }

  function clickMethod(e: React.MouseEvent, key: string) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) select(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key])
    else select(selected.length === 1 && selected[0] === key ? [] : [key])
  }

  const bucket = range ? bucketOf(range) : HOUR

  // Hourly views read the day files they cover.
  useEffect(() => {
    if (!index || !range || bucket !== HOUR) return
    const need = daysIn(range).filter((d) => index.days.includes(d) && !dayRows.has(d))
    if (need.length === 0) return
    let cancelled = false
    Promise.all(need.map((d) => get(base, dayPath(d)).then((r) => r.text()).then((t) => [d, parseRows(t)] as const)))
      .then((loaded) => {
        if (cancelled) return
        setDayRows((prev) => new Map([...prev, ...loaded]))
      })
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [base, index, range, bucket, dayRows])

  // Rows inside the range at its granularity; null while day files are still loading.
  const rows = useMemo(() => {
    if (!index || !range || !daily) return null
    if (bucket === DAY) return inRange(daily, range)
    const days = daysIn(range).filter((d) => index.days.includes(d))
    if (days.some((d) => !dayRows.has(d))) return null
    return inRange(days.flatMap((d) => dayRows.get(d)!), range)
  }, [index, range, daily, bucket, dayRows])

  // Actor colors follow whole-history rank, so they never change with the range.
  const actorSlots = useMemo(() => {
    const totals = new Map<string, number>()
    for (const m of index?.methods ?? []) totals.set(m.actor, (totals.get(m.actor) ?? 0) + m.messages)
    return new Map([...totals].sort((a, b) => b[1] - a[1]).map(([a], i) => [a, i]))
  }, [index])
  const actorColor = useCallback(
    (actor: string) => {
      const slot = actorSlots.get(actor) ?? SERIES_SLOTS
      return slot < SERIES_SLOTS ? seriesColor(slot, dark) : OTHER_COLOR
    },
    [actorSlots, dark],
  )

  const counts = useMemo(() => {
    const out = new Map<string, number>()
    for (const r of rows ?? []) out.set(methodKey(r), (out.get(methodKey(r)) ?? 0) + r.messages)
    return out
  }, [rows])

  const times = useMemo(() => (range ? bucketTimes(range, bucket) : []), [range, bucket])
  const gone = useMemo(() => (index ? missing(index, times, bucket) : []), [index, times, bucket])

  // Main chart: one line per selected method, or the mix stacked by actor type.
  const series = useMemo<Series[]>(() => {
    if (!rows) return []
    if (selected.length) {
      const sums = sumBy(rows, times, bucket, gone, (r) => (selected.includes(methodKey(r)) ? methodKey(r) : null))
      return selected.map((k) => ({
        id: k,
        label: k,
        color: seriesColor(slots.get(k) ?? SERIES_SLOTS, dark),
        values: sums.get(k) ?? times.map((_, i) => (gone[i] ? null : 0)),
      }))
    }
    const folded = new Set<string>()
    const sums = sumBy(rows, times, bucket, gone, (r) => {
      if ((actorSlots.get(r.actor) ?? SERIES_SLOTS) < SERIES_SLOTS) return r.actor
      folded.add(r.actor)
      return 'other'
    })
    const out: Series[] = [...sums.keys()]
      .filter((a) => a !== 'other')
      .sort((a, b) => actorSlots.get(a)! - actorSlots.get(b)!)
      .map((a) => ({ id: a, label: a, color: actorColor(a), values: sums.get(a)! }))
    if (sums.has('other')) out.push({ id: 'other', label: 'other', color: OTHER_COLOR, values: sums.get('other')!, members: [...folded] })
    return out
  }, [rows, selected, slots, times, bucket, gone, actorSlots, actorColor, dark])

  const rangeTotal = useMemo(() => [...counts.values()].reduce((a, b) => a + b, 0), [counts])

  return (
    <div className="app">
      <Header index={index} net={net} onNet={onNet} rangeTotal={rows ? rangeTotal : null} />
      <MethodList
        index={index}
        counts={counts}
        loading={!rows && !error}
        selected={selected}
        slots={slots}
        dark={dark}
        actorColor={actorColor}
        onMethodClick={clickMethod}
        onClear={() => select([])}
        error={error}
      />
      <MainPane
        index={index}
        range={range}
        bucket={bucket}
        times={times}
        series={series}
        selected={selected.length > 0}
        rangeTotal={rangeTotal}
        loading={!rows && !error}
        onRange={(r) => setView(r)}
        onReset={() => setView(null)}
      />
      <BottomPane index={index} daily={daily} actorColor={actorColor} actorSlots={actorSlots} onDay={(t) => setView({ from: t, to: t + DAY })} range={range} />
    </div>
  )
}

export default App
