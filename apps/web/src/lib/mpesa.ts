import { friendlyError } from './errors'

// M-Pesa helpers shared by POS, debt repayment and billing.
// Manual codes are validated client-side (server enforces uniqueness
// with payments_mpesa_reference_unique) and flagged unverified until
// an owner/manager verifies them at end-of-day reconciliation.

export const MPESA_CODE_RE = /^[A-Za-z0-9]{8,12}$/

export const isValidMpesaCode = (code: string) => MPESA_CODE_RE.test(code.trim())

export function normalizeMpesaPhone(raw: string): string | null {
  const d = raw.replace(/[^\d]/g, '')
  if (/^0[17]\d{8}$/.test(d)) return '254' + d.slice(1)
  if (/^254[17]\d{8}$/.test(d)) return d
  if (/^[17]\d{8}$/.test(d)) return '254' + d
  return null
}

export type StkResult = { ok: boolean; checkout_request_id?: string; customer_message?: string; error?: string }

export async function sendStkPush(args: {
  phone: string
  amount: number
  branch_id?: string
  sale_id?: string
  customer_id?: string
  account_reference?: string
  purpose?: 'pos' | 'subscription'
  invoice_id?: string
  invoke: (fn: string, body: any) => Promise<{ data: any; error: any }>
}): Promise<StkResult> {
  const phone = normalizeMpesaPhone(args.phone)
  if (!phone) return { ok: false, error: 'Enter a valid Kenyan phone number (e.g. 0712 345 678)' }
  if (!(args.amount > 0)) return { ok: false, error: 'Enter an amount more than zero' }
  const { data, error } = await args.invoke('mpesa-stk-push', {
    phone,
    amount: Math.round(args.amount),
    branch_id: args.branch_id,
    sale_id: args.sale_id,
    customer_id: args.customer_id,
    account_reference: args.account_reference,
    purpose: args.purpose ?? 'pos',
    invoice_id: args.invoice_id,
  })
  if (error) {
    let msg = error.message
    try {
      msg = (await (error as any).context.json()).error ?? msg
    } catch {}
    return { ok: false, error: friendlyError(msg) }
  }
  if (!data?.ok) return { ok: false, error: data?.error ?? 'M-Pesa did not accept the request.' }
  return { ok: true, checkout_request_id: data.checkout_request_id, customer_message: data.customer_message }
}
