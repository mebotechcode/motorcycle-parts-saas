export type Tier = 'retail' | 'wholesale'

export type CartLine = {
  product_id: string
  name: string
  sku: string
  unit: string
  list_retail: number
  list_wholesale: number | null
  qty: string
  price: string // what is being charged per item
  track: boolean
  tax: string // standard | zero_rated | exempt
}

export type Customer = {
  id: string
  name: string
  phone: string | null
  credit_limit: number
  payment_terms_days?: number
  boda_stage?: string | null
  price_tier: Tier
  customer_type: string
}

export const CART_KEY = 'pos_cart_v1'
export const BRANCH_KEY = 'pos_branch_v1'

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export const listPrice = (l: CartLine, tier: Tier) => (tier === 'wholesale' ? l.list_wholesale ?? l.list_retail : l.list_retail)

export const lineTotal = (l: CartLine) => round2(Number(l.qty || 0) * Number(l.price || 0))

export function discountPct(l: CartLine, tier: Tier) {
  const list = listPrice(l, tier)
  const p = Number(l.price)
  return list > 0 && p < list ? ((list - p) / list) * 100 : 0
}

export const PAY_LABEL: Record<string, string> = { cash: 'Cash', mpesa: 'M-Pesa', bank: 'Bank', other: 'Other' }

export const money = (n: number | string | null | undefined) =>
  Number(n ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Kenyan phone -> digits for wa.me (0712... -> 254712...)
export function waNumber(phone?: string | null) {
  if (!phone) return ''
  let d = phone.replace(/[^\d]/g, '')
  if (d.startsWith('0')) d = '254' + d.slice(1)
  if (d.startsWith('7') || d.startsWith('1')) d = '254' + d
  return d
}

export function receiptText(o: { shop: string; sale: any; items: any[]; payments: any[]; customer?: string | null; lang?: 'en' | 'sw' }) {
  const { shop, sale, items, payments, customer, lang = 'en' } = o
  const sw = lang === 'sw'
  const lines = [
    `*${shop}*`,
    `${sw ? 'Risiti' : 'Receipt'} ${sale.receipt_no}`,
    new Date(sale.sold_at).toLocaleString('en-KE'),
    customer ? `${sw ? 'Mteja' : 'Customer'}: ${customer}` : '',
    sale.etims_cu_number ? `CU: ${sale.etims_cu_number}` : sale.etims_status === 'pending' ? 'eTIMS: queued' : '',
    '',
    ...items.map((i) => `${i.product_name} x${Number(i.quantity)}  ${money(i.line_total)}`),
    '',
    `*${sw ? 'Jumla' : 'Total'}: KES ${money(sale.total)}*`,
    ...payments.map((p) => `${PAY_LABEL[p.method] ?? p.method}: KES ${money(p.amount)}`),
    Number(sale.balance_due) > 0 ? `${sw ? 'Salio kwenye akaunti' : 'Balance on account'}: KES ${money(sale.balance_due)}` : '',
    '',
    sw ? 'Asante kwa kununua nasi!' : 'Thank you for shopping with us!',
  ]
  return lines.filter((x, i) => x !== '' || lines[i - 1] !== '').join('\n')
}

// 58mm / 80mm thermal receipt text (monospace, ~32 / ~42 chars per line)
export function thermalReceiptText(o: { shop: string; sale: any; items: any[]; payments: any[]; customer?: string | null; width?: 58 | 80 }) {
  const { shop, sale, items, payments, customer, width = 58 } = o
  const cols = width === 80 ? 42 : 32
  const line = (l: string, r: string) => {
    const pad = Math.max(1, cols - l.length - r.length)
    return l + ' '.repeat(pad) + r
  }
  const out = [
    shop.toUpperCase().slice(0, cols),
    `Receipt ${sale.receipt_no}`,
    new Date(sale.sold_at).toLocaleString('en-KE'),
    customer ? `Customer: ${customer}`.slice(0, cols) : '',
    '-'.repeat(cols),
    ...items.map((i) => line(`${i.product_name} x${Number(i.quantity)}`.slice(0, cols - 8), money(i.line_total))),
    '-'.repeat(cols),
    line('TOTAL (KES)', money(sale.total)),
    ...payments.map((p) => line((PAY_LABEL[p.method] ?? p.method).slice(0, cols - 8), money(p.amount))),
    Number(sale.balance_due) > 0 ? line('Balance due', money(sale.balance_due)) : '',
    sale.etims_cu_number ? `CU: ${sale.etims_cu_number}`.slice(0, cols) : '',
    'Thank you!',
  ]
  return out.filter(Boolean).join('\n')
}

// VAT inside a bill (prices already include VAT). Same maths as the server.
export function computeTax(
  lines: { qty: string; price: string; tax: string }[],
  tenant: { vat_registered?: boolean; vat_rate?: number } | null,
  subtotal: number,
  total: number
) {
  if (!tenant?.vat_registered) return 0
  const rate = Number(tenant.vat_rate ?? 16)
  let tax = 0
  for (const l of lines) {
    const lt = round2(Number(l.qty || 0) * Number(l.price || 0))
    const r = l.tax === 'standard' ? rate : 0
    tax += round2(lt - lt / (1 + r / 100))
  }
  return subtotal > 0 ? round2((tax * total) / subtotal) : 0
}
