export type COverview = {
  id: string
  name: string
  phone: string | null
  customer_type: string
  price_tier: string
  credit_limit: number
  notes: string | null
  is_active: boolean
  balance: number
  over_limit: boolean
  last_payment_at: string | null
  oldest_unpaid_at: string | null
}

export const TYPE_LABEL: Record<string, string> = {
  retail: 'Retail customer',
  rider: 'Boda boda rider',
  mechanic: 'Mechanic / garage',
  wholesale: 'Shop / wholesale',
}

export const LEDGER_LABEL: Record<string, string> = {
  opening_balance: 'Opening balance',
  sale: 'Credit sale',
  payment: 'Payment',
  return: 'Return',
  adjustment: 'Adjustment',
}

export const DEFAULT_REMINDER = 'Hello {name}, you owe {shop} KES {amount}. Please pay via M-Pesa or visit us. Thank you.'

export const fillTemplate = (tpl: string, v: { name: string; amount: number; shop: string }) =>
  tpl
    .replace(/\{name\}/g, v.name.split(' ')[0])
    .replace(/\{amount\}/g, Number(v.amount).toLocaleString('en-KE', { maximumFractionDigits: 0 }))
    .replace(/\{shop\}/g, v.shop)

export const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : null)

export type Bucket = '0-7' | '8-30' | '31-60' | '60+' | 'unknown'
export const BUCKETS: { key: Bucket; label: string }[] = [
  { key: '0-7', label: 'Up to 7 days' },
  { key: '8-30', label: '8 to 30 days' },
  { key: '31-60', label: '31 to 60 days' },
  { key: '60+', label: 'Over 60 days' },
  { key: 'unknown', label: 'Old debt (no date)' },
]
export function bucketOf(days: number | null): Bucket {
  if (days === null) return 'unknown'
  if (days <= 7) return '0-7'
  if (days <= 30) return '8-30'
  if (days <= 60) return '31-60'
  return '60+'
}
