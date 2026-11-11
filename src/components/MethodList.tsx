import { useMemo, useState } from 'react'
import { SERIES_SLOTS, seriesColor } from '../lib/colors'
import { formatCount } from '../lib/format'
import type { MixIndex } from '../lib/types'

type SortKey = 'count' | 'name'

interface Props {
  index: MixIndex | null
  // Messages per method key in the current range.
  counts: Map<string, number>
  loading: boolean
  selected: string[]
  slots: Map<string, number>
  dark: boolean
  actorColor: (actor: string) => string
  onMethodClick: (e: React.MouseEvent, key: string) => void
  onClear: () => void
  error: string | null
}

// Methods grouped by receiving actor type, with their message counts in the current range.
function MethodList({ index, counts, loading, selected, slots, dark, actorColor, onMethodClick, onClear, error }: Props) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('count')

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const byActor = new Map<string, { key: string; method: string; count: number }[]>()
    // Every method ever seen is listed, so the list doesn't jump when the range changes.
    for (const m of index?.methods ?? []) {
      const key = `${m.actor}.${m.method}`
      if (q && !key.toLowerCase().includes(q)) continue
      if (!byActor.has(m.actor)) byActor.set(m.actor, [])
      byActor.get(m.actor)!.push({ key, method: m.method, count: counts.get(key) ?? 0 })
    }
    const order = (a: { count: number; method: string }, b: { count: number; method: string }) =>
      sort === 'count' ? b.count - a.count || a.method.localeCompare(b.method) : a.method.localeCompare(b.method)
    return [...byActor]
      .map(([actor, methods]) => ({ actor, methods: methods.sort(order), count: methods.reduce((a, m) => a + m.count, 0) }))
      .sort((a, b) => (sort === 'count' ? b.count - a.count : 0) || a.actor.localeCompare(b.actor))
  }, [index, counts, search, sort])

  const methodTotal = index?.methods.length ?? 0

  return (
    <aside className="left">
      <div className="left-head">
        <h2 className="pane-title">Methods ({methodTotal})</h2>
        <button className="link" disabled={selected.length === 0} onClick={onClear}>
          {selected.length ? `Show mix (${selected.length} selected)` : 'Showing mix'}
        </button>
      </div>
      <div className="list-controls">
        <input
          type="search"
          placeholder="Search actor or method"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search methods"
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort methods">
          <option value="count">Most messages</option>
          <option value="name">A–Z</option>
        </select>
      </div>
      {error && <p className="error">Failed to load data: {error}</p>}
      {groups.map((g) => (
        <section key={g.actor} className="actor-group">
          <h3 className="actor-head">
            <span>
              <i className="swatch" style={{ background: actorColor(g.actor) }} />
              {g.actor}
            </span>
            <span className="counts">{loading ? '…' : formatCount(g.count)}</span>
          </h3>
          <ul className="method-list">
            {g.methods.map((m) => {
              const isSelected = selected.includes(m.key)
              const slot = slots.get(m.key)
              return (
                <li key={m.key} className={isSelected ? 'method selected' : 'method'}>
                  <button
                    className="method-body"
                    aria-pressed={isSelected}
                    title="Shift-click to add or remove from the selection"
                    onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                    onClick={(e) => onMethodClick(e, m.key)}
                  >
                    <span className="method-name">
                      {isSelected && slot !== undefined && (
                        <i className="line-key" style={{ background: slot < SERIES_SLOTS ? seriesColor(slot, dark) : undefined }} />
                      )}
                      {m.method}
                    </span>
                    <span className={m.count ? 'counts' : 'counts muted'}>{loading ? '…' : formatCount(m.count)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </aside>
  )
}

export default MethodList
