'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Card, Select, Spinner } from '@/components/ui'
import { money } from '@/lib/pos'

type Sale = {
  id: string
  receipt_no: string
  sold_at: string
  total: number
  amount_paid: number
  balance_due: number
  status: string
  customer_id: string | null
  cashier_id: string
  branch_id: string
  is_offline: boolean
  offline_flags: string[]
  reviewed_at: string | null
}

const BADGE: Record<string, string> = {
  completed: '',
  voided: 'bg-red-500/15 text-red-300',
  partially_returned: 'bg-brand/15 text-brand',
  returned: 'bg-brand/15 text-brand',
  held: 'bg-charcoal-3 text-muted',
}
const LABEL: Record<string, string> = {
  completed: 'Completed',
  voided: 'Cancelled',
  partially_returned: 'Part returned',
  returned: 'Returned',
  held: 'On hold',
}

function range(period: string) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const day = 86400000
  if (period === 'today') return [start, new Date(start.getTime() + day)]
  if (period === 'yesterday') return [new Date(start.getTime() - day), start]
  if (period === '7days') return [new Date(start.getTime() - 6 * day), new Date(start.getTime() + day)]
  if (period === 'month') return [new Date(start.getFullYear(), start.getMonth(), 1), new Date(start.getTime() + day)]
  return [new Date(2000, 0, 1), new Date(start.getTime() + day)]
}

export default function SalesPage() {
  const { claims } = useSession()
  const role = claims.tenant_role
  const [period, setPeriod] = useState('today')
  const [text, setText] = useState('')
  const [review, setReview] = useState(false)
  const [rows, setRows] = useState<Sale[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [sum, setSum] = useState<{ count: number; total: number; credit: number } | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    const [from, to] = range(period)
    let q = supabase
      .from('sales')
      .select('id,receipt_no,sold_at,total,amount_paid,balance_due,status,customer_id,cashier_id,branch_id,is_offline,offline_flags,reviewed_at')
      .gte('sold_at', from.toISOString())
      .lt('sold_at', to.toISOString())
      .order('sold_at', { ascending: false })
      .limit(60)
    const s = text.trim().replace(/[,()%*\\]/g, ' ').trim()
    if (s) q = q.ilike('receipt_no', `%${s}%`)
    if (review) q = q.neq('offline_flags', '{}').is('reviewed_at', null)
    const [res, summary] = await Promise.all([q, supabase.rpc('sales_summary', { p_from: from.toISOString(), p_to: to.toISOString() })])
    if (res.error) setError(res.error.message)
    const list = (res.data as Sale[]) ?? []
    setRows(list)
    setSum((summary.data as any) ?? null)

    const map: Record<string, string> = {}
    const cust = Array.from(new Set(list.map((x) => x.customer_id).filter(Boolean))) as string[]
    const cash = Array.from(new Set(list.map((x) => x.cashier_id))) as string[]
    const [c, p] = await Promise.all([
      cust.length ? supabase.from('customers').select('id,name').in('id', cust) : Promise.resolve({ data: [] }),
      cash.length ? supabase.from('profiles').select('id,full_name').in('id', cash) : Promise.resolve({ data: [] }),
    ])
    ;((c.data as any[]) ?? []).forEach((x) => (map['c' + x.id] = x.name))
    ;((p.data as any[]) ?? []).forEach((x) => (map['u' + x.id] = x.full_name || 'Staff'))
    setNames(map)
  }, [period, text, review])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  if (role === 'storekeeper') return <Alert kind="info">Storekeepers cannot see sales.</Alert>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold">Sales</h1>
          <p className="text-sm text-muted">{role === 'cashier' ? 'Your sales' : 'All sales you can access'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/expenses" className="rounded-lg border border-charcoal-3 px-4 py-2.5 text-sm font-semibold hover:bg-charcoal-3">
            Expenses
          </Link>
          <Link href="/till" className="rounded-lg border border-charcoal-3 px-4 py-2.5 text-sm font-semibold hover:bg-charcoal-3">
            Till / cash-up
          </Link>
          <Link href="/sell" className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-charcoal hover:bg-brand-hover">
            + New sale
          </Link>
        </div>
      </div>

      <Card className="grid gap-3 sm:grid-cols-2">
        <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="7days">Last 7 days</option>
          <option value="month">This month</option>
          <option value="all">All time</option>
        </Select>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Find a receipt number"
          className="w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2.5 placeholder:text-muted/60 focus:border-brand focus:outline-none"
        />
      </Card>

      {(role === 'owner' || role === 'manager') && (
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} className="h-4 w-4 accent-[#FF5B14]" />
          Only sales that need a check (made offline and broke a rule)
        </label>
      )}

      {sum && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <div className="text-xs text-muted">Sales</div>
            <div className="font-display text-3xl font-bold">{sum.count}</div>
          </Card>
          <Card>
            <div className="text-xs text-muted">Total</div>
            <div className="font-display text-2xl font-bold text-brand sm:text-3xl">KES {money(sum.total)}</div>
          </Card>
          <Card>
            <div className="text-xs text-muted">On credit</div>
            <div className="font-display text-2xl font-bold sm:text-3xl">KES {money(sum.credit)}</div>
          </Card>
        </div>
      )}

      {error && <Alert>{error}</Alert>}

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-muted">No sales found.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((s) => (
            <Link key={s.id} href={`/sales/${s.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-charcoal-3 bg-charcoal-2 p-3 hover:border-brand/60">
              <div className="min-w-0">
                <div className="font-semibold">{s.receipt_no}</div>
                <div className="text-xs text-muted">
                  {new Date(s.sold_at).toLocaleString('en-KE')} · {names['u' + s.cashier_id] ?? 'Staff'}
                  {s.customer_id ? ` · ${names['c' + s.customer_id] ?? 'Customer'}` : ''}
                </div>
              </div>
              <div className="text-right">
                <div className={`font-display text-xl font-bold ${s.status === 'voided' ? 'text-muted line-through' : ''}`}>KES {money(s.total)}</div>
                <div className="flex justify-end gap-1.5 text-xs">
                  {Number(s.balance_due) > 0 && s.status !== 'voided' && <span className="rounded bg-brand/15 px-1.5 py-0.5 text-brand">Owes {money(s.balance_due)}</span>}
                  {s.is_offline && <span className="rounded bg-charcoal-3 px-1.5 py-0.5 text-muted">Offline</span>}
                  {s.offline_flags?.length > 0 && !s.reviewed_at && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-red-300">Check</span>}
                  {BADGE[s.status] && <span className={`rounded px-1.5 py-0.5 ${BADGE[s.status]}`}>{LABEL[s.status]}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
