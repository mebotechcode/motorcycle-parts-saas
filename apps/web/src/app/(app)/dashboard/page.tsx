'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ROLE_LABEL, useSession } from '@/lib/session'
import { Card } from '@/components/ui'
import { money } from '@/lib/pos'
import { todayEAT } from '@/lib/reports'

type Sub = { status: string; trial_ends_at: string | null; plans: { name: string } | null } | null

export default function DashboardPage() {
  const { claims, session } = useSession()
  const [counts, setCounts] = useState({ branches: 0, staff: 0, products: 0, low: 0 })
  const [sub, setSub] = useState<Sub>(null)
  const [today, setToday] = useState<{ count: number; total: number } | null>(null)
  const [owed, setOwed] = useState<{ total_owed: number; owing_count: number } | null>(null)
  const [profit, setProfit] = useState<any>(null)
  const [payable, setPayable] = useState<{ total_owed: number; owed_count: number } | null>(null)
  const [etims, setEtims] = useState<{ queued: number; failed: number; submitted: number } | null>(null)
  const [etimsBusy, setEtimsBusy] = useState(false)
  const [etimsMessage, setEtimsMessage] = useState('')
  const canSeeBilling = claims.tenant_role === 'owner' || claims.tenant_role === 'manager'

  const loadEtims = async () => {
    const { data } = await supabase.rpc('etims_queue_summary')
    if (data) setEtims(data as any)
  }

  async function transmitEtims() {
    setEtimsBusy(true)
    setEtimsMessage('')
    const { data, error } = await supabase.functions.invoke('etims-submit', { body: { transmit_all: true } })
    setEtimsBusy(false)
    if (error) {
      let msg = error.message
      try {
        msg = (await (error as any).context.json()).error ?? msg
      } catch {}
      setEtimsMessage(msg)
    } else {
      const d: any = data ?? {}
      setEtimsMessage(d.message ?? `Done. ${d.submitted ?? 0} sent, ${d.failed ?? 0} still failing.`)
    }
    loadEtims()
  }

  useEffect(() => {
    ;(async () => {
      const [b, s, p, low, subRes] = await Promise.all([
        supabase.from('branches').select('*', { count: 'exact', head: true }),
        supabase.from('tenant_members').select('*', { count: 'exact', head: true }),
        supabase.from('product_overview').select('*', { count: 'exact', head: true }).is('deleted_at', null).eq('is_active', true),
        supabase.from('product_overview').select('*', { count: 'exact', head: true }).is('deleted_at', null).eq('is_active', true).eq('is_low', true),
        supabase.from('subscriptions').select('status, trial_ends_at, plans(name)').maybeSingle(),
      ])
      setCounts({ branches: b.count ?? 0, staff: s.count ?? 0, products: p.count ?? 0, low: low.count ?? 0 })
      setSub((subRes.data as unknown as Sub) ?? null)
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const end = new Date(start.getTime() + 86400000)
      const sales = await supabase.rpc('sales_summary', { p_from: start.toISOString(), p_to: end.toISOString() })
      if (sales.data) setToday(sales.data as any)
      if (canSeeBilling) {
        const cs = await supabase.rpc('customers_summary')
        if (cs.data) setOwed(cs.data as any)
        const ss = await supabase.rpc('suppliers_summary')
        if (ss.data) setPayable(ss.data as any)
        const day = todayEAT()
        const pr = await supabase.rpc('report_profit', { p_from: day, p_to: day, p_branch: null })
        if (pr.data) setProfit(pr.data)
        loadEtims()
      }
    })()
  }, [])

  const name = (session?.user.user_metadata?.full_name as string | undefined)?.split(' ')[0] ?? ''
  const daysLeft =
    sub?.trial_ends_at ? Math.max(0, Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / 86400000)) : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold">Hello{name ? `, ${name}` : ''}</h1>
        <p className="text-muted">You are signed in as {ROLE_LABEL[claims.tenant_role ?? ''] ?? 'staff'}.</p>
      </div>

      {canSeeBilling && sub?.status === 'trialing' && (
        <Link href="/billing">
          <Card className="border-brand/40 hover:border-brand/60">
            <div className="text-sm text-muted">Free trial · tap to pay and keep the till running</div>
            <div className="font-display text-2xl font-bold uppercase text-brand">
              {daysLeft} day{daysLeft === 1 ? '' : 's'} left
            </div>
            <div className="text-sm text-muted">Plan: {sub.plans?.name ?? 'Starter'} · pay with M-Pesa on the billing page</div>
          </Card>
        </Link>
      )}

      {canSeeBilling && etims && (etims.queued > 0 || etims.failed > 0) && (
        <Card className={etims.failed > 0 ? 'border-red-500/40' : 'border-brand/40'}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm text-muted">KRA eTIMS queue</div>
              <div className="text-lg font-bold">
                {etims.queued > 0 && <span className="text-brand">{etims.queued} waiting to be sent</span>}
                {etims.queued > 0 && etims.failed > 0 && <span className="text-muted"> · </span>}
                {etims.failed > 0 && <span className="text-red-300">{etims.failed} failed</span>}
              </div>
              <div className="text-xs text-muted">{etims.submitted} already sent to KRA</div>
            </div>
            <button
              type="button"
              onClick={transmitEtims}
              disabled={etimsBusy}
              className="rounded-lg border border-charcoal-3 px-4 py-2 text-sm font-semibold hover:bg-charcoal-3 disabled:opacity-50"
            >
              {etimsBusy ? 'Sending…' : 'Transmit now'}
            </button>
          </div>
          {etimsMessage && <p className="mt-2 text-xs text-muted">{etimsMessage}</p>}
        </Card>
      )}

      {canSeeBilling && profit && (
        <Link href="/reports">
          <Card className="hover:border-brand/60">
            <div className="text-sm text-muted">Profit today (after expenses)</div>
            <div className={`font-display text-5xl font-bold ${Number(profit.net_profit) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>KES {money(profit.net_profit)}</div>
            <div className="text-sm text-muted">Gross profit KES {money(profit.gross_profit)} · expenses KES {money(profit.expenses)} · tap for reports</div>
          </Card>
        </Link>
      )}

      {claims.tenant_role !== 'storekeeper' && (
        <Link href="/sales">
          <Card className="hover:border-brand/60">
            <div className="text-sm text-muted">{claims.tenant_role === 'cashier' ? 'Your sales today' : 'Sales today'}</div>
            <div className="font-display text-5xl font-bold text-brand">KES {money(today?.total ?? 0)}</div>
            <div className="text-sm text-muted">{today?.count ?? 0} sale{(today?.count ?? 0) === 1 ? '' : 's'}</div>
          </Card>
        </Link>
      )}

      {canSeeBilling && payable && payable.owed_count > 0 && (
        <Link href="/suppliers">
          <Card className="hover:border-brand/60">
            <div className="text-sm text-muted">You owe suppliers</div>
            <div className="font-display text-4xl font-bold">KES {money(payable.total_owed)}</div>
            <div className="text-sm text-muted">{payable.owed_count} supplier{payable.owed_count === 1 ? '' : 's'} · tap to see and pay</div>
          </Card>
        </Link>
      )}

      {canSeeBilling && owed && owed.owing_count > 0 && (
        <Link href="/customers/remind">
          <Card className="hover:border-brand/60">
            <div className="text-sm text-muted">Customers owe you</div>
            <div className="font-display text-4xl font-bold">KES {money(owed.total_owed)}</div>
            <div className="text-sm text-muted">{owed.owing_count} customer{owed.owing_count === 1 ? '' : 's'} · tap to send reminders</div>
          </Card>
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/inventory">
          <Card className="h-full hover:border-brand/60">
            <div className="text-sm text-muted">Products</div>
            <div className="font-display text-4xl font-bold">{counts.products}</div>
          </Card>
        </Link>
        <Link href="/inventory">
          <Card className={`h-full hover:border-brand/60 ${counts.low > 0 ? 'border-brand/40' : ''}`}>
            <div className="text-sm text-muted">Running low</div>
            <div className={`font-display text-4xl font-bold ${counts.low > 0 ? 'text-brand' : ''}`}>{counts.low}</div>
          </Card>
        </Link>
        <Card>
          <div className="text-sm text-muted">Branches</div>
          <div className="font-display text-4xl font-bold">{counts.branches}</div>
        </Card>
        {canSeeBilling && (
          <Card>
            <div className="text-sm text-muted">Staff</div>
            <div className="font-display text-4xl font-bold">{counts.staff}</div>
          </Card>
        )}
      </div>

      {canSeeBilling && (
        <Card>
          <h2 className="text-xl font-bold">Coming next</h2>
          <p className="mt-1 text-sm text-muted">
            KRA eTIMS receipt signing goes fully live once KRA onboards your devices — queued receipts send automatically when you are online. Need help? WhatsApp support.
          </p>
        </Card>
      )}
    </div>
  )
}
