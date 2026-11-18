'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Select, Spinner } from '@/components/ui'
import { money } from '@/lib/pos'

const PLANS = ['starter', 'growth', 'chain'] as const

function keDate(v?: string | null) {
  return v ? new Date(v).toLocaleDateString('en-KE') : '—'
}
function keWhen(v?: string | null) {
  return v ? new Date(v).toLocaleString('en-KE') : '—'
}
function waLink(phone?: string | null) {
  if (!phone) return null
  let n = phone.replace(/\D/g, '')
  if (n.startsWith('0')) n = '254' + n.slice(1)
  if (n.length < 10) return null
  return `https://wa.me/${n}`
}

export default function AdminShopPage() {
  const { id } = useParams<{ id: string }>()
  const { loading, claims } = useSession()
  const isAdmin = !!claims.platform_admin

  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    if (!isAdmin || !id) return
    setError('')
    const { data, error } = await supabase.rpc('admin_shop', { p_tenant_id: id })
    if (error) return setError(error.message)
    setData(data)
  }, [isAdmin, id])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <Spinner />
  if (!isAdmin) return <Alert kind="info">This page is for the NafPOS platform owner only.</Alert>

  async function run(action: string, payload: Record<string, unknown>, msg: string) {
    setBusy(action)
    setError('')
    setInfo('')
    const { error } = await supabase.rpc(action, payload)
    setBusy('')
    if (error) {
      setError(error.message)
      return false
    }
    setInfo(msg)
    await load()
    return true
  }

  if (!data && !error) return <Spinner />
  const t = data?.tenant
  const sub = data?.subscription
  const staff: any[] = data?.staff ?? []
  const invoices: any[] = data?.invoices ?? []
  const health = data?.health ?? {}
  const notes: any[] = data?.notes ?? []
  const actions: any[] = data?.actions ?? []
  const owner = staff.find((s) => s.role === 'owner') ?? staff[0]
  const wa = waLink(owner?.phone || t?.phone)

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin" className="text-sm text-muted hover:text-offwhite">
          ← All shops
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-4xl font-bold">{t?.name ?? 'Shop'}</h1>
            <p className="text-sm text-muted">
              {t?.slug}
              {t?.town ? ` · ${t.town}` : ''} · since {keDate(t?.created_at)}
            </p>
          </div>
          {t && (
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${t.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : t.status === 'suspended' ? 'bg-red-400/15 text-red-300' : 'bg-charcoal-3 text-muted'}`}
            >
              {t.status}
            </span>
          )}
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {info && <Alert kind="success">{info}</Alert>}
      {!t && error && (
        <p className="text-sm text-muted">
          <Link href="/admin" className="text-brand hover:underline">
            Back to shops
          </Link>
        </p>
      )}
      {!t && !error && <Spinner />}

      {t && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {t.status === 'closed' ? (
              <button
                type="button"
                disabled={!!busy}
                onClick={() => {
                  if (window.confirm(`Reopen ${t.name}? They will be able to sign in again.`)) {
                    run('admin_set_tenant_status', { p_tenant_id: t.id, p_status: 'active', p_note: 'shop page' }, `${t.name} is now active.`)
                  }
                }}
                className="rounded-lg border border-charcoal-3 px-3 py-2 text-sm font-semibold hover:bg-charcoal-3 disabled:opacity-50"
              >
                Reopen shop
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => {
                    const next = t.status === 'suspended' ? 'active' : 'suspended'
                    if (
                      window.confirm(
                        `${next === 'suspended' ? 'Suspend' : 'Reactivate'} ${t.name}?${next === 'suspended' ? ' They will get read-only access immediately.' : ''}`,
                      )
                    ) {
                      run('admin_set_tenant_status', { p_tenant_id: t.id, p_status: next, p_note: 'shop page' }, `${t.name} is now ${next}.`)
                    }
                  }}
                  className="rounded-lg border border-charcoal-3 px-3 py-2 text-sm font-semibold hover:bg-charcoal-3 disabled:opacity-50"
                >
                  {t.status === 'suspended' ? 'Reactivate shop' : 'Suspend shop'}
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => {
                    if (window.confirm(`Close ${t.name}? They lose access. Data is kept; you can reopen later.`)) {
                      run('admin_set_tenant_status', { p_tenant_id: t.id, p_status: 'closed', p_note: 'shop page' }, `${t.name} is closed.`)
                    }
                  }}
                  className="rounded-lg border border-red-900/60 px-3 py-2 text-sm font-semibold text-red-300 hover:bg-charcoal-3 disabled:opacity-50"
                >
                  Close shop
                </button>
              </>
            )}
            <button
              type="button"
              disabled={!!busy}
              onClick={() => run('admin_extend_trial', { p_tenant_id: t.id, p_days: 7, p_note: 'shop page' }, 'Trial extended by 7 days.')}
              className="rounded-lg border border-charcoal-3 px-3 py-2 text-sm font-semibold hover:bg-charcoal-3 disabled:opacity-50"
            >
              +7d trial
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => run('admin_extend_trial', { p_tenant_id: t.id, p_days: 30, p_note: 'shop page' }, 'Trial extended by 30 days.')}
              className="rounded-lg border border-charcoal-3 px-3 py-2 text-sm font-semibold hover:bg-charcoal-3 disabled:opacity-50"
            >
              +30d trial
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="space-y-2">
              <h2 className="text-lg font-bold">Contact</h2>
              <dl className="space-y-1 text-sm">
                <div>
                  <dt className="text-xs text-muted">Owner</dt>
                  <dd>{owner?.full_name || '—'} {owner?.email ? `· ${owner.email}` : ''}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Shop phone</dt>
                  <dd>
                    {t.phone ? (
                      <a href={`tel:${t.phone}`} className="text-brand hover:underline">
                        {t.phone}
                      </a>
                    ) : (
                      '—'
                    )}
                    {wa && (
                      <>
                        {' · '}
                        <a href={wa} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                          WhatsApp
                        </a>
                      </>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Email</dt>
                  <dd>
                    {t.email ? (
                      <a href={`mailto:${t.email}`} className="text-brand hover:underline">
                        {t.email}
                      </a>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Address</dt>
                  <dd>{t.address || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">KRA PIN</dt>
                  <dd>{t.kra_pin || '—'} {t.vat_registered ? '· VAT registered' : ''}</dd>
                </div>
              </dl>
            </Card>

            <Card className="space-y-2">
              <h2 className="text-lg font-bold">Subscription</h2>
              {sub ? (
                <dl className="space-y-1 text-sm">
                  <div>
                    <dt className="text-xs text-muted">Plan</dt>
                    <dd>
                      <Select
                        aria-label="Plan"
                        value={sub.plan_code || 'starter'}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                          const plan = e.target.value
                          if (window.confirm(`Change ${t.name} to the ${plan} plan?`)) {
                            run('admin_set_plan', { p_tenant_id: t.id, p_plan_code: plan, p_note: 'shop page' }, `Plan changed to ${plan}.`)
                          }
                        }}
                      >
                        {PLANS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </Select>
                      <div className="mt-1 text-muted">
                        {sub.plan} · KES {money(sub.price_monthly)} / month · {sub.billing_cycle}
                      </div>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Status</dt>
                    <dd>{sub.status}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Trial ends</dt>
                    <dd>{keDate(sub.trial_ends_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Current period</dt>
                    <dd>
                      {keDate(sub.current_period_start)} → {keDate(sub.current_period_end)}
                    </dd>
                  </div>
                  {sub.grace_ends_at && (
                    <div>
                      <dt className="text-xs text-muted">Grace until</dt>
                      <dd className="text-red-300">{keDate(sub.grace_ends_at)}</dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="text-sm text-muted">No subscription row.</p>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ['Last sale', health.last_sale_at ? keDate(health.last_sale_at) : 'never'],
              ['Sales (7d)', String(health.sales_7d ?? 0)],
              ['M-Pesa failed (7d)', String(health.mpesa_failed_7d ?? 0)],
              ['M-Pesa unmatched', String(health.mpesa_unmatched ?? 0)],
              ['eTIMS pending', String(health.etims_pending ?? 0)],
              ['eTIMS failed', String(health.etims_failed ?? 0)],
            ].map(([label, value]) => (
              <Card key={label}>
                <div className="text-xs text-muted">{label}</div>
                <div className="font-display text-xl font-bold">{value}</div>
              </Card>
            ))}
          </div>

          <Card className="space-y-3">
            <h2 className="text-lg font-bold">Staff ({staff.length})</h2>
            {staff.length === 0 ? (
              <p className="text-sm text-muted">No members.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">Name</th>
                      <th className="px-2 py-1.5 font-medium">Email</th>
                      <th className="px-2 py-1.5 font-medium">Phone</th>
                      <th className="px-2 py-1.5 font-medium">Role</th>
                      <th className="py-1.5 pl-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((s) => (
                      <tr key={s.user_id} className="border-t border-charcoal-3">
                        <td className="py-1.5 pr-2">{s.full_name || '—'}</td>
                        <td className="px-2 py-1.5">{s.email || '—'}</td>
                        <td className="px-2 py-1.5">{s.phone || '—'}</td>
                        <td className="px-2 py-1.5">{s.role}</td>
                        <td className="py-1.5 pl-2">{s.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="space-y-3">
            <h2 className="text-lg font-bold">Billing invoices</h2>
            <p className="text-xs text-muted">
              Mark paid if they paid you outside M-Pesa (cash, bank). This activates the subscription for the
              invoice period. It does not unsuspend a shop you froze yourself.
            </p>
            {invoices.length === 0 ? (
              <p className="text-sm text-muted">No invoices yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">Period</th>
                      <th className="px-2 py-1.5 font-medium">Plan</th>
                      <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                      <th className="px-2 py-1.5 font-medium">Due</th>
                      <th className="px-2 py-1.5 font-medium">Status</th>
                      <th className="py-1.5 pl-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((i) => (
                      <tr key={i.id} className="border-t border-charcoal-3">
                        <td className="py-1.5 pr-2">
                          {keDate(i.period_start)} → {keDate(i.period_end)}
                        </td>
                        <td className="px-2 py-1.5">{i.plan}</td>
                        <td className="px-2 py-1.5 text-right">KES {money(i.amount)}</td>
                        <td className="px-2 py-1.5">{keDate(i.due_date)}</td>
                        <td className="px-2 py-1.5">
                          {i.status}
                          {i.paid_at ? ` · ${keDate(i.paid_at)}` : ''}
                        </td>
                        <td className="py-1.5 pl-2">
                          {i.status === 'open' && (
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                disabled={!!busy}
                                onClick={() => {
                                  if (window.confirm(`Mark invoice of KES ${money(i.amount)} as paid? This extends/activates their subscription.`)) {
                                    run('admin_mark_invoice_paid', { p_invoice_id: i.id, p_note: 'shop page' }, 'Invoice marked paid.')
                                  }
                                }}
                                className="rounded-lg border border-charcoal-3 px-2.5 py-1.5 text-xs font-semibold hover:bg-charcoal-3 disabled:opacity-50"
                              >
                                Mark paid
                              </button>
                              <button
                                type="button"
                                disabled={!!busy}
                                onClick={() => {
                                  if (window.confirm('Void this invoice? It cannot be collected afterwards.')) {
                                    run('admin_void_invoice', { p_invoice_id: i.id, p_note: 'shop page' }, 'Invoice voided.')
                                  }
                                }}
                                className="rounded-lg border border-charcoal-3 px-2.5 py-1.5 text-xs font-semibold hover:bg-charcoal-3 disabled:opacity-50"
                              >
                                Void
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="space-y-3">
            <h2 className="text-lg font-bold">Support notes</h2>
            <p className="text-xs text-muted">Only you see these. The shop owner cannot.</p>
            <form
              className="space-y-2"
              onSubmit={async (e) => {
                e.preventDefault()
                const body = note.trim()
                if (!body) return
                const ok = await run('admin_add_note', { p_tenant_id: t.id, p_body: body }, 'Note saved.')
                if (ok) setNote('')
              }}
            >
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="Called owner, promised to pay Friday…"
                className="w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2 text-sm placeholder:text-muted/60 focus:border-brand focus:outline-none"
              />
              <Button type="submit" disabled={!!busy || !note.trim()}>
                Save note
              </Button>
            </form>
            {notes.length === 0 ? (
              <p className="text-sm text-muted">No notes yet.</p>
            ) : (
              <ul className="space-y-3">
                {notes.map((n) => (
                  <li key={n.id} className="border-t border-charcoal-3 pt-3 text-sm">
                    <div className="text-xs text-muted">
                      {keWhen(n.created_at)} · {n.admin_email ?? 'admin'}
                    </div>
                    <p className="whitespace-pre-wrap">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="space-y-3">
            <h2 className="text-lg font-bold">Actions on this shop</h2>
            {actions.length === 0 ? (
              <p className="text-sm text-muted">None yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">When</th>
                      <th className="px-2 py-1.5 font-medium">Admin</th>
                      <th className="px-2 py-1.5 font-medium">Action</th>
                      <th className="py-1.5 pl-2 font-medium">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actions.map((a) => (
                      <tr key={a.id} className="border-t border-charcoal-3">
                        <td className="py-1.5 pr-2 text-muted">{keWhen(a.created_at)}</td>
                        <td className="px-2 py-1.5">{a.admin_email ?? '—'}</td>
                        <td className="px-2 py-1.5 font-mono text-xs">{a.action}</td>
                        <td className="py-1.5 pl-2 text-xs text-muted">{JSON.stringify(a.detail)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
