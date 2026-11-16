'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Field, Select, Spinner } from '@/components/ui'
import { money, waNumber } from '@/lib/pos'
import { qty as fmtQty } from '@/lib/inventory'
import { PO_STATUS, lineSum, type PLine } from '@/lib/purchasing'
import ProductPicker from '@/components/purchasing/ProductPicker'

export default function OrderPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { claims } = useSession()
  const allowed = ['owner', 'manager', 'storekeeper'].includes(claims.tenant_role ?? '')
  const isNew = id === 'new'

  const [suppliers, setSuppliers] = useState<{ id: string; name: string; phone: string | null }[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [expected, setExpected] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<PLine[]>([])
  const [po, setPo] = useState<any>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const load = useCallback(async () => {
    const [s, b] = await Promise.all([supabase.from('suppliers').select('id,name,phone').eq('is_active', true).order('name'), supabase.from('branches').select('id,name').eq('is_active', true).order('name')])
    const mine = ((b.data as any[]) ?? []).filter((x) => claims.all_branches || (claims.branch_ids ?? []).includes(x.id))
    setSuppliers((s.data as any[]) ?? [])
    setBranches(mine)

    if (isNew) {
      const pre = new URLSearchParams(window.location.search).get('supplier')
      if (pre) setSupplierId(pre)
      setBranchId((cur) => cur || mine[0]?.id || '')
      setReady(true)
      return
    }
    const o = await supabase.from('purchase_orders').select('*').eq('id', id).maybeSingle()
    if (!o.data) return setReady(true)
    const items = await supabase.from('purchase_order_items').select('id,product_id,qty_ordered,qty_received,unit_cost').eq('po_id', id)
    const ids = ((items.data as any[]) ?? []).map((i) => i.product_id)
    const prods = ids.length ? await supabase.from('products').select('id,name,sku,unit').in('id', ids) : { data: [] }
    const pm: Record<string, any> = {}
    ;((prods.data as any[]) ?? []).forEach((p) => (pm[p.id] = p))
    setPo(o.data)
    setSupplierId((o.data as any).supplier_id)
    setBranchId((o.data as any).branch_id)
    setExpected((o.data as any).expected_date ?? '')
    setNotes((o.data as any).notes ?? '')
    setLines(
      ((items.data as any[]) ?? []).map((i) => ({
        product_id: i.product_id,
        name: pm[i.product_id]?.name ?? 'Product',
        sku: pm[i.product_id]?.sku ?? '',
        unit: pm[i.product_id]?.unit ?? 'pc',
        qty: String(Number(i.qty_ordered)),
        cost: String(Number(i.unit_cost)),
        last_cost: null,
        selling_price: null,
        po_item_id: i.id,
        ordered: Number(i.qty_received),
      }))
    )
    setReady(true)
  }, [id, isNew, claims.all_branches, claims.branch_ids])

  useEffect(() => {
    load()
  }, [load])

  if (!allowed) return <Alert kind="info">Only the owner, managers and storekeepers can make purchase orders.</Alert>
  if (!ready) return <Spinner />
  if (!isNew && !po) return <Alert kind="info">Order not found.</Alert>

  const editable = isNew || po.status === 'draft' || po.status === 'ordered'
  const supplier = suppliers.find((s) => s.id === supplierId)
  const total = Math.round(lines.reduce((s, l) => s + lineSum(l), 0) * 100) / 100

  const setLine = (pid: string, patch: Partial<PLine>) => setLines((prev) => prev.map((l) => (l.product_id === pid ? { ...l, ...patch } : l)))

  function addLine(p: { id: string; name: string; sku: string; unit: string; last_cost: number | null; selling_price: number }, qty = '1') {
    setLines((prev) => (prev.find((l) => l.product_id === p.id) ? prev : [...prev, { product_id: p.id, name: p.name, sku: p.sku, unit: p.unit, qty, cost: String(p.last_cost ?? 0), last_cost: p.last_cost, selling_price: p.selling_price }]))
  }

  async function addLowStock() {
    setError('')
    const { data } = await supabase.from('product_overview').select('id,name,sku,unit,selling_price,stock_qty,reorder_level').eq('is_active', true).is('deleted_at', null).eq('track_stock', true).or('is_low.eq.true,is_out.eq.true').order('name').limit(60)
    const rows = (data as any[]) ?? []
    if (rows.length === 0) return setInfo('Nothing is running low right now.')
    const c = await supabase.from('product_costs').select('product_id,cost_price').in('product_id', rows.map((r) => r.id))
    const costs: Record<string, number> = {}
    ;((c.data as any[]) ?? []).forEach((x) => (costs[x.product_id] = Number(x.cost_price)))
    rows.forEach((r) => addLine({ id: r.id, name: r.name, sku: r.sku, unit: r.unit, last_cost: costs[r.id] ?? null, selling_price: Number(r.selling_price) }, String(Math.max(1, Math.ceil(Number(r.reorder_level) * 2 - Number(r.stock_qty))))))
    setInfo(`Added ${rows.length} running-low item${rows.length === 1 ? '' : 's'}. Check the quantities.`)
  }

  async function save(status: 'draft' | 'ordered') {
    setError('')
    setInfo('')
    if (!supplierId) return setError('Choose a supplier')
    if (lines.length === 0) return setError('Add at least one item')
    if (lines.some((l) => !(Number(l.qty) > 0))) return setError('Every item needs a quantity')
    setBusy(status)
    const { data, error } = await supabase.rpc('save_purchase_order', {
      p_id: isNew ? null : id,
      p_data: { supplier_id: supplierId, branch_id: branchId, expected_date: expected || null, notes, status, items: lines.map((l) => ({ product_id: l.product_id, qty: Number(l.qty), unit_cost: Number(l.cost || 0) })) },
    })
    setBusy('')
    if (error) return setError(error.message)
    if (isNew) router.replace(`/purchases/order/${data}`)
    else {
      setInfo(status === 'ordered' ? 'Saved and marked as ordered.' : 'Saved as a draft.')
      await load()
    }
  }

  async function cancel() {
    if (!window.confirm('Cancel this order?')) return
    setBusy('cancel')
    const { error } = await supabase.rpc('cancel_purchase_order', { p_id: id })
    setBusy('')
    if (error) return setError(error.message)
    await load()
  }

  const waText = `Order ${po?.po_number ?? ''}\n` + lines.map((l) => `${l.name} x${l.qty}`).join('\n') + `\nTotal: KES ${money(total)}`

  return (
    <div className="space-y-5">
      <Link href="/purchases" className="text-sm text-muted hover:text-offwhite">
        ← Purchases
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-4xl font-bold">{isNew ? 'New order' : po.po_number}</h1>
        {!isNew && <span className={`rounded px-2 py-0.5 text-sm ${PO_STATUS[po.status]?.cls}`}>{PO_STATUS[po.status]?.label}</span>}
      </div>

      {error && <Alert>{error}</Alert>}
      {info && <Alert kind="success">{info}</Alert>}

      <Card className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Supplier" value={supplierId} disabled={!editable} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Choose supplier...</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select label="Goods are for branch" value={branchId} disabled={!editable} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Field label="Expected on" type="date" value={expected} disabled={!editable} onChange={(e) => setExpected(e.target.value)} />
          <Field label="Note (optional)" value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {suppliers.length === 0 && (
          <Alert kind="info">
            You have no suppliers yet.{' '}
            <Link href="/suppliers" className="underline">
              Add one first
            </Link>
            .
          </Alert>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-xl font-bold">Items</h2>
        {editable && (
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-[14rem] flex-1">
              <ProductPicker onPick={(p) => addLine(p)} />
            </div>
            <Button variant="ghost" onClick={addLowStock}>
              Add running-low items
            </Button>
          </div>
        )}

        {lines.length === 0 ? (
          <p className="text-sm text-muted">No items yet.</p>
        ) : (
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.product_id} className="flex flex-wrap items-center gap-3 rounded-xl border border-charcoal-3 bg-charcoal p-3">
                <div className="min-w-0 flex-1 basis-44">
                  <div className="truncate font-semibold">{l.name}</div>
                  <div className="text-xs text-muted">
                    {l.sku}
                    {l.last_cost !== null && <> · last cost KES {money(l.last_cost)}</>}
                    {!isNew && !editable && <> · received {fmtQty(l.ordered ?? 0)}</>}
                  </div>
                </div>
                <label className="block w-20">
                  <span className="block text-[11px] text-muted">Qty</span>
                  <input value={l.qty} disabled={!editable} inputMode="decimal" onChange={(e) => setLine(l.product_id, { qty: e.target.value })} className="w-full rounded-lg border border-charcoal-3 bg-charcoal-2 px-2 py-1.5 disabled:opacity-60" />
                </label>
                <label className="block w-28">
                  <span className="block text-[11px] text-muted">Cost each</span>
                  <input value={l.cost} disabled={!editable} inputMode="decimal" onChange={(e) => setLine(l.product_id, { cost: e.target.value })} className="w-full rounded-lg border border-charcoal-3 bg-charcoal-2 px-2 py-1.5 disabled:opacity-60" />
                </label>
                <div className="w-24 text-right font-display text-lg font-bold">{money(lineSum(l))}</div>
                {editable && (
                  <button type="button" onClick={() => setLines(lines.filter((x) => x.product_id !== l.product_id))} className="text-muted hover:text-red-300" aria-label="Remove">
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-between border-t border-charcoal-3 pt-3 text-lg font-bold">
          <span>Total</span>
          <span className="font-display text-3xl text-brand">KES {money(total)}</span>
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        {editable && (
          <>
            <Button variant="ghost" onClick={() => save('draft')} disabled={!!busy}>
              {busy === 'draft' ? 'Saving...' : 'Save as draft'}
            </Button>
            <Button onClick={() => save('ordered')} disabled={!!busy}>
              {busy === 'ordered' ? 'Saving...' : 'Save and mark as ordered'}
            </Button>
          </>
        )}
        {!isNew && (po.status === 'ordered' || po.status === 'partially_received') && (
          <Link href={`/purchases/receive?po=${id}`} className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-charcoal hover:bg-brand-hover">
            Receive goods
          </Link>
        )}
        {!isNew && supplier?.phone && (
          <a href={`https://wa.me/${waNumber(supplier.phone)}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noreferrer" className="rounded-lg border border-charcoal-3 px-4 py-2.5 text-sm font-semibold hover:bg-charcoal-3">
            Send order on WhatsApp
          </a>
        )}
        {!isNew && (po.status === 'draft' || po.status === 'ordered') && (
          <Button variant="danger" onClick={cancel} disabled={!!busy}>
            Cancel order
          </Button>
        )}
      </div>
    </div>
  )
}
