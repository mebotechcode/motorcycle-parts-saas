'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Field, Select, Spinner } from '@/components/ui'
import { money } from '@/lib/pos'
import { PRESET_LABEL, periodRange, todayEAT, type Preset } from '@/lib/reports'

type Exp = { id: string; incurred_on: string; amount: number; method: string; paid_to: string | null; description: string | null; reference: string | null; category_id: string | null; branch_id: string; created_by: string | null }

export default function ExpensesPage() {
  const { claims } = useSession()
  const role = claims.tenant_role
  const manager = role === 'owner' || role === 'manager'
  const allowed = manager || role === 'cashier'

  const [preset, setPreset] = useState<Preset>('month')
  const [rows, setRows] = useState<Exp[] | null>(null)
  const [cats, setCats] = useState<{ id: string; name: string }[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [people, setPeople] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  // form
  const [amount, setAmount] = useState('')
  const [catId, setCatId] = useState('')
  const [method, setMethod] = useState('cash')
  const [paidTo, setPaidTo] = useState('')
  const [desc, setDesc] = useState('')
  const [ref, setRef] = useState('')
  const [date, setDate] = useState(todayEAT())
  const [branchId, setBranchId] = useState('')
  const [newCat, setNewCat] = useState('')

  const load = useCallback(async () => {
    const { from, to } = periodRange(preset)
    const [e, c, b] = await Promise.all([
      supabase.from('expenses').select('id,incurred_on,amount,method,paid_to,description,reference,category_id,branch_id,created_by').gte('incurred_on', from).lte('incurred_on', to).order('incurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(300),
      supabase.from('expense_categories').select('id,name').order('name'),
      supabase.from('branches').select('id,name').eq('is_active', true).order('name'),
    ])
    if (e.error) setError(e.error.message)
    const list = ((e.data as any[]) ?? []).map((x) => ({ ...x, amount: Number(x.amount) })) as Exp[]
    setRows(list)
    setCats((c.data as any[]) ?? [])
    const mine = ((b.data as any[]) ?? []).filter((x) => claims.all_branches || (claims.branch_ids ?? []).includes(x.id))
    setBranches(mine)
    setBranchId((cur) => cur || mine[0]?.id || '')
    const ids = Array.from(new Set(list.map((x) => x.created_by).filter(Boolean))) as string[]
    if (ids.length) {
      const { data } = await supabase.from('profiles').select('id,full_name').in('id', ids)
      const m: Record<string, string> = {}
      ;((data as any[]) ?? []).forEach((p) => (m[p.id] = p.full_name || 'Staff'))
      setPeople(m)
    }
  }, [preset, claims.all_branches, claims.branch_ids])

  useEffect(() => {
    load()
  }, [load])

  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? 'Other'
  const total = useMemo(() => (rows ?? []).reduce((s, r) => s + r.amount, 0), [rows])
  const byCat = useMemo(() => {
    const m: Record<string, number> = {}
    ;(rows ?? []).forEach((r) => (m[catName(r.category_id)] = (m[catName(r.category_id)] ?? 0) + r.amount))
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [rows, cats]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!allowed) return <Alert kind="info">Only the owner, managers and cashiers record expenses.</Alert>

  async function addCategory() {
    const name = newCat.trim()
    if (!name) return
    const { data, error } = await supabase.from('expense_categories').insert({ name }).select('id,name').single()
    if (error) return setError(error.message.includes('duplicate') ? 'That category already exists' : error.message)
    setCats((p) => [...p, data as any])
    setCatId((data as any).id)
    setNewCat('')
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    if (!(Number(amount) > 0)) return setError('Enter the amount')
    setBusy(true)
    const { error } = await supabase.rpc('record_expense', {
      p_data: { branch_id: branchId, category_id: catId || null, amount: Number(amount), method, paid_to: paidTo, description: desc, reference: ref, incurred_on: manager ? date : undefined },
    })
    setBusy(false)
    if (error) return setError(error.message)
    setInfo(method === 'cash' ? 'Saved. This cash was taken out of your till.' : 'Saved.')
    setAmount('')
    setPaidTo('')
    setDesc('')
    setRef('')
    await load()
  }

  async function remove(r: Exp) {
    const reason = window.prompt(`Why delete this expense (KES ${money(r.amount)})?`)
    if (!reason) return
    const { error } = await supabase.rpc('delete_expense', { p_id: r.id, p_reason: reason })
    if (error) return setError(error.message)
    await load()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/sales" className="text-sm text-muted hover:text-offwhite">
            ← Sales
          </Link>
          <h1 className="text-4xl font-bold">Expenses</h1>
          <p className="text-sm text-muted">Rent, transport, airtime, salaries... money the shop spends that is not stock.</p>
        </div>
        <div className="w-44">
          <Select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
            {(['today', 'yesterday', '7days', 'month', 'lastmonth'] as Preset[]).map((p) => (
              <option key={p} value={p}>
                {PRESET_LABEL[p]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {info && <Alert kind="success">{info}</Alert>}

      <Card className="space-y-3">
        <h2 className="text-xl font-bold">Add an expense</h2>
        <form onSubmit={save} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Amount (KES)" type="number" inputMode="decimal" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div>
              <Select label="What for" value={catId} onChange={(e) => setCatId(e.target.value)}>
                <option value="">Choose...</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              {manager && (
                <div className="mt-1 flex gap-2">
                  <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="+ new category" className="w-full rounded-lg border border-charcoal-3 bg-charcoal px-2 py-1.5 text-sm focus:border-brand focus:outline-none" />
                  <button type="button" onClick={addCategory} className="rounded-lg border border-charcoal-3 px-2 text-sm hover:bg-charcoal-3">
                    Add
                  </button>
                </div>
              )}
            </div>
            <Select label="Paid by" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">Cash (from the till)</option>
              <option value="mpesa">M-Pesa</option>
              <option value="bank">Bank</option>
              <option value="other">Other</option>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Paid to (optional)" value={paidTo} onChange={(e) => setPaidTo(e.target.value)} />
            <Field label="Description" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. fuel for delivery" />
            {method !== 'cash' ? <Field label="Reference (code)" value={ref} onChange={(e) => setRef(e.target.value)} /> : <div />}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
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
            {manager ? <Field label="Date" type="date" max={todayEAT()} value={date} onChange={(e) => setDate(e.target.value)} /> : <div />}
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving...' : 'Save expense'}
          </Button>
        </form>
      </Card>

      {manager && rows && rows.length > 0 && (
        <Card className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-bold">Total spent</h2>
            <div className="font-display text-3xl font-bold text-brand">KES {money(total)}</div>
          </div>
          <div className="space-y-1">
            {byCat.map(([name, sum]) => (
              <div key={name} className="flex items-center gap-3 text-sm">
                <div className="w-40 truncate">{name}</div>
                <div className="h-2 flex-1 overflow-hidden rounded bg-charcoal-3">
                  <div className="h-full bg-brand" style={{ width: `${total > 0 ? (sum / total) * 100 : 0}%` }} />
                </div>
                <div className="w-28 text-right">KES {money(sum)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-muted">No expenses in this period.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-charcoal-3 bg-charcoal-2 p-3">
              <div className="min-w-0">
                <div className="font-semibold">{catName(r.category_id)}{r.description ? ` · ${r.description}` : ''}</div>
                <div className="text-xs text-muted">
                  {new Date(r.incurred_on).toLocaleDateString('en-KE')} · {r.method}
                  {r.paid_to ? ` · ${r.paid_to}` : ''}
                  {r.reference ? ` · ${r.reference}` : ''}
                  {manager && r.created_by ? ` · ${people[r.created_by] ?? 'Staff'}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="font-display text-xl font-bold">KES {money(r.amount)}</div>
                {manager && (
                  <button type="button" onClick={() => remove(r)} className="text-sm text-muted hover:text-red-300">
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
