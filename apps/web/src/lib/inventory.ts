export const QUALITY: Record<string, string> = {
  genuine: 'Genuine',
  oem: 'OEM',
  aftermarket: 'Aftermarket',
  refurbished: 'Refurbished',
}

export const TAX: Record<string, string> = {
  standard: 'VAT 16% (standard)',
  zero_rated: 'Zero-rated (0%)',
  exempt: 'VAT exempt',
}

export const UNITS = ['pc', 'set', 'pair', 'litre', 'metre', 'kg', 'box']

export const MOVEMENT_LABEL: Record<string, string> = {
  opening: 'Opening stock',
  purchase: 'Purchase',
  sale: 'Sale',
  sale_return: 'Customer return',
  transfer_out: 'Transfer out',
  transfer_in: 'Transfer in',
  adjustment: 'Adjustment',
  damage: 'Damaged / lost',
  supplier_return: 'Returned to supplier',
}

export const kes = (n: number | string | null | undefined) =>
  n === null || n === undefined || n === '' ? '-' : 'KES ' + Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 })

export const qty = (n: number | string | null | undefined) =>
  Number(n ?? 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })

// '' -> null, otherwise a number
export const num = (v: string): number | null => (v.trim() === '' ? null : Number(v))

export const canEditInventory = (role?: string) => role === 'owner' || role === 'manager' || role === 'storekeeper'

// crypto.randomUUID only exists on secure pages (https / localhost), so keep a fallback
export function uuid(): string {
  const c: any = typeof crypto !== 'undefined' ? crypto : null
  if (c && c.randomUUID) return c.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
