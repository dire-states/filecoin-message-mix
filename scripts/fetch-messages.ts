// Count the messages on chain since the last run by actor type and method, and merge them into a
// data repo: days/YYYY/MM/<day>.csv (hourly), daily.csv, index.json and a generated README.md.
// Usage: [LOTUS_API=http://host:1234/rpc/v1] node scripts/fetch-messages.ts --out <data repo> [--commit] [--allow-stale]
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { dayPath, formatDailyRows, formatDayRows, parseRows } from '../src/lib/csv.ts'
import { EPOCHS_PER_DAY } from '../src/lib/epochs.ts'
import { actorLabel, methodName } from '../src/lib/methods.ts'
import type { MixIndex, MixRow } from '../src/lib/types.ts'

const { values: args } = parseArgs({
  options: {
    out: { type: 'string' },
    commit: { type: 'boolean', default: false },
    'allow-stale': { type: 'boolean', default: false },
  },
})
if (!args.out) throw new Error('--out <data repo directory> is required')
const OUT = resolve(args.out)
const path = (p: string) => resolve(OUT, p)

// Each data repo declares its network; never write one network's data into another's repo.
const dataset = JSON.parse(await readFile(path('dataset.json'), 'utf8')) as { network: string }
// Local nodes per network; LOTUS_API overrides. The network-name check below catches a wrong port.
const DEFAULT_API: Record<string, string> = {
  calibrationnet: 'http://192.168.50.123:1234/rpc/v1',
  mainnet: 'http://192.168.50.123:1235/rpc/v1',
}
const API =
  process.env.LOTUS_API ??
  DEFAULT_API[dataset.network] ??
  (() => {
    throw new Error(`LOTUS_API must be set for ${dataset.network}`)
  })()
const CONCURRENCY = 32
// A head older than this means the node is still syncing.
const MAX_HEAD_LAG_SECONDS = 600
// Stay this far behind the head so reorgs don't change counted tipsets.
const CONFIRMATIONS = 20
// The first run starts as far back as the node still has messages, but no further than this.
const MAX_BACKFILL_EPOCHS = 7 * EPOCHS_PER_DAY
const HOUR = 3600

let rpcId = 0
async function rpc<T>(method: string, params: unknown[], attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: `Filecoin.${method}`, params, id: ++rpcId }),
      })
      const body = (await res.json()) as { result?: T; error?: { message: string } }
      if (body.error) throw new Error(`${method}: ${body.error.message}`)
      return body.result as T
    } catch (err) {
      if (attempt >= attempts) {
        const cause = (err as { cause?: { code?: string } }).cause?.code
        throw cause ? new Error(`${method}: cannot reach ${API} (${cause})`) : err
      }
    }
  }
}

async function pool<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

async function readText(p: string): Promise<string | null> {
  try {
    return await readFile(path(p), 'utf8')
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return null
    throw err
  }
}

async function writeText(p: string, text: string) {
  await mkdir(dirname(path(p)), { recursive: true })
  await writeFile(path(p), text)
}

interface TipSet {
  Cids: { '/': string }[]
  Height: number
  Blocks: { Timestamp: number }[]
}

interface Msg {
  To: string
  Method: number
}

interface BlockMessages {
  BlsMessages: Msg[]
  SecpkMessages: { Message: Msg }[]
  Cids: { '/': string }[]
}

// Messages included at a height, deduplicated across its blocks; null for a null round.
async function messagesAt(height: number): Promise<{ timestamp: number; messages: Msg[] } | null> {
  const ts = await rpc<TipSet>('ChainGetTipSetByHeight', [height, null])
  if (ts.Height !== height) return null
  const seen = new Set<string>()
  const messages: Msg[] = []
  for (const block of ts.Cids) {
    const bm = await rpc<BlockMessages>('ChainGetBlockMessages', [block])
    // Cids lists the BLS messages first, then the secp ones.
    const all = [...bm.BlsMessages, ...bm.SecpkMessages.map((s) => s.Message)]
    bm.Cids.forEach((cid, i) => {
      if (seen.has(cid['/'])) return
      seen.add(cid['/'])
      messages.push(all[i])
    })
  }
  return { timestamp: ts.Blocks[0].Timestamp, messages }
}

// Whether the node still has the messages at (or just below, for a null round) a height.
async function available(height: number): Promise<boolean> {
  try {
    const ts = await rpc<TipSet>('ChainGetTipSetByHeight', [height, null], 1)
    await rpc<BlockMessages>('ChainGetBlockMessages', [ts.Cids[0]], 1)
    return true
  } catch {
    return false
  }
}

