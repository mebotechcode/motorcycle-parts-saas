'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Select, Spinner } from '@/components/ui'
import { money, waNumber } from '@/lib/pos'
import { BUCKETS, DEFAULT_REMINDER, bucketOf, daysSince, fillTemplate, itemizedReminder, type COverview, type UnpaidSale } from '@/lib/customers'
import { friendlyError } from '@/lib/errors'

export default function RemindPage() {
  const { claims } = useSession()
  const manager = claims.tenant_role === 'owner' || claims.tenant_role === 'manager'

  const [rows, setRows] = useState<COverview[] | null>(null)
  const [allowed, setAllowed] = useState<{ plan_ok: boolean; shop: string } | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [minDays, setMinDays] = useState('0')
  const [message, setMessage] = useState(DEFAULT_REMINDER)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<any>(null)

  const load = useCallback(async () => {
    const [d, a] = await Promise.all([
      supabase.from('customer_overview').select('*').is('deleted_at', null).eq('is_active', true).gt('balance', 0).order('oldest_unpaid_at', { ascending: true, nullsFirst: false }).limit(300),
      supabase.rpc('sms_allowed'),
    ])
    if (d.error) setError(friendlyError(d.error))
    setRows((d.data as COverview[]) ?? [])
    setAllowed((a.data as any) ?? null)
  }, [])

  // Unpaid invoices per debtor, for the itemized WhatsApp reminder
  const [unpaid, setUnpaid] = useState<Record<string, UnpaidSale[]>>({})
  useEffect(() => {
    const ids = (rows ?? []).map((r) => r.id)
    if (ids.length === 0) return setUnpaid({})
    supabase
      .from('sales')
      .select('id,receipt_no,sold_at,total,balance_due,customer_id')
      .in('customer_id', ids)
      .gt('balance_due', 0)
      .in('status', ['completed', 'partially_returned'])
      .order('sold_at', { ascending: true })
      .limit(1500)
      .then(({ data }) => {
        const m: Record<string, UnpaidSale[]> = {}
        ;(data as any[])?.forEach((s) => {
          ;(m[s.customer_id] ??= []).push(s)
        })
        setUnpaid(m)
      })
  }, [rows])

  useEffect(() => {
    if (manager) load()
  }, [manager, load])

  const shop = allowed?.shop ?? ''

  const shown = useMemo(() => {
    const min = Number(minDays)
    return (rows ?? []).filter((r) => min === 0 || (daysSince(r.oldest_unpaid_at) ?? 0) >= min)
  }, [rows, minDays])

  const buckets = useMemo(() => {
    const m = Object.fromEntries(BUCKETS.map((b) => [b.key, { count: 0, total: 0 }]))
    ;(rows ?? []).forEach((r) => {
      const k = bucketOf(daysSince(r.oldest_unpaid_at))
      m[k].count++
      m[k].total += Number(r.balance)
    })
    return m
  }, [rows])

  if (!manager) return <Alert kind="info">Only the owner and managers can send reminders.</Alert>
  if (rows === null) return <Spinner />

  const toggle = (id: string) => {
    const s = new Set(picked)
    s.has(id) ? s.delete(id) : s.add(id)
    setPicked(s)
  }
  const withPhone = shown.filter((r) => r.phone)
  const first = rows.find((r) => picked.has(r.id))

  async function sendSms() {
    setError('')
    setResult(null)
    if (picked.size === 0) return setError('Tick at least one customer')
    setBusy(true)
    const res = await supabase.functions.invoke('send-sms', { body: { customer_ids: Array.from(picked), message } })
    setBusy(false)
    if (res.error) {
      let msg = res.error.message
      try {
        msg = (await (res.error as any).context.json()).error ?? msg
      } catch {}
      return setError(friendlyError(msg))
    }
    setResult(res.data)
  }

  return (
    <div className="space-y-5">
      <Link href="/customers" className="text-sm text-muted hover:text-offwhite">
        ← All customers
      </Link>
      <div>
        <h1 className="text-4xl font-bold">Remind debtors</h1>
        <p className="text-sm text-muted">Choose customers who owe you money and send them a reminder.</p>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {BUCKETS.map((b) => (
          <Card key={b.key} className="p-3">
            <div className="text-xs text-muted">{b.label}</div>
            <div className="font-display text-xl font-bold">KES {money(buckets[b.key].total)}</div>
            <div className="text-xs text-muted">{buckets[b.key].count} customer{buckets[b.key].count === 1 ? '' : 's'}</div>
          </Card>
        ))}
      </div>

      <Card className="space-y-3">
        <h2 className="text-xl font-bold">Message</h2>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          maxLength={320}
          className="w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2.5 focus:border-brand focus:outline-none"
        />
        <p className="text-xs text-muted">
          You can use {'{name}'}, {'{amount}'} and {'{shop}'}. {message.length}/320 characters.
        </p>
        {first && (
          <div className="rounded-lg bg-charcoal p-3 text-sm">
            <div className="text-xs text-muted">Preview for {first.name}</div>
            {fillTemplate(message, { name: first.name, amount: Number(first.balance), shop })}
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Customers who owe ({shown.length})</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-44">
              <Select value={minDays} onChange={(e) => setMinDays(e.target.value)}>
                <option value="0">Any age</option>
                <option value="7">7+ days</option>
                <option value="30">30+ days</option>
                <option value="60">60+ days</option>
              </Select>
            </div>
            <Button variant="ghost" onClick={() => setPicked(new Set(withPhone.map((r) => r.id)))}>
              Tick all with a phone
            </Button>
            <Button variant="ghost" onClick={() => setPicked(new Set())}>
              Clear
            </Button>
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="text-sm text-muted">Nobody owes money. 🎉</p>
        ) : (
          <div className="space-y-2">
            {shown.map((r) => {
              const d = daysSince(r.oldest_unpaid_at)
              const invoices = unpaid[r.id] ?? []
              // Itemized reminder lists each unpaid invoice; falls back to the simple template
              const text = invoices.length > 0 ? itemizedReminder(shop, r.name, Number(r.balance), invoices) : fillTemplate(message, { name: r.name, amount: Number(r.balance), shop })
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-charcoal-3 bg-charcoal p-3">
                  <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} className="h-5 w-5 accent-[#FF5B14]" aria-label={`Select ${r.name}`} />
                  <div className="min-w-0 flex-1 basis-44">
                    <Link href={`/customers/${r.id}`} className="font-semibold hover:text-brand">
                      {r.name}
                    </Link>
                    <div className="text-xs text-muted">
                      {r.phone ?? 'No phone'} · {d === null ? 'old debt' : `${d} day${d === 1 ? '' : 's'}`}
                    </div>
                  </div>
                  <div className={`font-display text-xl font-bold ${r.over_limit ? 'text-red-300' : 'text-brand'}`}>KES {money(r.balance)}</div>
                  {r.phone && (
                    <a href={`https://wa.me/${waNumber(r.phone)}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="rounded-lg border border-charcoal-3 px-3 py-1.5 text-sm hover:bg-charcoal-3">
                      WhatsApp
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-xl font-bold">Send SMS</h2>
        {allowed && !allowed.plan_ok ? (
          <Alert kind="info">SMS reminders come with the Growth and Chain plans. On your plan, use the WhatsApp buttons above.</Alert>
        ) : (
          <>
            <Button onClick={sendSms} disabled={busy || picked.size === 0}>
              {busy ? 'Sending...' : `Send SMS to ${picked.size} customer${picked.size === 1 ? '' : 's'}`}
            </Button>
            <p className="text-xs text-muted">SMS costs a small amount per message, charged by your SMS provider.</p>
          </>
        )}
        {result && (
          <Alert kind={result.failed > 0 ? 'info' : 'success'}>
            Sent {result.sent}. {result.failed > 0 ? `${result.failed} failed.` : ''}
            <ul className="mt-1 list-disc pl-5 text-xs">
              {result.results
                .filter((x: any) => x.status !== 'sent')
                .map((x: any) => (
                  <li key={x.customer_id}>
                    {x.name}: {x.error}
                  </li>
                ))}
            </ul>
          </Alert>
        )}
      </Card>
    </div>
  )
}
