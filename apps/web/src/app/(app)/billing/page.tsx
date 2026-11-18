'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Field, Spinner } from '@/components/ui'
import { money } from '@/lib/pos'
import { t as tr, useLang } from '@/lib/i18n'
import { normalizeMpesaPhone, sendStkPush } from '@/lib/mpesa'

type Plan = {
  id: string
  code: string
  name: string
  price_monthly: number
  max_branches: number | null
  max_users: number | null
  max_products: number | null
  features: Record<string, boolean> | null
}
type BillingInfo = {
  status: string
  plan_code: string
  plan_name: string
  price_monthly: number
  trial_ends_at: string | null
  current_period_end: string | null
  grace_ends_at: string | null
  days_left: number | null
  grace_days_left: number | null
  writable: boolean
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' }) : null

export default function BillingPage() {
  const { claims } = useSession()
  const role = claims.tenant_role
  const manager = role === 'owner' || role === 'manager'
  const lang = useLang()

  const [info, setInfo] = useState<BillingInfo | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [phone, setPhone] = useState('')
  const [busyPlan, setBusyPlan] = useState('')
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: b }, { data: p }] = await Promise.all([
      supabase.rpc('billing_status'),
      supabase.from('plans').select('*').eq('is_active', true).order('price_monthly'),
    ])
    setInfo((b as BillingInfo) ?? null)
    setPlans((p as Plan[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (!manager) return <Alert kind="info">Only the owner or a manager can see billing.</Alert>

  async function payWithMpesa(plan: Plan) {
    setMessage(null)
    const normalized = normalizeMpesaPhone(phone)
    if (!normalized) {
      setMessage({ kind: 'error', text: 'Enter a valid Kenyan phone number (e.g. 0712 345 678)' })
      return
    }
    setBusyPlan(plan.code)
    // 1. Create (or reuse) an invoice for this plan
    const { data: inv, error: invError } = await supabase.rpc('create_subscription_invoice', { p_plan_code: plan.code })
    if (invError) {
      setBusyPlan('')
      setMessage({ kind: 'error', text: invError.message })
      return
    }
    const invoice = inv as { invoice_id: string; amount: number }
    // 2. Trigger the STK push for that invoice
    const result = await sendStkPush({
      phone: normalized,
      amount: invoice.amount,
      purpose: 'subscription',
      invoice_id: invoice.invoice_id,
      account_reference: plan.code.toUpperCase(),
      invoke: (fn, body) => supabase.functions.invoke(fn, { body }) as any,
    })
    setBusyPlan('')
    if (!result.ok) {
      setMessage({ kind: 'error', text: result.error ?? 'M-Pesa did not accept the request. Try again.' })
      return
    }
    setMessage({
      kind: 'success',
      text: `${tr('stkSent', lang)} (KES ${money(invoice.amount)} for ${plan.name}) Your subscription activates automatically once you enter your PIN.`,
    })
  }

  if (loading) return <Spinner />

  const trialEnding = info?.status === 'trialing' && info.days_left !== null && info.days_left <= 3
  const inGrace = info?.status === 'past_due' || (info?.grace_days_left !== null && info.grace_days_left !== undefined && info.grace_days_left <= 7)
  const locked = info ? !info.writable : false

  const statusTone = (s?: string) =>
    s === 'active' ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
    : s === 'trialing' ? 'text-brand border-brand/40 bg-brand/10'
    : 'text-red-300 border-red-500/40 bg-red-500/10'

  const featureLines = (p: Plan) => {
    const lines: string[] = []
    lines.push(p.max_branches === null ? 'Unlimited branches' : `${p.max_branches} branch${p.max_branches === 1 ? '' : 'es'}`)
    lines.push(p.max_users === null ? 'Unlimited staff' : `${p.max_users} staff accounts`)
    lines.push(p.max_products === null ? 'Unlimited products' : `Up to ${p.max_products.toLocaleString()} products`)
    if (p.features?.sms) lines.push('SMS debt reminders (Africa\'s Talking)')
    else lines.push('WhatsApp debt reminders & receipts')
    if (p.features?.etims) lines.push('KRA eTIMS receipt signing + QR')
    if (p.features?.api) lines.push('API access + priority support')
    return lines
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold">{tr('billing', lang)}</h1>
          <p className="text-sm text-muted">Pay your NafPOS subscription with M-Pesa. Activation is automatic after you enter your PIN.</p>
        </div>
        {info && (
          <span className={`rounded-full border px-4 py-1.5 text-xs font-bold uppercase tracking-wide ${statusTone(info.status)}`}>
            {info.status === 'trialing' ? `Trial · ${info.days_left ?? 0} days left` : info.status}
          </span>
        )}
        <Button variant="ghost" onClick={load} className="text-xs">Refresh status</Button>
      </div>

      {locked && (
        <Alert kind="error">
          Your subscription has lapsed and this business is now read-only. Pay any plan below with M-Pesa to restore selling, cash-up and everything else immediately.
        </Alert>
      )}
      {!locked && trialEnding && (
        <Alert kind="info">
          Your free trial ends {fmtDate(info?.trial_ends_at ?? null)} ({info?.days_left} day{info?.days_left === 1 ? '' : 's'} left). Choose a plan and pay with M-Pesa to continue after the trial.
        </Alert>
      )}
      {!locked && inGrace && (
        <Alert kind="info">
          Your payment is overdue. You have until {fmtDate(info?.grace_ends_at ?? null)} before the account is locked. Pay now to stay active.
        </Alert>
      )}
      {message && <Alert kind={message.kind === 'success' ? 'success' : message.kind === 'info' ? 'info' : 'error'}>{message.text}</Alert>}

      {/* Current plan */}
      {info && (
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">{tr('currentPlan', lang)}</div>
            <div className="font-display text-3xl font-bold">{info.plan_name} <span className="text-lg text-muted">· KES {money(info.price_monthly)}/mo</span></div>
            <div className="mt-1 text-sm text-muted">
              {info.status === 'trialing' && fmtDate(info.trial_ends_at) && <>Trial ends <b className="text-offwhite">{fmtDate(info.trial_ends_at)}</b>. </>}
              {fmtDate(info.current_period_end) && <>Paid through <b className="text-offwhite">{fmtDate(info.current_period_end)}</b>.</>}
            </div>
          </div>
        </Card>
      )}

      {/* Phone for STK push */}
      <Card>
        <Field
          label="M-Pesa phone number"
          type="tel"
          inputMode="tel"
          placeholder="0712 345 678"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          hint="The STK push prompt goes to this number. Works with Safaricom M-Pesa."
        />
      </Card>

      {/* Plans */}
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => {
          const current = info?.plan_code === plan.code && info.status === 'active'
          return (
            <Card key={plan.id} className={`flex flex-col ${current ? 'border-brand/60' : ''}`}>
              <div className="text-xs uppercase tracking-wide text-muted">{plan.name}</div>
              <div className="mt-1 font-display text-4xl font-bold">
                <span className="text-lg align-top">KES</span> {money(plan.price_monthly)}
                <span className="text-sm font-medium text-muted"> /mo</span>
              </div>
              <ul className="mt-3 flex-1 space-y-1.5 text-sm text-muted">
                {featureLines(plan).map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <span className="text-brand">✓</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <Button
                className="mt-4 w-full"
                variant={current ? 'ghost' : 'primary'}
                disabled={busyPlan === plan.code}
                onClick={() => payWithMpesa(plan)}
              >
                {busyPlan === plan.code ? 'Sending…' : current ? 'Renew this plan' : tr('payWithMpesa', lang)}
              </Button>
            </Card>
          )
        })}
      </div>

      <p className="text-center text-xs text-muted">
        Payment by M-Pesa STK Push activates your plan automatically
        {process.env.NEXT_PUBLIC_SUPPORT_EMAIL
          ? `. For billing questions, email ${process.env.NEXT_PUBLIC_SUPPORT_EMAIL}.`
          : '. For billing questions, contact NafPOS support.'}
      </p>
    </div>
  )
}
