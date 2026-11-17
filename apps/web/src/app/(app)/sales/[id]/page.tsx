'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Field, Select, Spinner } from '@/components/ui'
import Receipt from '@/components/pos/Receipt'
import { receiptText, thermalReceiptText, waNumber } from '@/lib/pos'

export default function SalePage() {
  const { id } = useParams<{ id: string }>()
  const { claims } = useSession()
  const canManage = claims.tenant_role === 'owner' || claims.tenant_role === 'manager'

  const [state, setState] = useState<'loading' | 'missing' | 'ready'>('loading')
  const [sale, setSale] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [returns, setReturns] = useState<any[]>([])
  const [tenant, setTenant] = useState<any>(null)
  const [branch, setBranch] = useState<any>(null)
  const [customer, setCustomer] = useState<any>(null)
  const [cashier, setCashier] = useState('')
  const [isNew, setIsNew] = useState(false)

  const [panel, setPanel] = useState<'' | 'void' | 'return'>('')
  const [reason, setReason] = useState('')
  const [method, setMethod] = useState('cash')
  const [returnType, setReturnType] = useState('wrong_part')
  const [qtys, setQtys] = useState<Record<string, string>>({})
  const [restock, setRestock] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [copied, setCopied] = useState('')

  const load = useCallback(async () => {
    const s = await supabase.from('sales').select('*').eq('id', id).maybeSingle()
    if (!s.data) {
      setState('missing')
      return
    }
    const sl = s.data as any
    const [it, pay, ret, ten, br, cu, pr] = await Promise.all([
      supabase.from('sale_items').select('*').eq('sale_id', id),
      supabase.from('payments').select('*').eq('sale_id', id).order('paid_at'),
      supabase.from('sale_returns').select('id,return_no,total_refund,refund_method,reason,return_type,created_at').eq('sale_id', id),
      supabase.from('tenants').select('name,address,town,phone,kra_pin,receipt_footer').maybeSingle(),
      supabase.from('branches').select('name,phone').eq('id', sl.branch_id).maybeSingle(),
      sl.customer_id ? supabase.from('customers').select('name,phone').eq('id', sl.customer_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from('profiles').select('full_name').eq('id', sl.cashier_id).maybeSingle(),
    ])
    setSale(sl)
    setItems((it.data as any[]) ?? [])
    setPayments((pay.data as any[]) ?? [])
    setReturns((ret.data as any[]) ?? [])
    setTenant(ten.data)
    setBranch(br.data)
    setCustomer((cu as any).data)
    setCashier((pr.data as any)?.full_name ?? '')
    setState('ready')
  }, [id])

  useEffect(() => {
    setIsNew(new URLSearchParams(window.location.search).get('new') === '1')
    load()
  }, [load])

  if (state === 'loading') return <Spinner />
  if (state === 'missing') return <Alert kind="info">This sale was not found.</Alert>

  const text = receiptText({ shop: tenant?.name ?? '', sale, items, payments, customer: customer?.name })
  const wa = `https://wa.me/${waNumber(customer?.phone)}?text=${encodeURIComponent(text)}`
  async function copyThermal(width: 58 | 80) {
    const t58 = thermalReceiptText({ shop: tenant?.name ?? '', sale, items, payments, customer: customer?.name, width })
    try {
      await navigator.clipboard.writeText(t58)
      setCopied(`Copied ${width}mm receipt text — paste it into your Bluetooth printer app`)
    } catch {
      setCopied('Could not copy automatically — long-press and copy the text instead')
    }
    setTimeout(() => setCopied(''), 4000)
  }
  const returnable = items.filter((i) => Number(i.quantity) - Number(i.returned_qty) > 0)

  async function markReviewed() {
    setError('')
    setBusy(true)
    const { error } = await supabase.rpc('mark_sale_reviewed', { p_sale_id: id })
    setBusy(false)
    if (error) return setError(error.message)
    setInfo('Marked as checked.')
    await load()
  }

  async function doVoid(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { error } = await supabase.rpc('void_sale', { p_sale_id: id, p_reason: reason })
    setBusy(false)
    if (error) return setError(error.message)
    setPanel('')
    setReason('')
    setInfo('Sale cancelled. The items went back into stock.')
    await load()
  }

  async function doReturn(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const chosen = returnable
      .filter((i) => Number(qtys[i.id] || 0) > 0)
      .map((i) => ({ sale_item_id: i.id, qty: Number(qtys[i.id]), restock: restock[i.id] !== false }))
    if (chosen.length === 0) return setError('Enter how many of each item are being returned')
    setBusy(true)
    const { data, error } = await supabase.rpc('return_items', {
      p_sale_id: id,
      p_items: chosen,
      p_refund_method: method,
      p_reason: reason,
      p_return_type: returnType,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setPanel('')
    setReason('')
    setQtys({})
    setInfo(`Return ${(data as any).return_no} recorded. Refund: KES ${Number((data as any).refund).toLocaleString('en-KE')}.`)
    await load()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/sales" className="text-sm text-muted hover:text-offwhite">
          ← All sales
        </Link>
        <Link href="/sell" className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-charcoal hover:bg-brand-hover">
          + New sale
        </Link>
      </div>

      {isNew && (
        <div className="print:hidden">
          <Alert kind="success">Sale completed. Print the receipt or send it to the customer.</Alert>
        </div>
      )}
      {info && (
        <div className="print:hidden">
          <Alert kind="success">{info}</Alert>
        </div>
      )}

      <Receipt sale={sale} items={items} payments={payments} tenant={tenant} branch={branch} customer={customer} cashier={cashier} returns={returns} />

      <div className="mx-auto flex max-w-sm flex-wrap justify-center gap-2 print:hidden">
        <Button onClick={() => window.print()}>Print receipt</Button>
        <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg border border-charcoal-3 px-4 py-2.5 text-sm font-semibold hover:bg-charcoal-3">
          Send on WhatsApp
        </a>
        <Button variant="ghost" onClick={() => navigator.clipboard.writeText(text)}>
          Copy text
        </Button>
        <Button variant="ghost" onClick={() => copyThermal(58)}>
          Copy 58mm
        </Button>
        <Button variant="ghost" onClick={() => copyThermal(80)}>
          Copy 80mm
        </Button>
      </div>
      {copied && (
        <p className="mx-auto max-w-md text-center text-xs text-muted print:hidden">{copied}</p>
      )}

      {canManage && sale.offline_flags?.length > 0 && (
        <Card className="mx-auto max-w-xl space-y-2 border-red-400/50 print:hidden">
          <h2 className="text-xl font-bold">This sale needs a check</h2>
          <p className="text-sm text-muted">It was made without internet, so the shop rules could not be applied at the time. It was recorded anyway:</p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {sale.offline_flags.map((f: string, i: number) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
          {sale.reviewed_at ? (
            <p className="text-sm text-emerald-300">Checked on {new Date(sale.reviewed_at).toLocaleString('en-KE')}.</p>
          ) : (
            <Button onClick={markReviewed} disabled={busy}>
              I have checked this sale
            </Button>
          )}
        </Card>
      )}

      {canManage && (sale.status === 'completed' || sale.status === 'partially_returned') && (
        <Card className="mx-auto max-w-xl space-y-3 print:hidden">
          <h2 className="text-xl font-bold">Manager actions</h2>
          {error && <Alert>{error}</Alert>}
          <div className="flex flex-wrap gap-2">
            {returnable.length > 0 && (
              <Button variant="ghost" onClick={() => { setPanel(panel === 'return' ? '' : 'return'); setError('') }}>
                Take items back
              </Button>
            )}
            {sale.status === 'completed' && returns.length === 0 && (
              <Button variant="danger" onClick={() => { setPanel(panel === 'void' ? '' : 'void'); setError('') }}>
                Cancel this sale
              </Button>
            )}
          </div>

          {panel === 'void' && (
            <form onSubmit={doVoid} className="space-y-3">
              <p className="text-sm text-muted">All items go back into stock. Refund any money the customer paid. This is recorded with your name.</p>
              <Field label="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. entered by mistake" />
              <Button type="submit" variant="danger" disabled={busy}>
                {busy ? 'Cancelling...' : 'Yes, cancel the sale'}
              </Button>
            </form>
          )}

          {panel === 'return' && (
            <form onSubmit={doReturn} className="space-y-3">
              {returnable.map((i) => (
                <div key={i.id} className="rounded-xl border border-charcoal-3 bg-charcoal p-3 text-sm">
                  <div className="font-semibold">{i.product_name}</div>
                  <div className="text-xs text-muted">You can return up to {Number(i.quantity) - Number(i.returned_qty)}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <input
                      value={qtys[i.id] ?? ''}
                      inputMode="decimal"
                      placeholder="Qty"
                      onChange={(e) => setQtys({ ...qtys, [i.id]: e.target.value })}
                      className="w-24 rounded-lg border border-charcoal-3 bg-charcoal-2 px-3 py-2 focus:border-brand focus:outline-none"
                    />
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <input type="checkbox" checked={restock[i.id] !== false} onChange={(e) => setRestock({ ...restock, [i.id]: e.target.checked })} className="h-4 w-4 accent-[#FF5B14]" />
                      Put back in stock (untick if damaged)
                    </label>
                  </div>
                </div>
              ))}
              <Select label="Return type" value={returnType} onChange={(e) => setReturnType(e.target.value)}>
                <option value="wrong_part">Wrong part (fits nothing)</option>
                <option value="defective">Defective / faulty part</option>
                <option value="warranty">Warranty claim</option>
                <option value="exchange">Exchange for another part</option>
                <option value="customer_change">Customer changed their mind</option>
              </Select>
              <Select label="Refund by" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="mpesa">M-Pesa</option>
                <option value="bank">Bank</option>
                {sale.customer_id && <option value="debt_credit">Reduce what the customer owes / keep as credit</option>}
                <option value="exchange">Exchange (no money back)</option>
              </Select>
              <Field label="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong part for the bike" />
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving...' : 'Record the return'}
              </Button>
            </form>
          )}
        </Card>
      )}
    </div>
  )
}
