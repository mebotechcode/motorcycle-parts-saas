'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Field, Select, Spinner } from '@/components/ui'
import { uuid } from '@/lib/inventory'
import { money, waNumber } from '@/lib/pos'
import { SUPPLIER_LEDGER_LABEL, type Supplier } from '@/lib/purchasing'
import { friendlyError } from '@/lib/errors'
import ProductPicker from '@/components/purchasing/ProductPicker'

type Entry = { id: string; entry_type: string; amount: number; note: string | null; receipt_id: string | null; created_at: string }

export default function SupplierPage() {
  const { id } = useParams<{ id: string }>()
  const { claims } = useSession()
  const role = claims.tenant_role
  const manager = role === 'owner' || role === 'manager'
  const allowed = manager || role === 'storekeeper'

  const [s, setS] = useState<Supplier | null>(null)
  const [missing, setMissing] = useState(false)
  const [entries, setEntries] = useState<Entry[]>([])
  const [receipts, setReceipts] = useState<any[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState('')
  const [showAll, setShowAll] = useState(false)

  const [f, setF] = useState({ name: '', contact_person: '', phone: '', email: '', address: '', terms: '0', notes: '' })

  // pay
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('mpesa')
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')
  const [branchId, setBranchId] = useState('')
  const [payKey, setPayKey] = useState(() => uuid())
  const [fromTill, setFromTill] = useState(true)

  // return goods
  const [retOpen, setRetOpen] = useState(false)
  const [retLines, setRetLines] = useState<{ id: string; name: string; qty: string; cost: string }[]>([])
  const [retReason, setRetReason] = useState('')

  // manager tools
  const [tool, setTool] = useState<'' | 'opening' | 'adjust'>('')
  const [tAmount, setTAmount] = useState('')
  const [tSign, setTSign] = useState('1')
  const [tReason, setTReason] = useState('')

  const load = useCallback(async () => {
    const [o, l, r, b] = await Promise.all([
      supabase.from('supplier_overview').select('*').eq('id', id).maybeSingle(),
      manager ? supabase.from('supplier_ledger').select('id,entry_type,amount,note,receipt_id,created_at').eq('supplier_id', id).order('created_at', { ascending: false }).limit(300) : Promise.resolve({ data: [] }),
      supabase.from('goods_receipts').select('id,received_at,supplier_invoice_no,total,amount_paid').eq('supplier_id', id).order('received_at', { ascending: false }).limit(10),
      supabase.from('branches').select('id,name').eq('is_active', true).order('name'),
    ])
    if (!o.data) return setMissing(true)
    const sup = o.data as Supplier
    setS(sup)
    setEntries((((l as any).data as any[]) ?? []).map((x) => ({ ...x, amount: Number(x.amount) })))
    setReceipts((r.data as any[]) ?? [])
    const mine = ((b.data as any[]) ?? []).filter((x) => claims.all_branches || (claims.branch_ids ?? []).includes(x.id))
    setBranches(mine)
    setBranchId((cur) => cur || mine[0]?.id || '')
    setF({ name: sup.name, contact_person: sup.contact_person ?? '', phone: sup.phone ?? '', email: sup.email ?? '', address: sup.address ?? '', terms: String(sup.payment_terms_days ?? 0), notes: sup.notes ?? '' })
  }, [id, manager, claims.all_branches, claims.branch_ids])

  useEffect(() => {
    load()
  }, [load])

  const rows = useMemo(() => {
    let bal = Number(s?.balance ?? 0)
    return entries.map((e) => {
      const after = bal
      bal = Math.round((bal - e.amount) * 100) / 100
      return { ...e, after }
    })
  }, [entries, s?.balance])

  if (!allowed) return <Alert kind="info">Only the owner, managers and storekeepers can see suppliers.</Alert>
  if (missing) return <Alert kind="info">Supplier not found.</Alert>
  if (!s) return <Spinner />

  const balance = Number(s.balance)

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    if (f.name.trim().length < 2) return setError('Enter the supplier name')
    setBusy('save')
    const { error } = await supabase
      .from('suppliers')
      .update({ name: f.name.trim(), contact_person: f.contact_person.trim() || null, phone: f.phone.trim() || null, email: f.email.trim() || null, address: f.address.trim() || null, payment_terms_days: Number(f.terms || 0), notes: f.notes.trim() || null })
      .eq('id', id)
    setBusy('')
    if (error) return setError(friendlyError(error))
    setInfo('Saved.')
    await load()
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    if (!(Number(amount) > 0)) return setError('Enter the amount you paid')
    setBusy('pay')
    const { data, error } = await supabase.rpc('pay_supplier', { p_data: { supplier_id: id, branch_id: branchId || null, amount: Number(amount), method, reference: ref || null, note: note || null, client_uuid: payKey, from_till: method === 'cash' && fromTill && !!branchId } })
    setBusy('')
    if (error) return setError(friendlyError(error))
    const b = Number((data as any).balance_after)
    setInfo(`Payment recorded. ${b > 0 ? `You still owe KES ${money(b)}.` : b < 0 ? `The supplier now owes you KES ${money(-b)}.` : 'Fully paid up.'}`)
    setAmount('')
    setRef('')
    setNote('')
    setPayKey(uuid())
    await load()
  }

  async function sendReturn(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    if (retLines.length === 0) return setError('Add the items you are returning')
    if (retLines.some((l) => !(Number(l.qty) > 0))) return setError('Every item needs a quantity')
    setBusy('ret')
    const { data, error } = await supabase.rpc('return_to_supplier', {
      p_data: { supplier_id: id, branch_id: branchId, reason: retReason, items: retLines.map((l) => ({ product_id: l.id, qty: Number(l.qty), unit_cost: Number(l.cost || 0) })) },
    })
    setBusy('')
    if (error) return setError(friendlyError(error))
    setInfo(`Returned. Credit from the supplier: KES ${money((data as any).credit)}.`)
    setRetLines([])
    setRetReason('')
    setRetOpen(false)
    await load()
  }

  async function runTool(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    const n = Number(tAmount)
    if (!(n > 0)) return setError('Enter an amount more than zero')
    setBusy('tool')
    const { data, error } = await supabase.rpc('adjust_supplier_balance', { p_supplier_id: id, p_amount: tool === 'opening' ? n : n * Number(tSign), p_reason: tReason || null, p_opening: tool === 'opening' })
    setBusy('')
    if (error) return setError(friendlyError(error))
    setInfo(`Done. You now owe KES ${money(data as number)}.`)
    setTool('')
    setTAmount('')
    setTReason('')
    await load()
  }

  async function toggleActive() {
    const { error } = await supabase.from('suppliers').update({ is_active: !s!.is_active }).eq('id', id)
    if (error) return setError(friendlyError(error))
    await load()
  }

  const shown = showAll ? rows : rows.slice(0, 15)

  return (
    <div className="space-y-5">
      <Link href="/suppliers" className="text-sm text-muted hover:text-offwhite">
        ← All suppliers
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold">{s.name}</h1>
          <p className="text-sm text-muted">
            {s.contact_person ? `${s.contact_person} · ` : ''}
            {s.phone ?? 'No phone'} · {s.payment_terms_days > 0 ? `${s.payment_terms_days} days to pay` : 'pay on delivery'}
            {!s.is_active && ' · Hidden'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/purchases/receive?supplier=${id}`} className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-charcoal hover:bg-brand-hover">
            Receive goods
          </Link>
          <Link href={`/purchases/order/new?supplier=${id}`} className="rounded-lg border border-charcoal-3 px-4 py-2.5 text-sm font-semibold hover:bg-charcoal-3">
            New order
          </Link>
          {s.phone && (
            <a href={`https://wa.me/${waNumber(s.phone)}`} target="_blank" rel="noreferrer" className="rounded-lg border border-charcoal-3 px-4 py-2.5 text-sm font-semibold hover:bg-charcoal-3">
              WhatsApp
            </a>
          )}
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {info && <Alert kind="success">{info}</Alert>}

      {manager && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className={balance > 0 ? 'border-brand/40' : ''}>
            <div className="text-sm text-muted">{balance < 0 ? 'They owe you' : 'You owe them'}</div>
            <div className={`font-display text-4xl font-bold ${balance > 0 ? 'text-brand' : balance < 0 ? 'text-emerald-300' : ''}`}>KES {money(Math.abs(balance))}</div>
          </Card>
          <Card>
            <div className="text-sm text-muted">Last delivery</div>
            <div className="font-display text-3xl font-bold">{s.last_receipt_at ? new Date(s.last_receipt_at).toLocaleDateString('en-KE') : 'Never'}</div>
          </Card>
          <Card>
            <div className="text-sm text-muted">Last payment</div>
            <div className="font-display text-3xl font-bold">{s.last_payment_at ? new Date(s.last_payment_at).toLocaleDateString('en-KE') : 'Never'}</div>
          </Card>
        </div>
      )}

      {manager && (
        <Card className="space-y-3">
          <h2 className="text-xl font-bold">Pay this supplier</h2>
          <form onSubmit={pay} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Amount (KES)" type="number" inputMode="decimal" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Select label="Paid by" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="mpesa">M-Pesa</option>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
                <option value="other">Other</option>
              </Select>
              {branches.length > 1 ? (
                <Select label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <div />
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Reference (M-Pesa code, cheque no.)" value={ref} onChange={(e) => setRef(e.target.value)} />
              <Field label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            {method === 'cash' && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={fromTill} onChange={(e) => setFromTill(e.target.checked)} className="h-4 w-4 accent-[#FF5B14]" />
                Paid from the till drawer (the cash is taken off what the till should hold)
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy === 'pay'}>
                {busy === 'pay' ? 'Saving...' : 'Record payment'}
              </Button>
              {balance > 0 && (
                <Button type="button" variant="ghost" onClick={() => setAmount(String(balance))}>
                  Full balance (KES {money(balance)})
                </Button>
              )}
            </div>
          </form>
          <p className="text-xs text-muted">This records the payment only. It does not move money. Cash paid from the till drawer is taken off the till figures when the box above is ticked.</p>
        </Card>
      )}

      <Card className="space-y-2">
        <h2 className="text-xl font-bold">Recent deliveries</h2>
        {receipts.length === 0 ? (
          <p className="text-sm text-muted">No deliveries yet.</p>
        ) : (
          receipts.map((r) => (
            <Link key={r.id} href={`/purchases/receipts/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-charcoal-3 bg-charcoal p-3 text-sm hover:border-brand/60">
              <span>
                {new Date(r.received_at).toLocaleDateString('en-KE')} {r.supplier_invoice_no ? `· Invoice ${r.supplier_invoice_no}` : ''}
              </span>
              {manager && (
                <span className="font-semibold">
                  KES {money(r.total)} <span className="text-xs font-normal text-muted">(paid {money(r.amount_paid)})</span>
                </span>
              )}
            </Link>
          ))
        )}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Return goods to this supplier</h2>
          <Button variant="ghost" onClick={() => setRetOpen(!retOpen)}>
            {retOpen ? 'Close' : 'Return goods'}
          </Button>
        </div>
        {retOpen && (
          <form onSubmit={sendReturn} className="space-y-3">
            {branches.length > 1 && (
              <Select label="From branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
            <ProductPicker onPick={(p) => !retLines.find((l) => l.id === p.id) && setRetLines([...retLines, { id: p.id, name: p.name, qty: '1', cost: String(p.last_cost ?? 0) }])} />
            {retLines.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-charcoal-3 bg-charcoal p-2 text-sm">
                <div className="min-w-0 flex-1 basis-40 truncate">{l.name}</div>
                <input value={l.qty} inputMode="decimal" onChange={(e) => setRetLines(retLines.map((x) => (x.id === l.id ? { ...x, qty: e.target.value } : x)))} aria-label="Quantity" className="w-20 rounded-lg border border-charcoal-3 bg-charcoal-2 px-2 py-1.5" />
                <input value={l.cost} inputMode="decimal" onChange={(e) => setRetLines(retLines.map((x) => (x.id === l.id ? { ...x, cost: e.target.value } : x)))} aria-label="Price each" className="w-24 rounded-lg border border-charcoal-3 bg-charcoal-2 px-2 py-1.5" />
                <button type="button" onClick={() => setRetLines(retLines.filter((x) => x.id !== l.id))} className="text-muted hover:text-red-300">
                  ×
                </button>
              </div>
            ))}
            <Field label="Reason (required)" value={retReason} onChange={(e) => setRetReason(e.target.value)} placeholder="e.g. wrong model, damaged" />
            <Button type="submit" disabled={busy === 'ret'}>
              {busy === 'ret' ? 'Saving...' : 'Record the return'}
            </Button>
            <p className="text-xs text-muted">Stock goes down and you owe the supplier less (a credit).</p>
          </form>
        )}
      </Card>

      {manager && (
        <Card className="space-y-3">
          <h2 className="text-xl font-bold">Statement</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-muted">No activity yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1.5 pr-2 font-medium">Date</th>
                    <th className="px-2 py-1.5 font-medium">What</th>
                    <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                    <th className="py-1.5 pl-2 text-right font-medium">You owe</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className="border-t border-charcoal-3 align-top">
                      <td className="py-2 pr-2 text-xs text-muted">{new Date(r.created_at).toLocaleDateString('en-KE')}</td>
                      <td className="px-2 py-2">
                        <div>{SUPPLIER_LEDGER_LABEL[r.entry_type] ?? r.entry_type}</div>
                        {r.note && <div className="text-xs text-muted">{r.note}</div>}
                        {r.receipt_id && (
                          <Link href={`/purchases/receipts/${r.receipt_id}`} className="text-xs text-brand hover:underline">
                            View delivery
                          </Link>
                        )}
                      </td>
                      <td className={`px-2 py-2 text-right font-semibold ${r.amount > 0 ? 'text-brand' : 'text-emerald-300'}`}>
                        {r.amount > 0 ? '+' : '−'}
                        {money(Math.abs(r.amount))}
                      </td>
                      <td className="py-2 pl-2 text-right">{money(r.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 15 && (
            <button type="button" onClick={() => setShowAll(!showAll)} className="text-sm text-brand hover:underline">
              {showAll ? 'Show fewer' : `Show all ${rows.length}`}
            </button>
          )}
        </Card>
      )}

      {manager && (
        <Card className="space-y-3">
          <h2 className="text-xl font-bold">Details</h2>
          <form onSubmit={saveDetails} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Supplier name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              <Field label="Contact person" value={f.contact_person} onChange={(e) => setF({ ...f, contact_person: e.target.value })} />
              <Field label="Phone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
              <Field label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
              <Field label="Address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
              <Field label="Days to pay" type="number" min={0} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} />
            </div>
            <Field label="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            <Button type="submit" disabled={busy === 'save'}>
              {busy === 'save' ? 'Saving...' : 'Save details'}
            </Button>
          </form>
          <div className="flex flex-wrap gap-2 border-t border-charcoal-3 pt-3">
            <Button variant="ghost" onClick={() => setTool(tool === 'opening' ? '' : 'opening')}>
              Add old debt (opening balance)
            </Button>
            <Button variant="ghost" onClick={() => setTool(tool === 'adjust' ? '' : 'adjust')}>
              Correct the balance
            </Button>
            <Button variant={s.is_active ? 'danger' : 'primary'} onClick={toggleActive}>
              {s.is_active ? 'Hide supplier' : 'Show supplier again'}
            </Button>
          </div>
          {tool && (
            <form onSubmit={runTool} className="space-y-3 rounded-xl border border-charcoal-3 bg-charcoal p-3">
              <p className="text-sm text-muted">{tool === 'opening' ? 'Money you already owed this supplier before you started using the system.' : 'Correct a mistake in what you owe. Recorded with your name.'}</p>
              {tool === 'adjust' && (
                <Select label="Change" value={tSign} onChange={(e) => setTSign(e.target.value)}>
                  <option value="1">Increase what I owe</option>
                  <option value="-1">Reduce what I owe</option>
                </Select>
              )}
              <Field label="Amount (KES)" type="number" inputMode="decimal" min={0} step="any" value={tAmount} onChange={(e) => setTAmount(e.target.value)} />
              <Field label={tool === 'opening' ? 'Note (optional)' : 'Reason (required)'} value={tReason} onChange={(e) => setTReason(e.target.value)} />
              <Button type="submit" disabled={busy === 'tool'}>
                {busy === 'tool' ? 'Saving...' : 'Save'}
              </Button>
            </form>
          )}
        </Card>
      )}
    </div>
  )
}
