export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

export function formatCompact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

// UTC "YYYY-MM-DD HH:MM" for a unix second.
export function formatTime(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 16).replace('T', ' ')
}

export function formatDate(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10)
}
