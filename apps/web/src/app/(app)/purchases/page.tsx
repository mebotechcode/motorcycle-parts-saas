'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Card, Select, Spinner } from '@/components/ui'
import { money } from '@/lib/pos'
import { canEditInventory } from '@/lib/inventory'
import { PO_STATUS } from '@/lib/purchasing'

export default function PurchasesPage() {
  const { claims } = useSession()
  const role = claims.tenant_role
  const manager = role === 'owner' || role === 'manager'

  const [tab, setTab] = useState<'orders' | 'received'>('orders')
  const [status, setStatus] = useState('open')
  const [orders, setOrders] = useState<any[] | null>(null)
  const [receipts, setReceipts] = useState<any[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [owed, setOwed] = useState<any>(null)

  const load = useCallback(async () => {
    setError('')
    const sup = await supabase.from('suppliers').select('id,name')
    const m: Record<string, string> = {}
    ;((sup.data as any[]) ?? []).forEach((x) => (m[x.id] = x.name))
    setNames(m)

    if (tab === 'orders') {
      let q = supabase.from('purchase_orders').select('id,po_number,supplier_id,status,total,expected_date,created_at').order('created_at', { ascending: false }).limit(60)
      if (status === 'open') q = q.in('status', ['draft', 'ordered', 'partially_received'])
      else if (status !== 'all') q = q.eq('status', status)
      const { data, error } = await q
      if (error) setError(error.message)
      setOrders((data as any[]) ?? [])
    } else {
      const { data, error } = await supabase.from('goods_receipts').select('id,supplier_id,supplier_invoice_no,received_at,total,amount_paid').order('received_at', { ascending: false }).limit(60)
      if (error) setError(error.message)
      setReceipts((data as any[]) ?? [])
    }
  }, [tab, status])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (manager) supabase.rpc('suppliers_summary').then(({ data }) => setOwed(data))
  }, [manager])

  if (!canEditInventory(role)) return <Alert kind="info">Only the owner, managers and storekeepers can see purchases.</Alert>

  const tabBtn = (t: 'orders' | 'received', label: string) => (
    <button type="button" onClick={() => setTab(t)} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === t ? 'bg-brand text-charcoal' : 'border border-charcoal-3 text-muted hover:bg-charcoal-3'}`}>
      {label}
    </button>
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold">Purchases</h1>
          <p className="text-sm text-muted">Order from suppliers and receive the goods.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/suppliers" className="rounded-lg border border-charcoal-3 px-4 py-2.5 text-sm font-semibold hover:bg-charcoal-3">
            Suppliers
          </Link>
          <Link href="/purchases/order/new" className="rounded-lg border border-charcoal-3 px-4 py-2.5 text-sm font-semibold hover:bg-charcoal-3">
            + New order
          </Link>
          <Link href="/purchases/receive" className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-charcoal hover:bg-brand-hover">
            Receive goods
          </Link>
        </div>
      </div>

      {manager && owed && Number(owed.total_owed) > 0 && (
        <Link href="/suppliers">
          <Card className="hover:border-brand/60">
            <div className="text-sm text-muted">You owe suppliers</div>
            <div className="font-display text-4xl font-bold text-brand">KES {money(owed.total_owed)}</div>
            <div className="text-xs text-muted">{owed.owed_count} supplier{owed.owed_count === 1 ? '' : 's'} · tap to see and pay</div>
          </Card>
        </Link>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {tabBtn('orders', 'Orders')}
        {tabBtn('received', 'Deliveries received')}
        {tab === 'orders' && (
          <div className="ml-auto w-44">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="open">Open orders</option>
              <option value="received">Received</option>
              <option value="cancelled">Cancelled</option>
              <option value="all">All</option>
            </Select>
          </div>
        )}
      </div>

      {error && <Alert>{error}</Alert>}

      {tab === 'orders' ? (
        orders === null ? (
          <Spinner />
        ) : orders.length === 0 ? (
          <Card>
            <p className="text-muted">No orders here.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <Link key={o.id} href={`/purchases/order/${o.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-charcoal-3 bg-charcoal-2 p-3 hover:border-brand/60">
                <div className="min-w-0">
                  <div className="font-semibold">{o.po_number}</div>
                  <div className="text-xs text-muted">
                    {names[o.supplier_id] ?? 'Supplier'} · {new Date(o.created_at).toLocaleDateString('en-KE')}
                    {o.expected_date ? ` · expected ${new Date(o.expected_date).toLocaleDateString('en-KE')}` : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-xl font-bold">KES {money(o.total)}</div>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${PO_STATUS[o.status]?.cls}`}>{PO_STATUS[o.status]?.label ?? o.status}</span>
                </div>
              </Link>
            ))}
          </div>
        )
      ) : receipts === null ? (
        <Spinner />
      ) : receipts.length === 0 ? (
        <Card>
          <p className="text-muted">No deliveries received yet.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {receipts.map((r) => (
            <Link key={r.id} href={`/purchases/receipts/${r.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-charcoal-3 bg-charcoal-2 p-3 hover:border-brand/60">
              <div className="min-w-0">
                <div className="font-semibold">{names[r.supplier_id] ?? 'Supplier'}</div>
                <div className="text-xs text-muted">
                  {new Date(r.received_at).toLocaleDateString('en-KE')}
                  {r.supplier_invoice_no ? ` · Invoice ${r.supplier_invoice_no}` : ''}
                </div>
              </div>
              <div className="text-right">
                <div className="font-display text-xl font-bold">KES {money(r.total)}</div>
                {Number(r.total) - Number(r.amount_paid) > 0 && <div className="text-xs text-brand">Unpaid KES {money(Number(r.total) - Number(r.amount_paid))}</div>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
