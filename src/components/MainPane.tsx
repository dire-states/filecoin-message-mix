import { formatCount, formatDate, formatTime } from '../lib/format'
import { coverage, DAY, PRESETS, total, type Preset, type Range, type Series } from '../lib/series'
import type { MixIndex } from '../lib/types'
import { LineKey } from './ChartLegend'
import TimeChart from './TimeChart'

interface Props {
  index: MixIndex | null
  range: Range | null
  bucket: number
  times: number[]
  series: Series[]
  // Lines for selected methods instead of the stacked mix.
  selected: boolean
  rangeTotal: number
  loading: boolean
  onRange: (r: Range) => void
  onReset: () => void
}

function MainPane({ index, range, bucket, times, series, selected, rangeTotal, loading, onRange, onReset }: Props) {
  if (!index || !range) return <main className="main" />
  const cov = coverage(index)
  const span = range.to - range.from
  const days = span / DAY

  function preset(p: Preset) {
    if (p === 'all') return onRange(cov)
    onRange({ from: cov.to - PRESETS[p], to: cov.to })
  }
  const active = (Object.keys(PRESETS) as (keyof typeof PRESETS)[]).find(
    (p) => span === PRESETS[p] && range.to >= cov.to && range.to - cov.to < (bucket === DAY ? DAY : 3600),
  )
  const step = (dir: -1 | 1) => onRange({ from: range.from + dir * span, to: range.to + dir * span })
  const label = (t: number) => (bucket >= DAY ? formatDate(t) : formatTime(t))

  return (
    <main className="main">
      <div className="range-bar">
        <div className="seg" role="group" aria-label="Range">
          {(['24h', '7d', '30d', 'all'] as Preset[]).map((p) => (
            <button key={p} className={active === p ? 'on' : ''} onClick={() => preset(p)}>
              {p}
            </button>
          ))}
        </div>
        <button className="step" onClick={() => step(-1)} disabled={range.from <= cov.from} aria-label="Earlier">
          ◀
        </button>
        <button className="step" onClick={() => step(1)} disabled={range.to >= cov.to} aria-label="Later">
          ▶
        </button>
        <span className="range-label">
          {label(range.from)} → {label(range.to)} UTC · {bucket >= DAY ? 'daily' : 'hourly'}
        </span>
        <span className="muted range-hint">drag on the chart to zoom, double-click to reset</span>
      </div>

      <div className="main-chart">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <TimeChart
            times={times}
            bucket={bucket}
            series={series}
            kind={selected ? 'lines' : bucket >= DAY ? 'bars' : 'stack'}
            onZoom={(from, to) => onRange({ from, to })}
            onReset={onReset}
          />
        )}
      </div>

      <table className="mix-table">
        <thead>
          <tr>
            <th>{selected ? 'Method' : 'Actor type'}</th>
            <th>Messages</th>
            <th>Share</th>
            <th>Per day</th>
          </tr>
        </thead>
        <tbody>
          {[...series]
            .map((s) => ({ s, n: total(s.values) }))
            .sort((a, b) => b.n - a.n)
            .map(({ s, n }) => (
              <tr key={s.id}>
                <td>
                  <LineKey color={s.color} />
                  {s.label}
                  {s.members && <span className="muted"> ({s.members.join(', ')})</span>}
                </td>
                <td>{formatCount(n)}</td>
                <td>{rangeTotal ? `${((n / rangeTotal) * 100).toFixed(1)}%` : '–'}</td>
                <td>{formatCount(Math.round(n / Math.max(days, 1 / 24)))}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </main>
  )
}

export default MainPane
