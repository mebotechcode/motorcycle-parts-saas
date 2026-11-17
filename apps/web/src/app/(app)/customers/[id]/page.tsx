'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Field, Select, Spinner } from '@/components/ui'
import { uuid } from '@/lib/inventory'
import { money, waNumber } from '@/lib/pos'
import { LEDGER_LABEL, TYPE_LABEL, daysSince, termsLabel, type COverview } from '@/lib/customers'

type Entry = { id: string; entry_type: string; amount: number; note: string | null; sale_id: string | null; created_at: string }

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>()
  const { claims } = useSession()
  const role = claims.tenant_role
  const manager = role === 'owner' || role === 'manager'

  const [c, setC] = useState<COverview | null>(null)
  const [missing, setMissing] = useState(false)
  const [entries, setEntries] = useState<Entry[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [shop, setShop] = useState('')
  const [info, setInfo] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [lastPayment, setLastPayment] = useState<any>(null)

  // receive payment
  const [branchId, setBranchId] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const [payKey, setPayKey] = useState(() => uuid())

  // details
  const [f, setF] = useState({ name: '', phone: '', customer_type: 'retail', price_tier: 'retail', credit_limit: '', payment_terms_days: '0', boda_stage: '', notes: '' })

  // manager tools
  const [tool, setTool] = useState<'' | 'opening' | 'writeoff' | 'increase'>('')
  const [tAmount, setTAmount] = useState('')
  const [tReason, setTReason] = useState('')
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    const [o, l, b, t] = await Promise.all([
      supabase.from('customer_overview').select('*').eq('id', id).maybeSingle(),
      supabase.from('customer_ledger').select('id,entry_type,amount,note,sale_id,created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(300),
      supabase.from('branches').select('id,name').eq('is_active', true).order('name'),
      supabase.from('tenants').select('name').maybeSingle(),
    ])
    if (!o.data) {
      setMissing(true)
      return
    }
    const cu = o.data as COverview
    setC(cu)
    setEntries(((l.data as any[]) ?? []).map((x) => ({ ...x, amount: Number(x.amount) })))
    const mine = ((b.data as any[]) ?? []).filter((x) => claims.all_branches || (claims.branch_ids ?? []).includes(x.id))
    setBranches(mine)
    setBranchId((cur) => cur || mine[0]?.id || '')
    setShop((t.data as any)?.name ?? '')
    setF({
      name: cu.name,
      phone: cu.phone ?? '',
      customer_type: cu.customer_type,
      price_tier: cu.price_tier,
      credit_limit: String(cu.credit_limit ?? 0),
      payment_terms_days: String(cu.payment_terms_days ?? 0),
      boda_stage: cu.boda_stage ?? '',
      notes: cu.notes ?? '',
    })
  }, [id, claims.all_branches, claims.branch_ids])

  useEffect(() => {
    load()
  }, [load])

  // running balance after each entry (worked out backwards from today's balance)
  const rows = useMemo(() => {
    let bal = Number(c?.balance ?? 0)
    return entries.map((e) => {
      const after = bal
      bal = Math.round((bal - e.amount) * 100) / 100
      return { ...e, after }
    })
  }, [entries, c?.balance])

  if (role === 'storekeeper') return <Alert kind="info">Storekeepers do not use customer accounts.</Alert>
  if (missing) return <Alert kind="info">Customer not found.</Alert>
  if (!c) return <Spinner />

  const balance = Number(c.balance)
  const limit = Number(c.credit_limit)
  const available = Math.max(0, limit - Math.max(0, balance))
  const days = daysSince(c.oldest_unpaid_at)
  const wa = (text: string) => `https://wa.me/${waNumber(c.phone)}?text=${encodeURIComponent(text)}`

  async function receive(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    if (!(Number(amount) > 0)) return setError('Enter the amount received')
    if (method === 'mpesa' && !/^[A-Za-z0-9]{8,12}$/.test(code.trim())) return setError('Enter the M-Pesa transaction code (8 to 12 letters and numbers)')
    setBusy('pay')
    const { data, error } = await supabase.rpc('record_customer_payment', {
      p_data: {
        customer_id: id,
        branch_id: branchId,
        amount: Number(amount),
        method,
        reference: method === 'mpesa' ? code.trim().toUpperCase() : null,
        note: note || null,
        client_uuid: payKey,
      },
    })
    setBusy('')
    if (error) return setError(error.message)
    setLastPayment(data)
    setAmount('')
    setCode('')
    setNote('')
    setPayKey(uuid())
    await load()
  }

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    if (f.name.trim().length < 2) return setError('Enter the name')
    setBusy('save')
    const patch: any = { name: f.name.trim(), phone: f.phone.trim() || null, customer_type: f.customer_type, price_tier: f.price_tier, payment_terms_days: Number(f.payment_terms_days || 0), boda_stage: f.boda_stage.trim() || null, notes: f.notes.trim() || null }
    if (manager) patch.credit_limit = Number(f.credit_limit || 0)
    const { error } = await supabase.from('customers').update(patch).eq('id', id)
    setBusy('')
    if (error) return setError(error.message)
    setInfo('Saved.')
    await load()
  }

  async function runTool(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    const n = Number(tAmount)
    if (!(n > 0)) return setError('Enter an amount more than zero')
    setBusy('tool')
    const res =
      tool === 'opening'
        ? await supabase.rpc('add_opening_balance', { p_customer_id: id, p_amount: n, p_note: tReason || null })
        : await supabase.rpc('adjust_customer_balance', { p_customer_id: id, p_amount: tool === 'writeoff' ? -n : n, p_reason: tReason })
    setBusy('')
    if (res.error) return setError(res.error.message)
    setInfo(`Done. The balance is now KES ${money(res.data as number)}.`)
    setTool('')
    setTAmount('')
    setTReason('')
    await load()
  }

  async function toggleActive() {
    if (c!.is_active && balance !== 0 && !window.confirm('This customer still has a balance. Hide them anyway?')) return
    const { error } = await supabase.from('customers').update({ is_active: !c!.is_active }).eq('id', id)
    if (error) return setError(error.message)
    await load()
  }

  const stmtText = [
    `*${shop}* - statement for ${c.name}`,
    ...rows.slice(0, 10).map((r) => `${new Date(r.created_at).toLocaleDateString('en-KE')}  ${LEDGER_LABEL[r.entry_type] ?? r.entry_type}  ${r.amount > 0 ? '+' : ''}${money(r.amount)}`),
    '',
    balance > 0 ? `*Balance owed: KES ${money(balance)}*` : balance < 0 ? `Credit on account: KES ${money(-balance)}` : 'Balance: nothing owed',
  ].join('\n')

  const shown = showAll ? rows : rows.slice(0, 15)

  return (
    <div className="space-y-5">
      <Link href="/customers" className="text-sm text-muted hover:text-offwhite">
        ← All customers
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold">{c.name}</h1>
          <p className="text-sm text-muted">
            {c.phone ?? 'No phone'} · {TYPE_LABEL[c.customer_type] ?? c.customer_type}
            {(c.payment_terms_days ?? 0) > 0 && ` · ${termsLabel(c.payment_terms_days)}`}
            {c.boda_stage ? ` · ${c.boda_stage}` : ''}
            {!c.is_active && ' · Hidden'}
          </p>
        </div>
        {c.phone && (
          <a href={wa(stmtText)} target="_blank" rel="noreferrer" className="rounded-lg border border-charcoal-3 px-4 py-2.5 text-sm font-semibold hover:bg-charcoal-3">
            Send statement on WhatsApp
          </a>
        )}
      </div>

      {error && <Alert>{error}</Alert>}
      {info && <Alert kind="success">{info}</Alert>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className={balance > 0 ? 'border-brand/40' : ''}>
          <div className="text-sm text-muted">{balance < 0 ? 'Credit on account' : 'Owes you'}</div>
          <div className={`font-display text-4xl font-bold ${balance > 0 ? 'text-brand' : balance < 0 ? 'text-emerald-300' : ''}`}>KES {money(Math.abs(balance))}</div>
          {days !== null && balance > 0 && <div className="text-xs text-muted">Oldest unpaid sale: {days} day{days === 1 ? '' : 's'} ago</div>}
        </Card>
        <Card>
          <div className="text-sm text-muted">Credit limit</div>
          <div className="font-display text-4xl font-bold">{limit > 0 ? `KES ${money(limit)}` : 'None'}</div>
          {limit > 0 && <div className={`text-xs ${c.over_limit ? 'text-red-300' : 'text-muted'}`}>{c.over_limit ? 'Over the limit' : `KES ${money(available)} still available`}</div>}
        </Card>
        <Card>
          <div className="text-sm text-muted">Last payment</div>
          <div className="font-display text-3xl font-bold">{c.last_payment_at ? new Date(c.last_payment_at).toLocaleDateString('en-KE') : 'Never'}</div>
        </Card>
      </div>

      <Card className="space-y-3">
        <h2 className="text-xl font-bold">Receive a payment</h2>
        <form onSubmit={receive} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Amount (KES)" type="number" inputMode="decimal" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Select label="Paid by" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="mpesa">M-Pesa</option>
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
              <div className="self-end pb-2 text-sm text-muted">{branches[0]?.name}</div>
            )}
          </div>
          {method === 'mpesa' && <Field label="M-Pesa code" placeholder="e.g. SFK1A2B3C4" maxLength={12} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />}
          <Field label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy === 'pay'}>
              {busy === 'pay' ? 'Saving...' : 'Receive payment'}
            </Button>
            {balance > 0 && (
              <Button type="button" variant="ghost" onClick={() => setAmount(String(balance))}>
                Full balance (KES {money(balance)})
              </Button>
            )}
          </div>
        </form>
        <p className="text-xs text-muted">The money clears this customer&apos;s oldest unpaid sales first.</p>

        {lastPayment && (
          <Alert kind="success">
            <div>
              Received <b>KES {money(lastPayment.amount)}</b>. {Number(lastPayment.balance_after) > 0 ? `Still owes KES ${money(lastPayment.balance_after)}.` : Number(lastPayment.balance_after) < 0 ? `Credit on account: KES ${money(-Number(lastPayment.balance_after))}.` : 'Fully paid up.'}
            </div>
            {c.phone && (
              <a
                className="mt-2 inline-block rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-charcoal"
                target="_blank"
                rel="noreferrer"
                href={wa(`${shop}: we received KES ${money(lastPayment.amount)} from you. ${Number(lastPayment.balance_after) > 0 ? `Balance: KES ${money(lastPayment.balance_after)}.` : 'Your account is clear.'} Thank you!`)}
              >
                Send confirmation on WhatsApp
              </a>
            )}
          </Alert>
        )}
      </Card>

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
                  <th className="py-1.5 pl-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t border-charcoal-3 align-top">
                    <td className="py-2 pr-2 text-xs text-muted">{new Date(r.created_at).toLocaleDateString('en-KE')}</td>
                    <td className="px-2 py-2">
                      <div>{LEDGER_LABEL[r.entry_type] ?? r.entry_type}</div>
                      {r.note && <div className="text-xs text-muted">{r.note}</div>}
                      {r.sale_id && (
                        <Link href={`/sales/${r.sale_id}`} className="text-xs text-brand hover:underline">
                          View receipt
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
        <p className="text-xs text-muted">Red (+) increases what they owe. Green (−) reduces it.</p>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-xl font-bold">Details</h2>
        <form onSubmit={saveDetails} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <Field label="Phone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            <Select label="Type" value={f.customer_type} onChange={(e) => setF({ ...f, customer_type: e.target.value })}>
              {Object.entries(TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
            <Select label="Usual prices" value={f.price_tier} onChange={(e) => setF({ ...f, price_tier: e.target.value })}>
              <option value="retail">Retail</option>
              <option value="wholesale">Wholesale</option>
            </Select>
            <Field
              label="Credit limit (KES)"
              type="number"
              inputMode="decimal"
              min={0}
              value={f.credit_limit}
              disabled={!manager}
              onChange={(e) => setF({ ...f, credit_limit: e.target.value })}
              hint={manager ? '0 = no credit' : 'Only the owner or a manager can change this'}
            />
            <Select label="Payment terms" value={f.payment_terms_days} onChange={(e) => setF({ ...f, payment_terms_days: e.target.value })}>
              <option value="0">Pay now</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
            </Select>
            <Field
              label="Boda stage / garage (optional)"
              placeholder='e.g. "Stage 4 - Githurai"'
              value={f.boda_stage}
              onChange={(e) => setF({ ...f, boda_stage: e.target.value })}
              hint="Used to group riders and fundis by stage"
            />
          </div>
          <Field label="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          <Button type="submit" disabled={busy === 'save'}>
            {busy === 'save' ? 'Saving...' : 'Save details'}
          </Button>
        </form>
      </Card>

      {manager && (
        <Card className="space-y-3">
          <h2 className="text-xl font-bold">Manager tools</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setTool(tool === 'opening' ? '' : 'opening')}>
              Add old debt (opening balance)
            </Button>
            <Button variant="ghost" onClick={() => setTool(tool === 'writeoff' ? '' : 'writeoff')}>
              Write off / reduce debt
            </Button>
            <Button variant="ghost" onClick={() => setTool(tool === 'increase' ? '' : 'increase')}>
              Increase balance (correction)
            </Button>
            <Button variant={c.is_active ? 'danger' : 'primary'} onClick={toggleActive}>
              {c.is_active ? 'Hide customer' : 'Show customer again'}
            </Button>
          </div>
          {tool && (
            <form onSubmit={runTool} className="space-y-3 rounded-xl border border-charcoal-3 bg-charcoal p-3">
              <p className="text-sm text-muted">
                {tool === 'opening' ? 'Debt this customer already had before you started using the system (for example from the notebook).' : tool === 'writeoff' ? 'Reduce what the customer owes without receiving money, for example a bad debt. Recorded with your name.' : 'Add to what the customer owes to correct a mistake. Recorded with your name.'}
              </p>
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
