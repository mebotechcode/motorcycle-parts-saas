export type Supplier = {
  id: string
  name: string
  contact_person: string | null
  phone: string | null
  email: string | null
  address: string | null
  payment_terms_days: number
  notes: string | null
  is_active: boolean
  balance: number
  last_receipt_at: string | null
  last_payment_at: string | null
}

export const PO_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-charcoal-3 text-muted' },
  ordered: { label: 'Ordered', cls: 'bg-brand/15 text-brand' },
  partially_received: { label: 'Part received', cls: 'bg-amber-500/15 text-amber-300' },
  received: { label: 'Received', cls: 'bg-emerald-500/15 text-emerald-300' },
  cancelled: { label: 'Cancelled', cls: 'bg-red-500/15 text-red-300' },
}

export const SUPPLIER_LEDGER_LABEL: Record<string, string> = {
  opening_balance: 'Opening balance',
  sale: 'Goods received',
  payment: 'Payment',
  return: 'Goods returned',
  adjustment: 'Adjustment',
}

export type PLine = {
  product_id: string
  name: string
  sku: string
  unit: string
  qty: string
  cost: string
  last_cost: number | null
  selling_price: number | null
  po_item_id?: string | null
  ordered?: number
}

export const lineSum = (l: { qty: string; cost: string }) => Math.round(Number(l.qty || 0) * Number(l.cost || 0) * 100) / 100
