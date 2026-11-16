// Dates for reports are Kenya dates (YYYY-MM-DD)
export const todayEAT = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })

const ymd = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (s: string, days: number) => {
  const [y, m, d] = s.split('-').map(Number)
  return ymd(new Date(Date.UTC(y, m - 1, d + days)))
}

export type Preset = 'today' | 'yesterday' | '7days' | 'month' | 'lastmonth' | 'custom'
export const PRESET_LABEL: Record<Preset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7days': 'Last 7 days',
  month: 'This month',
  lastmonth: 'Last month',
  custom: 'Choose dates',
}

export function periodRange(p: Preset, customFrom = '', customTo = ''): { from: string; to: string } {
  const t = todayEAT()
  const [y, m] = t.split('-').map(Number)
  if (p === 'today') return { from: t, to: t }
  if (p === 'yesterday') return { from: addDays(t, -1), to: addDays(t, -1) }
  if (p === '7days') return { from: addDays(t, -6), to: t }
  if (p === 'month') return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: t }
  if (p === 'lastmonth') return { from: ymd(new Date(Date.UTC(y, m - 2, 1))), to: ymd(new Date(Date.UTC(y, m - 1, 0))) }
  return { from: customFrom || t, to: customTo || t }
}

export function downloadCSV(filename: string, rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const text = '\ufeff' + rows.map((r) => r.map(esc).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
