import { useMemo } from 'react'
import { OTHER_COLOR, SERIES_SLOTS, seriesColor, useDarkMode } from '../lib/colors'
import { formatCount } from '../lib/format'
import { bucketTimes, coverage, DAY, missing, sumBy, type Series } from '../lib/series'
import type { MixIndex, MixRow } from '../lib/types'
import TimeChart from './TimeChart'

interface Props {
  index: MixIndex | null
  daily: MixRow[] | null
  actorColor: (actor: string) => string
  actorSlots: Map<string, number>
  onDay: (time: number) => void
}

// Whole-history context: messages per day, and how the actor mix shifts day by day.
function BottomPane({ index, daily, actorColor, actorSlots, onDay }: Props) {
  const dark = useDarkMode()
  const data = useMemo(() => {
    if (!index || !daily) return null
    const cov = coverage(index)
    const times = bucketTimes({ from: Math.floor(cov.from / DAY) * DAY, to: cov.to }, DAY)
    const gone = missing(index, times, DAY)
    const totals = sumBy(daily, times, DAY, gone, () => 'all').get('all') ?? times.map(() => 0)
    const perDay: Series[] = [{ id: 'all', label: 'messages', color: seriesColor(0, dark), values: totals }]
    // Last 30 days of the actor mix, folded like the main chart.
    const recent = times.slice(-30)
    const recentGone = gone.slice(-30)
    const sums = sumBy(daily, recent, DAY, recentGone, (r) => ((actorSlots.get(r.actor) ?? SERIES_SLOTS) < SERIES_SLOTS ? r.actor : 'other'))
    const share: Series[] = [...sums.keys()]
      .sort((a, b) => (actorSlots.get(a) ?? SERIES_SLOTS) - (actorSlots.get(b) ?? SERIES_SLOTS))
      .map((a) => ({ id: a, label: a, color: a === 'other' ? OTHER_COLOR : actorColor(a), values: sums.get(a)! }))
    const days = totals.filter((v) => v !== null).length
    return { times, perDay, recent, share, days, sum: totals.reduce<number>((a, v) => a + (v ?? 0), 0) }
  }, [index, daily, actorColor, actorSlots, dark])

  return (
    <section className="bottom">
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Messages per day</span>
          {data && (
            <span className="muted">
              {formatCount(data.sum)} over {data.days} day{data.days === 1 ? '' : 's'} · click a day to open it
            </span>
          )}
        </div>
        {data && <TimeChart times={data.times} bucket={DAY} series={data.perDay} kind="bars" legend={false} onPick={onDay} />}
      </div>
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Actor share per day</span>
          <span className="muted">last {data ? data.recent.length : 30} days</span>
        </div>
        {data && <TimeChart times={data.recent} bucket={DAY} series={data.share} kind="share" onPick={onDay} />}
      </div>
    </section>
  )
}

export default BottomPane