// Lowest height in [lo, hi] whose messages the node has (hi must be available).
async function oldestAvailable(lo: number, hi: number): Promise<number> {
  if (await available(lo)) return lo
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (await available(mid)) hi = mid
    else lo = mid
  }
  return hi
}

const network = await rpc<string>('StateNetworkName', [])
if (network !== dataset.network) {
  throw new Error(`node at ${API} is on ${network}, but ${OUT} holds ${dataset.network} data`)
}
const head = await rpc<TipSet>('ChainHead', [])
const lag = Math.round(Date.now() / 1000 - head.Blocks[0].Timestamp)
console.log(`${network} @ ${head.Height} (head ${lag}s old)`)
if (lag > MAX_HEAD_LAG_SECONDS && !args['allow-stale']) {
  throw new Error(`node not synced: head ${head.Height} is ${Math.round(lag / 60)} min behind (--allow-stale to override)`)
}
const runStarted = Date.now()

const indexText = await readText('index.json')
const prev = indexText ? (JSON.parse(indexText) as MixIndex) : null
const end = head.Height - CONFIRMATIONS
let start = prev ? prev.toHeight + 1 : await oldestAvailable(end - MAX_BACKFILL_EPOCHS, end)
const gaps = prev?.gaps ?? []
if (start > end) {
  console.log(`nothing new: covered through ${prev?.toHeight}`)
  process.exit(0)
}
// A run that comes too late finds the node already pruned past where the last one stopped.
if (prev && !(await available(start))) {
  const oldest = await oldestAvailable(start, end)
  console.warn(`gap: node no longer has ${start}-${oldest - 1}`)
  gaps.push([start, oldest - 1])
  start = oldest
}
console.log(`counting ${start}-${end} (${end - start + 1} heights)`)

// Actor type per receiver, from code CIDs of every network version that can still appear.
const nv = await rpc<number>('StateNetworkVersion', [null])
const codeNames = new Map<string, string>()
for (let v = 16; v <= nv; v++) {
  const codes = await rpc<Record<string, { '/': string }>>('StateActorCodeCIDs', [v]).catch(() => null)
  for (const [name, cid] of Object.entries(codes ?? {})) codeNames.set(cid['/'], name)
}
const actorOf = new Map<string, Promise<string>>()
function actorType(addr: string): Promise<string> {
  let p = actorOf.get(addr)
  if (!p) {
    p = rpc<{ Code: { '/': string } }>('StateGetActor', [addr, null], 1)
      .then((a) => codeNames.get(a.Code['/']) ?? 'unknown')
      .catch(() => 'unknown')
    actorOf.set(addr, p)
  }
  return p
}

