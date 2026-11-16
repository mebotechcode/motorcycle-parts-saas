'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Spinner } from '@/components/ui'
import { money } from '@/lib/pos'
import { qty as fmtQty } from '@/lib/inventory'

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>()
  const { claims } = useSession()
  const manager = claims.tenant_role === 'owner' || claims.tenant_role === 'manager'
  const [r, setR] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [info, setInfo] = useState<{ supplier: string; branch: string; by: string; po: string | null; poId: string | null }>({ supplier: '', branch: '', by: '', po: null, poId: null })
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')

  useEffect(() => {
    ;(async () => {
      const g = await supabase.from('goods_receipts').select('*').eq('id', id).maybeSingle()
      if (!g.data) return setState('missing')
      const rec = g.data as any
      const it = await supabase.from('goods_receipt_items').select('id,product_id,quantity,unit_cost').eq('receipt_id', id)
      const list = (it.data as any[]) ?? []
      const [s, b, p, po, pr] = await Promise.all([
        supabase.from('suppliers').select('name').eq('id', rec.supplier_id).maybeSingle(),
        supabase.from('branches').select('name').eq('id', rec.branch_id).maybeSingle(),
        list.length ? supabase.from('products').select('id,name,sku,unit').in('id', list.map((x) => x.product_id)) : Promise.resolve({ data: [] }),
        rec.po_id ? supabase.from('purchase_orders').select('po_number').eq('id', rec.po_id).maybeSingle() : Promise.resolve({ data: null }),
        rec.received_by ? supabase.from('profiles').select('full_name').eq('id', rec.received_by).maybeSingle() : Promise.resolve({ data: null }),
      ])
      const pm: Record<string, any> = {}
      ;((p.data as any[]) ?? []).forEach((x) => (pm[x.id] = x))
      setItems(list.map((x) => ({ ...x, ...pm[x.product_id] })))
      setInfo({ supplier: (s.data as any)?.name ?? '', branch: (b.data as any)?.name ?? '', by: (pr.data as any)?.full_name ?? '', po: (po.data as any)?.po_number ?? null, poId: rec.po_id })
      setR(rec)
      setState('ready')
    })()
  }, [id])

  if (state === 'loading') return <Spinner />
  if (state === 'missing') return <Alert kind="info">Delivery not found.</Alert>

  const due = Number(r.total) - Number(r.amount_paid)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/purchases" className="text-sm text-muted hover:text-offwhite">
          ← Purchases
        </Link>
        <Button variant="ghost" onClick={() => window.print()}>
          Print
        </Button>
      </div>

      <Alert kind="success">Delivery saved. The stock was updated and your buying prices are now the latest ones.</Alert>

      <Card className="space-y-4 print:border-0 print:bg-white print:text-black">
        <div>
          <h1 className="text-3xl font-bold">Goods received</h1>
          <p className="text-sm text-muted">
            {info.supplier} · {info.branch} · {new Date(r.received_at).toLocaleString('en-KE')}
            {info.by ? ` · by ${info.by}` : ''}
          </p>
          <p className="text-xs text-muted">
            GRN-{String(r.id).slice(0, 8).toUpperCase()}
            {r.supplier_invoice_no ? ` · Invoice ${r.supplier_invoice_no}` : ''}
            {info.po && (
              <>
                {' '}
                ·{' '}
                <Link href={`/purchases/order/${info.poId}`} className="text-brand hover:underline print:hidden">
                  {info.po}
                </Link>
              </>
            )}
          </p>
        </div>

        <div className="divide-y divide-charcoal-3">
          {items.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-semibold">{i.name}</div>
                <div className="text-xs text-muted">{i.sku}</div>
              </div>
              <div className="text-right">
                {fmtQty(i.quantity)} {i.unit} × {money(i.unit_cost)} = <b>{money(Number(i.quantity) * Number(i.unit_cost))}</b>
              </div>
            </div>
          ))}
        </div>

        {manager && (
          <div className="space-y-1 border-t border-charcoal-3 pt-3 text-sm">
            <div className="flex justify-between text-lg font-bold">
              <span>Total</span>
              <span>KES {money(r.total)}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span>Paid now</span>
              <span>KES {money(r.amount_paid)}</span>
            </div>
            {due > 0 && (
              <div className="flex justify-between font-bold text-brand">
                <span>Added to what you owe</span>
                <span>KES {money(due)}</span>
              </div>
            )}
          </div>
        )}
        {r.notes && <p className="text-sm text-muted">Note: {r.notes}</p>}
      </Card>

      <div className="flex flex-wrap gap-2 print:hidden">
        <Link href={`/suppliers/${r.supplier_id}`} className="rounded-lg border border-charcoal-3 px-4 py-2.5 text-sm font-semibold hover:bg-charcoal-3">
          Supplier page
        </Link>
        <Link href="/purchases/receive" className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-charcoal hover:bg-brand-hover">
          Receive another delivery
        </Link>
      </div>
    </div>
  )
}
