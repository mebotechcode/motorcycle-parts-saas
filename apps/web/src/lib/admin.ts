export function deviceFromUa(ua?: string | null) {
  if (!ua) return 'Unknown'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone / iPad'
  if (/Android/i.test(ua)) return 'Android'
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'Mac'
  if (/Linux/i.test(ua)) return 'Linux'
  return 'Other'
}

export function keWhen(v?: string | null) {
  return v ? new Date(v).toLocaleString('en-KE') : '—'
}

export function keDate(v?: string | null) {
  return v ? new Date(v).toLocaleDateString('en-KE') : '—'
}
