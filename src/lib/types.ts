// One CSV row: messages of one actor type and method in a time bucket.
export interface MixRow {
  // Unix seconds at the start of the bucket (hour or UTC day).
  time: number
  actor: string
  method: string
  messages: number
}

// Index file: index.json in a data repo.
export interface MixIndex {
  network: string
  genesisTimestamp: number
  // Heights covered so far, inclusive. Messages are counted at the height of the tipset that includes them.
  fromHeight: number
  toHeight: number
  updatedAt: string
  // Height ranges the node no longer had when a run reached them, inclusive.
  gaps: [number, number][]
  // UTC days with a day file (days/YYYY/MM/YYYY-MM-DD.csv), oldest first.
  days: string[]
  // Totals over the whole history, largest first.
  methods: { actor: string; method: string; messages: number }[]
}
