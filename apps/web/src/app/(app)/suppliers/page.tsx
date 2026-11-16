'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Field, Spinner } from '@/components/ui'
import { money } from '@/lib/pos'
import { canEditInventory } from '@/lib/inventory'
import type { Supplier } from '@/lib/purchasing'

export default function SuppliersPage() {
  const router = useRouter()
  const { claims } = useSession()
  const role = claims.tenant_role
  const manager = role === 'owner' || role === 'manager'
  const allowed = canEditInventory(role)

  const [text, setText] = useState('')
  const [rows, setRows] = useState<Supplier[] | null>(null)
  const [summary, setSummary] = useState<any>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ name: '', contact_person: '', phone: '', email: '', terms: '0' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    let q = supabase.from('supplier_overview').select('*').eq('is_active', true).order('name').limit(200)
    const s = text.trim().replace(/[,()%*\\]/g, ' ').trim()
    if (s) q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%,contact_person.ilike.%${s}%`)
    const { data, error } = await q
    if (error) setError(error.message)
    setRows((data as Supplier[]) ?? [])
  }, [text])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  useEffect(() => {
    if (manager) supabase.rpc('suppliers_summary').then(({ data }) => setSummary(data))
  }, [manager])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (f.name.trim().length < 2) return setError('Enter the supplier name')
    setBusy(true)
    const { data, error } = await supabase
      .from('suppliers')
      .insert({
        name: f.name.trim(),
        contact_person: f.contact_person.trim() || null,
        phone: f.phone.trim() || null,
        email: f.email.trim() || null,
        payment_terms_days: Number(f.terms || 0),
      })
      .select('id')
      .single()
    setBusy(false)
    if (error) return setError(error.message)
    router.push(`/suppliers/${(data as any).id}`)
  }

  if (!allowed) return <Alert kind="info">Only the owner, managers and storekeepers can see suppliers.</Alert>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/purchases" className="text-sm text-muted hover:text-offwhite">
            ← Purchases
          </Link>
          <h1 className="text-4xl font-bold">Suppliers</h1>
        </div>
        {manager && <Button onClick={() => setAdding(!adding)}>+ Add supplier</Button>}
      </div>

      {manager && summary && (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <div className="text-xs text-muted">You owe suppliers</div>
            <div className="font-display text-3xl font-bold text-brand sm:text-4xl">KES {money(summary.total_owed)}</div>
          </Card>
          <Card>
            <div className="text-xs text-muted">Suppliers owed</div>
            <div className="font-display text-3xl font-bold sm:text-4xl">{summary.owed_count}</div>
          </Card>
        </div>
      )}

      {adding && (
        <Card>
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <Field label="Contact person" value={f.contact_person} onChange={(e) => setF({ ...f, contact_person: e.target.value })} />
            <Field label="Phone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            <Field label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <Field label="Days to pay" type="number" min={0} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} hint="0 = pay on delivery" />
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving...' : 'Save supplier'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search suppliers"
        className="w-full rounded-lg border border-charcoal-3 bg-charcoal-2 px-3 py-2.5 placeholder:text-muted/60 focus:border-brand focus:outline-none"
      />

      {error && <Alert>{error}</Alert>}

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-muted">No suppliers yet.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((s) => (
            <Link key={s.id} href={`/suppliers/${s.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-charcoal-3 bg-charcoal-2 p-3 hover:border-brand/60">
              <div className="min-w-0">
                <div className="truncate font-semibold">{s.name}</div>
                <div className="text-xs text-muted">
                  {s.contact_person ? `${s.contact_person} · ` : ''}
                  {s.phone ?? 'No phone'} · {s.payment_terms_days > 0 ? `${s.payment_terms_days} days to pay` : 'pay on delivery'}
                </div>
              </div>
              {manager && (
                <div className="text-right">
                  {Number(s.balance) > 0 ? (
                    <div className="font-display text-xl font-bold text-brand">You owe KES {money(s.balance)}</div>
                  ) : Number(s.balance) < 0 ? (
                    <div className="font-display text-xl font-bold text-emerald-300">They owe you KES {money(-Number(s.balance))}</div>
                  ) : (
                    <div className="text-sm text-muted">Nothing owed</div>
                  )}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
