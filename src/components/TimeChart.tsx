import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useDarkMode } from '../lib/colors'
import { formatCompact, formatCount, formatDate, formatTime } from '../lib/format'
import { DAY, total, type Series } from '../lib/series'
import ChartLegend, { LineKey } from './ChartLegend'

// lines: one line per series. stack: stacked areas. bars: stacked bars. share: 100% stacked bars.
export type ChartKind = 'lines' | 'stack' | 'bars' | 'share'

interface Props {
  times: number[]
  // Bucket width in seconds; also sets the time labels (hours vs days).
  bucket: number
  series: Series[]
  kind: ChartKind
  legend?: boolean
  // Drag-select on the x axis: the selected span, snapped to buckets.
  onZoom?: (from: number, to: number) => void
  // Double-click on the plot.
  onReset?: () => void
  // Click on a bucket.
  onPick?: (time: number) => void
  // A span to shade, e.g. the range the main chart shows.
  highlight?: { from: number; to: number } | null
}

const FONT = '10px system-ui, -apple-system, "Segoe UI", sans-serif'

function niceStep(max: number, count: number): number {
  const raw = Math.max(1e-9, max / count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
}

function TimeChart({ times, bucket, series, kind, legend = true, onZoom, onReset, onPick, highlight }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const dark = useDarkMode()
  // Hovered bucket, with the plot area's viewport rect for placing the readout. It belongs to one
  // `times` array; after a range change the old index means nothing.
  const [hover, setHover] = useState<{ idx: number; left: number; rect: DOMRect; times: number[] } | null>(null)
  // Latest callbacks, read by the uPlot hooks without rebuilding the chart.
  const handlers = useRef({ onZoom, onReset, onPick })
  useEffect(() => {
    handlers.current = { onZoom, onReset, onPick }
  })

  const stacked = kind !== 'lines'
  const share = kind === 'share'

  useEffect(() => {
    const el = wrapRef.current
    if (!el || times.length === 0) return

    // Stacked kinds plot running sums; the topmost layer is drawn first so lower ones paint over it.
    let plotted = series.map((s) => s.values)
    if (stacked) {
      const sums = times.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0))
      const acc = times.map(() => 0)
      plotted = series.map((s) =>
        s.values.map((v, i) => {
          if (v === null) return null
          acc[i] += v
          return share ? (sums[i] ? (acc[i] / sums[i]) * 100 : 0) : acc[i]
        }),
      )
    }
    const order = stacked ? series.map((_, i) => series.length - 1 - i) : series.map((_, i) => i)
    // Plot each bucket at its center so bars and step lines sit inside their bucket.
    const xs = times.map((t) => t + bucket / 2)
    const data: uPlot.AlignedData = [xs, ...order.map((i) => plotted[i])]

    const css = getComputedStyle(el)
    const muted = css.getPropertyValue('--muted').trim()
    const grid = css.getPropertyValue('--grid').trim()
    const axis = css.getPropertyValue('--axis').trim()
    // The surface the chart sits on, for fading parts of it.
    let surface = 'transparent'
    for (let n: HTMLElement | null = el; n && /transparent|rgba\(0, 0, 0, 0\)/.test(surface); n = n.parentElement) {
      surface = getComputedStyle(n).backgroundColor
    }
    const fade = `color-mix(in srgb, ${surface} 70%, transparent)`
    const bars = uPlot.paths.bars!({ size: [0.85, Infinity], gap: 1 })
    const linear = uPlot.paths.linear!()

    const opts: uPlot.Options = {
      width: Math.max(1, el.clientWidth),
      height: Math.max(1, el.clientHeight),
      legend: { show: false },
      cursor: {
        x: true,
        y: false,
        points: { show: false },
        drag: { x: !!handlers.current.onZoom, y: false, setScale: false },
      },
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1e3), 'Etc/UTC'),
      scales: {
        x: { time: true, range: [times[0], times[times.length - 1] + bucket] },
        y: { range: (_u, _min, max) => [0, share ? 100 : Math.max(1, max)] },
      },
      axes: [
        {
          stroke: muted,
          font: FONT,
          size: 20,
          space: 64,
          // Daily charts tick on day boundaries only, every n days so the labels fit.
          splits:
            bucket >= DAY
              ? (u) => {
                  const every = Math.max(1, Math.ceil((times.length * 64) / Math.max(1, u.bbox.width / uPlot.pxRatio)))
                  return times.filter((_, i) => i % every === 0)
                }
              : undefined,
          values: (_u, splits, _ax, _space, incr) =>
            splits.map((s) => {
              const iso = new Date(s * 1e3).toISOString()
              return bucket >= DAY || incr >= DAY ? iso.slice(5, 10) : iso.slice(11, 16) === '00:00' ? iso.slice(5, 10) : iso.slice(11, 16)
            }),
          grid: { show: false },
          ticks: { stroke: axis, size: 4 },
        },
        {
          stroke: muted,
          font: FONT,
          size: 40,
          gap: 4,
          splits: (_u, _ax, _min, max) => {
            const step = niceStep(max, 3)
            const out: number[] = []
            for (let v = 0; v <= max + 1e-9; v += step) out.push(v)
            return out
          },
          values: (_u, splits) => splits.map((v) => (share ? `${Math.round(v)}%` : formatCompact(v))),
          grid: { stroke: grid, width: 1 },
          ticks: { show: false },
        },
      ],
      series: [
        {},
        ...order.map((i) => {
          const s = series[i]
          if (kind === 'lines') return { label: s.label, stroke: s.color, width: 2, paths: linear, points: { show: false } }
          if (kind === 'stack') return { label: s.label, stroke: s.color, fill: s.color, width: 1, paths: linear, points: { show: false } }
          return { label: s.label, fill: s.color, stroke: s.color, width: 0, paths: bars, points: { show: false } }
        }),
      ],
      hooks: {
        // Fade everything outside the highlighted span, so the span keeps its full colors.
        draw: [
          (u) => {
            if (!highlight) return
            const { left, top, width, height } = u.bbox
            const x0 = Math.min(left + width, Math.max(left, u.valToPos(highlight.from, 'x', true)))
            const x1 = Math.min(left + width, Math.max(left, u.valToPos(highlight.to, 'x', true)))
            u.ctx.save()
            u.ctx.fillStyle = fade
            u.ctx.fillRect(left, top, x0 - left, height)
            u.ctx.fillRect(x1, top, left + width - x1, height)
            u.ctx.restore()
          },
        ],
        setCursor: [
          (u) => {
            const idx = u.cursor.idx
            setHover(
              idx === null || idx === undefined || (u.cursor.left ?? -1) < 0
                ? null
                : { idx, left: u.cursor.left!, rect: u.over.getBoundingClientRect(), times },
            )
          },
        ],
        setSelect: [
          (u) => {
            if (u.select.width < 4) return
            const from = Math.floor(u.posToVal(u.select.left, 'x') / bucket) * bucket
            const to = Math.ceil(u.posToVal(u.select.left + u.select.width, 'x') / bucket) * bucket
            u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false)
            if (to > from) handlers.current.onZoom?.(from, to)
          },
        ],
      },
      padding: [8, 12, 0, 0],
    }

    const u = new uPlot(opts, data, el)
    const dbl = () => handlers.current.onReset?.()
    const click = () => {
      const idx = u.cursor.idx
      if (idx !== null && idx !== undefined && u.select.width === 0) handlers.current.onPick?.(times[idx])
    }
    u.over.addEventListener('dblclick', dbl)
    u.over.addEventListener('click', click)
    const ro = new ResizeObserver(() => u.setSize({ width: Math.max(1, el.clientWidth), height: Math.max(1, el.clientHeight) }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      u.destroy()
    }
  }, [times, bucket, series, kind, stacked, share, dark, highlight])

  // Hover readout: raw values of every series at the hovered bucket, largest first.
  let tip = null
  if (hover && hover.times === times) {
    const r = hover.rect
    const x = r.left + hover.left
    const style: React.CSSProperties = x > r.left + r.width / 2 ? { right: window.innerWidth - x + 10 } : { left: x + 10 }
    if (r.top > window.innerHeight / 2) style.bottom = window.innerHeight - r.bottom
    else style.top = r.top
    const t = times[hover.idx]
    const rows = series
      .map((s) => ({ s, v: s.values[hover.idx] }))
      .filter((x) => x.v !== null && x.v !== 0)
      .sort((a, b) => (b.v ?? 0) - (a.v ?? 0))
    const sum = rows.reduce((a, x) => a + (x.v ?? 0), 0)
    const gone = series.every((s) => s.values[hover.idx] === null)
    tip = (
      <div className="chart-tip" style={style}>
        <div className="muted">
          {bucket >= DAY ? formatDate(t) : `${formatTime(t)}–${formatTime(t + bucket).slice(11)}`} UTC
        </div>
        {gone ? (
          <div className="muted">no data</div>
        ) : (
          <>
            {series.length > 1 && (
              <div className="chart-tip-row">
                <strong>{formatCount(sum)}</strong>
                <span className="muted">messages</span>
              </div>
            )}
            {rows.slice(0, 12).map(({ s, v }) => (
              <div key={s.id} className="chart-tip-row">
                <LineKey color={s.color} />
                <strong>{formatCount(v!)}</strong>
                <span className="muted">
                  {series.length > 1 && sum ? `${Math.round(((v ?? 0) / sum) * 100)}% · ` : ''}
                  {s.label}
                </span>
              </div>
            ))}
            {rows.length > 12 && <div className="muted">+{rows.length - 12} more</div>}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="chart-wrap">
      {legend && series.length > 1 && (
        <ChartLegend
          items={series.flatMap((s) =>
            s.members ? [{ id: s.id, label: `${s.label} (${s.members.length})`, color: s.color }] : [{ id: s.id, label: s.label, color: s.color }],
          )}
        />
      )}
      <div className="chart">
        <div ref={wrapRef} className="chart-plot" />
        {tip}
      </div>
      {series.length === 0 || series.every((s) => total(s.values) === 0) ? <p className="chart-empty muted">No messages in this range.</p> : null}
    </div>
  )
}

export default TimeChart