// Hourly counts keyed by "hourStart|actor|method".
const counts = new Map<string, number>()
const heights = Array.from({ length: end - start + 1 }, (_, i) => start + i)
let done = 0
let total = 0
const fetchStarted = Date.now()
await pool(heights, async (h) => {
  const at = await messagesAt(h)
  if (at) {
    const hour = Math.floor(at.timestamp / HOUR) * HOUR
    for (const m of at.messages) {
      const type = await actorType(m.To)
      const key = `${hour}|${actorLabel(type)}|${methodName(type, m.Method)}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    total += at.messages.length
  }
  if (++done % 500 === 0) {
    const rate = done / ((Date.now() - fetchStarted) / 1000)
    console.log(`  ${done}/${heights.length} heights, ${total} messages, ${Math.round((heights.length - done) / rate)}s left`)
  }
})

// Merge the new counts into the day files they touch.
const byDay = new Map<string, MixRow[]>()
for (const [key, messages] of counts) {
  const [hour, actor, method] = key.split('|')
  const time = +hour
  const day = new Date(time * 1000).toISOString().slice(0, 10)
  if (!byDay.has(day)) byDay.set(day, [])
  byDay.get(day)!.push({ time, actor, method, messages })
}
const dayTotals = new Map<string, MixRow[]>()
for (const [day, added] of byDay) {
  const merged = new Map<string, MixRow>()
  for (const r of [...parseRows((await readText(dayPath(day))) ?? ''), ...added]) {
    const key = `${r.time}|${r.actor}|${r.method}`
    const m = merged.get(key)
    if (m) m.messages += r.messages
    else merged.set(key, { ...r })
  }
  await writeText(dayPath(day), formatDayRows([...merged.values()]))
  // Daily rows for this day, summed over its hours.
  const daily = new Map<string, MixRow>()
  const dayStart = Date.parse(`${day}T00:00Z`) / 1000
  for (const r of merged.values()) {
    const key = `${r.actor}|${r.method}`
    const d = daily.get(key)
    if (d) d.messages += r.messages
    else daily.set(key, { time: dayStart, actor: r.actor, method: r.method, messages: r.messages })
  }
  dayTotals.set(day, [...daily.values()])
}

// daily.csv: replace the rows of the touched days.
const dailyRows = parseRows((await readText('daily.csv')) ?? '').filter(
  (r) => !dayTotals.has(new Date(r.time * 1000).toISOString().slice(0, 10)),
)
for (const rows of dayTotals.values()) dailyRows.push(...rows)
await writeText('daily.csv', formatDailyRows(dailyRows))

const methodTotals = new Map<string, { actor: string; method: string; messages: number }>()
const perDay = new Map<string, MixRow[]>()
for (const r of dailyRows) {
  const key = `${r.actor}|${r.method}`
  const t = methodTotals.get(key)
  if (t) t.messages += r.messages
  else methodTotals.set(key, { actor: r.actor, method: r.method, messages: r.messages })
  const day = new Date(r.time * 1000).toISOString().slice(0, 10)
  if (!perDay.has(day)) perDay.set(day, [])
  perDay.get(day)!.push(r)
}
const genesis = await rpc<{ Blocks: { Timestamp: number }[] }>('ChainGetGenesis', [])
const index: MixIndex = {
  network,
  genesisTimestamp: genesis.Blocks[0].Timestamp,
  fromHeight: prev?.fromHeight ?? start,
  toHeight: end,
  updatedAt: new Date().toISOString(),
  gaps,
  days: [...perDay.keys()].sort(),
  methods: [...methodTotals.values()].sort((a, b) => b.messages - a.messages),
}
await writeText('index.json', JSON.stringify(index))
await writeText('README.md', readme(index, perDay))
console.log(
  `counted ${total} messages at ${start}-${end} into ${byDay.size} day file(s), ${Math.round((Date.now() - runStarted) / 1000)}s`,
)

// The data repo's front page on GitHub: what's here, and the last 30 days with links to their files.
function readme(index: MixIndex, perDay: Map<string, MixRow[]>): string {
  const time = (epoch: number) =>
    new Date((index.genesisTimestamp + epoch * 30) * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  const days = [...perDay.keys()].sort().reverse()
  const label = index.network === 'mainnet' ? 'mainnet' : 'calibration network'
  const rows = days.slice(0, 30).map((day) => {
    const rs = [...perDay.get(day)!].sort((a, b) => b.messages - a.messages)
    const sum = rs.reduce((a, r) => a + r.messages, 0)
    const top = rs.slice(0, 3).map((r) => `${r.actor}.${r.method} ${r.messages.toLocaleString('en-US')}`).join(', ')
    return `| [${day}](${dayPath(day)}) | ${sum.toLocaleString('en-US')} | ${top} |`
  })
  const months = [...new Set(days.map((d) => d.slice(0, 7)))].map((m) => `[${m}](days/${m.slice(0, 4)}/${m.slice(5)})`)
  return `# filecoin-message-mix data: ${label}

Messages on the Filecoin **${label}**, counted by receiving actor type and method, for the
[filecoin-message-mix](https://dire-states.github.io/filecoin-message-mix/) site
([source](https://github.com/dire-states/filecoin-message-mix)). This file is generated on every update.

Covered: height ${index.fromHeight} (${time(index.fromHeight)}) to ${index.toHeight} (${time(index.toHeight)}).
Last update: ${index.updatedAt.slice(0, 16).replace('T', ' ')} UTC.${index.gaps.length ? `\nGaps (heights the node no longer had): ${index.gaps.map(([a, b]) => `${a}-${b}`).join(', ')}.` : ''}

## Last 30 days

| Day (hourly CSV) | Messages | Top methods |
|---|---|---|
${rows.join('\n')}

Months: ${months.join(' · ')}

## Files

- \`daily.csv\`: \`date,actor,method,messages\` for the whole history, one row per day and method.
- \`days/YYYY/MM/YYYY-MM-DD.csv\`: \`hour,actor,method,messages\`, hourly rows for one UTC day.
- \`index.json\`: covered heights, gaps, days, and totals per method (read by the site).

Messages count at the height of the tipset that includes them; hours and days are UTC. \`actor\` is the
receiver's actor type (\`unknown\` if it no longer exists), and method \`Send\` is a plain transfer.
Methods that are not in the current builtin actors show as \`#<number>\`.
`
}

if (args.commit) {
  const git = (...a: string[]) => execFileSync('git', ['-C', OUT, ...a], { encoding: 'utf8' }).trim()
  git('add', '-A')
  const message = `window ${network} ${start}-${end} (${index.updatedAt.slice(0, 10)})`
  git('commit', '--quiet', '-m', message)
  console.log(`committed ${git('rev-parse', '--short', 'HEAD')} ${message}`)
}
