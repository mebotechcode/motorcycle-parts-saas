'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Field, Select, Spinner } from '@/components/ui'
import { money } from '@/lib/pos'
import { uuid } from '@/lib/inventory'
import { lineSum, type PLine } from '@/lib/purchasing'
import ProductPicker from '@/components/purchasing/ProductPicker'

export default function ReceivePage() {
  const router = useRouter()
  const { claims } = useSession()
  const role = claims.tenant_role
  const manager = role === 'owner' || role === 'manager'
  const allowed = manager || role === 'storekeeper'

  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [openPos, setOpenPos] = useState<{ id: string; po_number: string; total: number }[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [poId, setPoId] = useState('')
  const [invoice, setInvoice] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<PLine[]>([])
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('mpesa')
  const [payRef, setPayRef] = useState('')
  const [key, setKey] = useState(() => uuid())
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // fill in last buying price and selling price for each line (for the price warnings)
  const enrich = useCallback(async (list: PLine[]) => {
    if (list.length === 0) return list
    const ids = list.map((l) => l.product_id)
    const [c, p] = await Promise.all([supabase.from('product_costs').select('product_id,cost_price').in('product_id', ids), supabase.from('products').select('id,selling_price').in('id', ids)])
    const costs: Record<string, number> = {}
    const sells: Record<string, number> = {}
    ;((c.data as any[]) ?? []).forEach((x) => (costs[x.product_id] = Number(x.cost_price)))
    ;((p.data as any[]) ?? []).forEach((x) => (sells[x.id] = Number(x.selling_price)))
    return list.map((l) => ({ ...l, last_cost: costs[l.product_id] ?? null, selling_price: sells[l.product_id] ?? null }))
  }, [])

  const loadPo = useCallback(
    async (pid: string) => {
      const o = await supabase.from('purchase_orders').select('id,supplier_id,branch_id').eq('id', pid).maybeSingle()
      if (!o.data) return
      const items = await supabase.from('purchase_order_items').select('id,product_id,qty_ordered,qty_received,unit_cost').eq('po_id', pid)
      const rows = ((items.data as any[]) ?? []).filter((i) => Number(i.qty_ordered) - Number(i.qty_received) > 0)
      const ids = rows.map((i) => i.product_id)
      const prods = ids.length ? await supabase.from('products').select('id,name,sku,unit').in('id', ids) : { data: [] }
      const pm: Record<string, any> = {}
      ;((prods.data as any[]) ?? []).forEach((p) => (pm[p.id] = p))
      const built: PLine[] = rows.map((i) => ({
        product_id: i.product_id,
        name: pm[i.product_id]?.name ?? 'Product',
        sku: pm[i.product_id]?.sku ?? '',
        unit: pm[i.product_id]?.unit ?? 'pc',
        qty: String(Number(i.qty_ordered) - Number(i.qty_received)),
        cost: String(Number(i.unit_cost)),
        last_cost: null,
        selling_price: null,
        po_item_id: i.id,
      }))
      setSupplierId((o.data as any).supplier_id)
      setBranchId((o.data as any).branch_id)
      setPoId(pid)
      setLines(await enrich(built))
    },
    [enrich]
  )

  useEffect(() => {
    ;(async () => {
      const [s, b] = await Promise.all([supabase.from('suppliers').select('id,name').eq('is_active', true).order('name'), supabase.from('branches').select('id,name').eq('is_active', true).order('name')])
      const mine = ((b.data as any[]) ?? []).filter((x) => claims.all_branches || (claims.branch_ids ?? []).includes(x.id))
      setSuppliers((s.data as any[]) ?? [])
      setBranches(mine)
      setBranchId((cur) => cur || mine[0]?.id || '')
      const q = new URLSearchParams(window.location.search)
      if (q.get('po')) await loadPo(q.get('po')!)
      else if (q.get('supplier')) setSupplierId(q.get('supplier')!)
      setReady(true)
    })()
  }, [claims.all_branches, claims.branch_ids, loadPo])

  // open orders of the chosen supplier
  useEffect(() => {
    if (!supplierId) {
      setOpenPos([])
      return
    }
    supabase
      .from('purchase_orders')
      .select('id,po_number,total')
      .eq('supplier_id', supplierId)
      .in('status', ['ordered', 'partially_received'])
      .order('created_at', { ascending: false })
      .then(({ data }) => setOpenPos((data as any[]) ?? []))
  }, [supplierId])

  if (!allowed) return <Alert kind="info">Only the owner, managers and storekeepers can receive goods.</Alert>
  if (!ready) return <Spinner />

  const total = Math.round(lines.reduce((s, l) => s + lineSum(l), 0) * 100) / 100
  const paying = Math.max(0, Number(payAmount || 0))
  const setLine = (pid: string, patch: Partial<PLine>) => setLines((prev) => prev.map((l) => (l.product_id === pid ? { ...l, ...patch } : l)))

  const warn = (l: PLine) => {
    const c = Number(l.cost || 0)
    if (c > 0 && l.selling_price !== null && c >= l.selling_price) return { text: 'Buying price is at or above your selling price: no profit', bad: true }
    if (c > 0 && l.last_cost && c > l.last_cost * 1.05) return { text: `Price up ${Math.round(((c - l.last_cost) / l.last_cost) * 100)}% (was ${money(l.last_cost)})`, bad: false }
    if (c > 0 && l.last_cost && c < l.last_cost * 0.95) return { text: `Price down ${Math.round(((l.last_cost - c) / l.last_cost) * 100)}% (was ${money(l.last_cost)})`, bad: false }
    return null
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!supplierId) return setError('Choose the supplier')
    if (!branchId) return setError('Choose the branch')
    if (lines.length === 0) return setError('Add the items you received')
    if (lines.some((l) => !(Number(l.qty) > 0))) return setError('Every item needs a quantity')
    if (paying > total + 0.001) return setError('The payment is more than the goods total')
    setBusy(true)
    const { data, error } = await supabase.rpc('receive_goods', {
      p_data: {
        supplier_id: supplierId,
        branch_id: branchId,
        po_id: poId || null,
        supplier_invoice_no: invoice,
        notes,
        client_uuid: key,
        items: lines.map((l) => ({ product_id: l.product_id, qty: Number(l.qty), unit_cost: Number(l.cost || 0), po_item_id: l.po_item_id ?? null })),
        payment: manager && paying > 0 ? { method: payMethod, amount: paying, reference: payRef || null } : null,
      },
    })
    setBusy(false)
    if (error) return setError(error.message)
    router.push(`/purchases/receipts/${(data as any).receipt_id}`)
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Link href="/purchases" className="text-sm text-muted hover:text-offwhite">
        ← Purchases
      </Link>
      <div>
        <h1 className="text-4xl font-bold">Receive goods</h1>
        <p className="text-sm text-muted">Record a delivery. Stock goes up, your buying prices are updated, and the amount is added to what you owe the supplier.</p>
      </div>

      {error && <Alert>{error}</Alert>}

      <Card className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Supplier" value={supplierId} disabled={!!poId} onChange={(e) => { setSupplierId(e.target.value); setPoId(''); setLines([]) }}>
            <option value="">Choose supplier...</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select label="Received at branch" value={branchId} disabled={!!poId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
        {supplierId && (
          <Select
            label="Is this against an order?"
            value={poId}
            onChange={(e) => {
              if (e.target.value) loadPo(e.target.value)
              else {
                setPoId('')
                setLines([])
              }
            }}
          >
            <option value="">No order (a delivery without an order)</option>
            {openPos.map((o) => (
              <option key={o.id} value={o.id}>
                {o.po_number} · KES {money(o.total)}
              </option>
            ))}
          </Select>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier invoice / delivery note no." value={invoice} onChange={(e) => setInvoice(e.target.value)} />
          <Field label="Note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-xl font-bold">What arrived</h2>
        <ProductPicker onPick={(p) => setLines((prev) => (prev.find((l) => l.product_id === p.id) ? prev : [...prev, { product_id: p.id, name: p.name, sku: p.sku, unit: p.unit, qty: '1', cost: String(p.last_cost ?? 0), last_cost: p.last_cost, selling_price: p.selling_price }]))} placeholder="Search a product to add" />
        {lines.length === 0 ? (
          <p className="text-sm text-muted">No items yet. Pick an order above, or search products.</p>
        ) : (
          <div className="space-y-2">
            {lines.map((l) => {
              const w = warn(l)
              return (
                <div key={l.product_id} className="rounded-xl border border-charcoal-3 bg-charcoal p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1 basis-44">
                      <div className="truncate font-semibold">{l.name}</div>
                      <div className="text-xs text-muted">{l.sku}</div>
                    </div>
                    <label className="block w-20">
                      <span className="block text-[11px] text-muted">Qty received</span>
                      <input value={l.qty} inputMode="decimal" onChange={(e) => setLine(l.product_id, { qty: e.target.value })} className="w-full rounded-lg border border-charcoal-3 bg-charcoal-2 px-2 py-1.5" />
                    </label>
                    <label className="block w-28">
                      <span className="block text-[11px] text-muted">Cost each</span>
                      <input value={l.cost} inputMode="decimal" onChange={(e) => setLine(l.product_id, { cost: e.target.value })} className="w-full rounded-lg border border-charcoal-3 bg-charcoal-2 px-2 py-1.5" />
                    </label>
                    <div className="w-24 text-right font-display text-lg font-bold">{money(lineSum(l))}</div>
                    <button type="button" onClick={() => setLines(lines.filter((x) => x.product_id !== l.product_id))} className="text-muted hover:text-red-300" aria-label="Remove">
                      ×
                    </button>
                  </div>
                  {w && <div className={`mt-1 text-xs ${w.bad ? 'text-red-300' : 'text-brand'}`}>{w.text}</div>}
                </div>
              )
            })}
          </div>
        )}
        <div className="flex justify-between border-t border-charcoal-3 pt-3 text-lg font-bold">
          <span>Goods total</span>
          <span className="font-display text-3xl text-brand">KES {money(total)}</span>
        </div>
      </Card>

      {manager && (
        <Card className="space-y-3">
          <h2 className="text-xl font-bold">Pay now (optional)</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Amount paid now (KES)" type="number" inputMode="decimal" min={0} step="any" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            <Select label="Paid by" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              <option value="mpesa">M-Pesa</option>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
              <option value="other">Other</option>
            </Select>
            <Field label="Reference" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="ghost" onClick={() => setPayAmount(String(total))}>
              Pay in full
            </Button>
            <span className="text-sm text-muted">
              You will owe the supplier <b className="text-offwhite">KES {money(Math.max(0, total - paying))}</b> for this delivery.
            </span>
          </div>
        </Card>
      )}

      <Button type="submit" disabled={busy} className="w-full py-3 text-lg sm:w-auto">
        {busy ? 'Saving...' : 'Save delivery and add to stock'}
      </Button>
    </form>
  )
}
