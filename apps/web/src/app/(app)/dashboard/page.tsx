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
  const canSeeBilling = claims.tenant_role === 'owner' || claims.tenant_role === 'manager'

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
        <Card className="border-brand/40">
          <div className="text-sm text-muted">Free trial</div>
          <div className="font-display text-2xl font-bold uppercase text-brand">
            {daysLeft} day{daysLeft === 1 ? '' : 's'} left
          </div>
          <div className="text-sm text-muted">Plan: {sub.plans?.name ?? 'Starter'}</div>
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

      <Card>
        <h2 className="text-xl font-bold">Coming next</h2>
        <p className="mt-1 text-sm text-muted">
          Expenses and daily cash-up reports, then profit reports and KRA eTIMS receipts.
        </p>
      </Card>
    </div>
  )
}
