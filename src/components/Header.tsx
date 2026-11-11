import { formatCount, formatTime } from '../lib/format'
import { NETWORKS, type NetKey } from '../lib/networks'
import { coverage } from '../lib/series'
import type { MixIndex } from '../lib/types'

interface Props {
  index: MixIndex | null
  net: NetKey
  onNet: (net: NetKey) => void
  // Messages in the current range; null while loading.
  rangeTotal: number | null
}

function Header({ index, net, onNet, rangeTotal }: Props) {
  return (
    <header className="header">
      <h1>message-mix</h1>
      <div className="net-toggle" role="group" aria-label="Network">
        {(Object.keys(NETWORKS) as NetKey[]).map((key) => (
          <button key={key} className={key === net ? 'on' : ''} aria-pressed={key === net} onClick={() => onNet(key)}>
            {NETWORKS[key].label}
          </button>
        ))}
      </div>
      {index && (
        <>
          <span className="header-stat">
            {rangeTotal !== null && (
              <>
                <strong>{formatCount(rangeTotal)}</strong> messages in range
              </>
            )}
          </span>
          <span className="header-meta">
            data {formatTime(coverage(index).from)} → {formatTime(coverage(index).to)} UTC · updated{' '}
            {formatTime(Date.parse(index.updatedAt) / 1000)} UTC
          </span>
        </>
      )}
    </header>
  )
}

export default Header
