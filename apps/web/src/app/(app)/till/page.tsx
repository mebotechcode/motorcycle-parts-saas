'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Field, Select, Spinner } from '@/components/ui'
import { money } from '@/lib/pos'
import { getLang, t } from '@/lib/i18n'

type Sess = {
  id: string
  branch_id: string
  status: 'open' | 'closed'
  opened_by: string
  opened_at: string
  closed_at: string | null
  opening_float: number
  cash_variance: number | null
}

export default function TillPage() {
  const { claims, session } = useSession()
  const role = claims.tenant_role
  const manager = role === 'owner' || role === 'manager'
  const uid = session?.user.id
  const lang = getLang()

  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [branchId, setBranchId] = useState('')
  const [list, setList] = useState<Sess[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState('')
  const [totals, setTotals] = useState<any>(null)
  const [float, setFloat] = useState('')
  const [counted, setCounted] = useState('')
  const [countedMpesa, setCountedMpesa] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [unverified, setUnverified] = useState<any[]>([])

  useEffect(() => {
    supabase
      .from('branches')
      .select('id,name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        const mine = ((data as any[]) ?? []).filter((b) => claims.all_branches || (claims.branch_ids ?? []).includes(b.id))
        setBranches(mine)
        setBranchId((cur) => cur || mine[0]?.id || '')
      })
  }, [claims.all_branches, claims.branch_ids])

  const load = useCallback(async () => {
    if (!branchId) return
    const { data } = await supabase
      .from('cash_sessions')
      .select('id,branch_id,status,opened_by,opened_at,closed_at,opening_float,cash_variance')
      .eq('branch_id', branchId)
      .order('opened_at', { ascending: false })
      .limit(15)
    const rows = (data as Sess[]) ?? []
    setList(rows)
    const ids = Array.from(new Set(rows.map((r) => r.opened_by)))
    if (ids.length) {
      const { data: p } = await supabase.from('profiles').select('id,full_name').in('id', ids)
      const m: Record<string, string> = {}
      ;((p as any[]) ?? []).forEach((x) => (m[x.id] = x.full_name || 'Staff'))
      setNames(m)
    }
    setSelected((cur) => {
      if (cur && rows.find((r) => r.id === cur)) return cur
      return rows.find((r) => r.status === 'open' && r.opened_by === uid)?.id ?? ''
    })
    if (manager) {
      const { data: uv } = await supabase.from('unverified_mpesa_payments').select('id,amount,reference,paid_at').order('paid_at', { ascending: false }).limit(50)
      setUnverified((uv as any[]) ?? [])
    }
  }, [branchId, uid, manager])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!selected) {
      setTotals(null)
      return
    }
    // Blind totals while open: expected cash/M-Pesa stays hidden until close
    supabase.rpc('session_totals_blind', { p_session_id: selected }).then(({ data, error }) => {
      if (error) {
        // Fallback for older DBs without the blind function
        supabase.rpc('session_totals', { p_session_id: selected }).then((r2) => {
          if (r2.error) setError(r2.error.message)
          else setTotals(r2.data)
        })
      } else setTotals(data)
    })
  }, [selected, list])

  if (role === 'storekeeper') return <Alert kind="info">Storekeepers do not use the till.</Alert>

  const current = list?.find((r) => r.id === selected)
  const myOpen = list?.find((r) => r.status === 'open' && r.opened_by === uid)
  const isBlind = current?.status === 'open' && totals?.blind === true

  async function openTill(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    const { data, error } = await supabase.rpc('open_cash_session', { p_branch_id: branchId, p_float: Number(float || 0) })
    setBusy(false)
    if (error) return setError(error.message)
    setFloat('')
    setSelected(data as string)
    await load()
  }

  async function closeTill(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (counted.trim() === '' || Number(counted) < 0) return setError('Enter the cash you counted in the drawer')
    if (countedMpesa.trim() !== '' && Number(countedMpesa) < 0) return setError('Enter the M-Pesa Till total you counted')
    if (!window.confirm('Close this till? New sales will start a new one.')) return
    setBusy(true)
    const { data, error } = await supabase.rpc('close_cash_session_blind', {
      p_session_id: selected,
      p_counted_cash: Number(counted),
      p_counted_mpesa: countedMpesa.trim() === '' ? null : Number(countedMpesa),
      p_notes: notes || null,
    })
    setBusy(false)
    if (error) return setError(error.message)
    const v = Number((data as any).cash_variance)
    const mv = (data as any).mpesa_variance
    setInfo(
      (v === 0 ? 'Till closed. The cash is exactly right.' : v < 0 ? `Till closed. The drawer is SHORT by KES ${money(Math.abs(v))}.` : `Till closed. The drawer has EXTRA KES ${money(v)}.`) +
        (mv !== null && mv !== undefined ? ` M-Pesa ${Number(mv) === 0 ? 'matches.' : Number(mv) < 0 ? `is short by KES ${money(Math.abs(Number(mv)))}.` : `has extra KES ${money(Number(mv))}.`}` : '')
    )
    setCounted('')
    setCountedMpesa('')
    setNotes('')
    await load()
  }

  async function verifyPayment(id: string) {
    const { error } = await supabase.rpc('verify_mpesa_payment', { p_payment_id: id, p_verified: true })
    if (error) return setError(error.message)
    setUnverified((p) => p.filter((x) => x.id !== id))
  }

  const Row = ({ label, value, strong }: { label: string; value: any; strong?: boolean }) => (
    <div className={`flex justify-between py-1.5 ${strong ? 'text-lg font-bold' : 'text-sm'}`}>
      <span className={strong ? '' : 'text-muted'}>{label}</span>
      <span>KES {money(value)}</span>
    </div>
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-4xl font-bold">{t('till', lang)}</h1>
        <p className="text-sm text-muted">Blind cash-up: count the drawer and the M-Pesa Till without seeing the system total, then compare.</p>
        <Link href="/expenses" className="mt-1 inline-block text-sm text-brand hover:underline">
          Record an expense (cash is taken from this till)
        </Link>
      </div>

      {branches.length > 1 && (
        <div className="w-60">
          <Select value={branchId} onChange={(e) => { setBranchId(e.target.value); setSelected('') }}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {error && <Alert>{error}</Alert>}
      {info && <Alert kind="success">{info}</Alert>}

      {list === null ? (
        <Spinner />
      ) : (
        <>
          {!myOpen && (
            <Card className="space-y-3">
              <h2 className="text-xl font-bold">{t('openTill', lang)}</h2>
              <p className="text-sm text-muted">If you start the day with cash in the drawer, enter it here. (If you skip this, your first sale opens a till with 0 cash.)</p>
              <form onSubmit={openTill} className="flex flex-wrap items-end gap-3">
                <div className="w-48">
                  <Field label="Cash in drawer now (KES)" type="number" inputMode="decimal" min={0} value={float} onChange={(e) => setFloat(e.target.value)} />
                </div>
                <Button type="submit" disabled={busy}>
                  Open till
                </Button>
              </form>
            </Card>
          )}

          {current && totals && (
            <Card className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-bold">
                  {current.status === 'open' ? 'Open till' : 'Closed till'} · {names[current.opened_by] ?? 'Staff'}
                </h2>
                <span className="text-xs text-muted">Opened {new Date(current.opened_at).toLocaleString('en-KE')}</span>
              </div>

              {isBlind ? (
                <Alert kind="info">{t('blindNote', lang)} Sales so far: {totals.sales_count} · KES {money(totals.sales_total)}</Alert>
              ) : (
                <>
                  <div className="divide-y divide-charcoal-3">
                    <Row label="Cash at the start" value={totals.opening_float} />
                    <Row label="Cash sales" value={totals.cash_in} />
                    <Row label="Cash refunds" value={-Number(totals.cash_refunds)} />
                    <Row label="Cash expenses" value={-Number(totals.cash_expenses)} />
                    <Row label="Paid to suppliers (cash)" value={-Number(totals.cash_supplier_payments ?? 0)} />
                    <Row label="Cash that should be in the drawer" value={totals.expected_cash} strong />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-sm">
                    <div className="rounded-lg bg-charcoal p-2"><div className="text-xs text-muted">M-Pesa</div>KES {money(totals.mpesa_in)}</div>
                    <div className="rounded-lg bg-charcoal p-2"><div className="text-xs text-muted">Bank</div>KES {money(totals.bank_in)}</div>
                    <div className="rounded-lg bg-charcoal p-2"><div className="text-xs text-muted">Sales</div>{totals.sales_count} · KES {money(totals.sales_total)}</div>
                  </div>
                </>
              )}

              {current.status === 'open' ? (
                <form onSubmit={closeTill} className="space-y-3 rounded-xl border border-charcoal-3 p-3">
                  <h3 className="text-lg font-bold">{t('closeTill', lang)}</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t('countedCash', lang)} type="number" inputMode="decimal" min={0} value={counted} onChange={(e) => setCounted(e.target.value)} />
                    <Field label={t('countedMpesa', lang)} type="number" inputMode="decimal" min={0} value={countedMpesa} onChange={(e) => setCountedMpesa(e.target.value)} />
                  </div>
                  {!isBlind && counted !== '' && !Number.isNaN(Number(counted)) && (
                    <p className={`text-sm ${Number(counted) === Number(totals.expected_cash) ? 'text-emerald-300' : 'text-brand'}`}>
                      {Number(counted) === Number(totals.expected_cash)
                        ? 'Exactly right.'
                        : Number(counted) < Number(totals.expected_cash)
                        ? `Short by KES ${money(Number(totals.expected_cash) - Number(counted))}`
                        : `Extra KES ${money(Number(counted) - Number(totals.expected_cash))}`}
                    </p>
                  )}
                  <Field label="Note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  <Button type="submit" disabled={busy}>
                    {busy ? 'Closing...' : 'Close till'}
                  </Button>
                </form>
              ) : (
                <div className="rounded-lg bg-charcoal p-3 text-sm">
                  Counted <b>KES {money(totals.counted_cash)}</b> · Difference{' '}
                  <b className={Number(totals.cash_variance) === 0 ? 'text-emerald-300' : 'text-brand'}>
                    {Number(totals.cash_variance) > 0 ? '+' : ''}
                    {money(totals.cash_variance)}
                  </b>
                </div>
              )}
            </Card>
          )}

          {manager && unverified.length > 0 && (
            <Card className="space-y-3 border-brand/40">
              <h2 className="text-xl font-bold">{t('verifyMpesa', lang)} ({unverified.length})</h2>
              <p className="text-sm text-muted">Manual M-Pesa codes entered at the till. Check them against your Till statement, then verify.</p>
              <div className="space-y-2">
                {unverified.map((u) => (
                  <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-charcoal-3 bg-charcoal p-3 text-sm">
                    <span><b>{u.reference}</b> · KES {money(u.amount)} · {new Date(u.paid_at).toLocaleString('en-KE')}</span>
                    <Button variant="ghost" onClick={() => verifyPayment(u.id)}>Verify</Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="space-y-2">
            <h2 className="text-xl font-bold">Recent tills</h2>
            {list.length === 0 ? (
              <p className="text-sm text-muted">No tills yet. The first sale opens one.</p>
            ) : (
              list.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => setSelected(r.id)}
                  className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-left text-sm hover:border-brand/60 ${selected === r.id ? 'border-brand' : 'border-charcoal-3'}`}
                >
                  <span>
                    {new Date(r.opened_at).toLocaleDateString('en-KE')} · {names[r.opened_by] ?? 'Staff'}
                  </span>
                  <span className="text-xs">
                    {r.status === 'open' ? (
                      <span className="rounded bg-brand/15 px-2 py-0.5 text-brand">Open</span>
                    ) : (
                      <span className={Number(r.cash_variance) === 0 ? 'text-emerald-300' : 'text-brand'}>
                        {Number(r.cash_variance) === 0 ? 'Balanced' : `Difference ${Number(r.cash_variance) > 0 ? '+' : ''}${money(r.cash_variance)}`}
                      </span>
                    )}
                  </span>
                </button>
              ))
            )}
            {!manager && <p className="text-xs text-muted">You only see your own tills.</p>}
          </Card>
        </>
      )}
    </div>
  )
}
