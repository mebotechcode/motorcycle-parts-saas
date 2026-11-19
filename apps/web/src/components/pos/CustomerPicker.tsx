'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Alert, Button, Field, Select } from '@/components/ui'
import { money, type Customer } from '@/lib/pos'
import { friendlyError } from '@/lib/errors'

// Works from the customers saved on the device (so it also works offline).
export default function CustomerPicker({
  value,
  onChange,
  canSetCredit,
  customers,
  balances,
  online,
  onCreated,
}: {
  value: Customer | null
  onChange: (c: Customer | null) => void
  canSetCredit: boolean
  customers: Customer[]
  balances: Record<string, number>
  online: boolean
  onCreated?: () => void
}) {
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [nName, setNName] = useState('')
  const [nPhone, setNPhone] = useState('')
  const [nType, setNType] = useState('retail')
  const [nLimit, setNLimit] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const s = text.trim().toLowerCase()
  const found =
    s.length < 2
      ? []
      : customers.filter((c) => c.name.toLowerCase().includes(s) || (c.phone ?? '').replace(/\s/g, '').includes(s.replace(/\s/g, ''))).slice(0, 8)

  useEffect(() => {
    if (!online) setAdding(false)
  }, [online])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (nName.trim().length < 2) return setError('Enter the customer name')
    setBusy(true)
    const { data, error } = await supabase
      .from('customers')
      .insert({
        name: nName.trim(),
        phone: nPhone.trim() || null,
        customer_type: nType,
        price_tier: nType === 'wholesale' || nType === 'mechanic' ? 'wholesale' : 'retail',
        credit_limit: canSetCredit && nLimit ? Number(nLimit) : 0,
      })
      .select('id,name,phone,credit_limit,price_tier,customer_type')
      .single()
    setBusy(false)
    if (error) return setError(friendlyError(error))
    onChange(data as Customer)
    onCreated?.()
    setAdding(false)
    setNName('')
    setNPhone('')
    setNLimit('')
  }

  if (value) {
    const balance = balances[value.id] ?? 0
    const available = Math.max(0, Number(value.credit_limit) - balance)
    return (
      <div className="rounded-xl border border-charcoal-3 bg-charcoal p-3 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold">{value.name}</div>
            <div className="text-xs text-muted">{value.phone ?? 'No phone'}</div>
          </div>
          <button type="button" onClick={() => onChange(null)} className="text-xs text-muted hover:text-offwhite">
            Change
          </button>
        </div>
        <div className="mt-2 text-xs text-muted">
          Owes now: <b className={balance > 0 ? 'text-brand' : 'text-offwhite'}>KES {money(balance)}</b>
          {Number(value.credit_limit) > 0 ? (
            <>
              {' '}
              · Credit limit KES {money(value.credit_limit)} · Available <b className="text-offwhite">KES {money(available)}</b>
            </>
          ) : (
            <> · No credit allowed</>
          )}
          {!online && <span className="block">Balance as of the last update on this device.</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Customer (optional): name or phone"
          className="w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2.5 text-sm placeholder:text-muted/60 focus:border-brand focus:outline-none"
        />
        {found.length > 0 && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-charcoal-3 bg-charcoal-2 shadow-xl">
            {found.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => {
                  onChange(c)
                  setText('')
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-charcoal-3"
              >
                {c.name} <span className="text-xs text-muted">{c.phone ?? ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {!online ? (
        <p className="text-xs text-muted">New customers can be added when you are back online.</p>
      ) : !adding ? (
        <button type="button" onClick={() => setAdding(true)} className="text-sm text-brand hover:underline">
          + New customer
        </button>
      ) : (
        <form onSubmit={create} className="space-y-3 rounded-xl border border-charcoal-3 bg-charcoal p-3">
          <Field label="Name" required value={nName} onChange={(e) => setNName(e.target.value)} />
          <Field label="Phone" type="tel" value={nPhone} onChange={(e) => setNPhone(e.target.value)} />
          <Select label="Type" value={nType} onChange={(e) => setNType(e.target.value)}>
            <option value="retail">Retail customer</option>
            <option value="rider">Boda boda rider</option>
            <option value="mechanic">Mechanic / garage</option>
            <option value="wholesale">Shop / wholesale</option>
          </Select>
          {canSetCredit && (
            <Field label="Credit limit (KES)" type="number" inputMode="decimal" min={0} value={nLimit} onChange={(e) => setNLimit(e.target.value)} hint="Leave empty for no credit" />
          )}
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving...' : 'Save customer'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
