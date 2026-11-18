'use client'

// Super-admin console for the SaaS owner (you). Visible only to platform
// admins (migration 02/09). Shop sales/stock data is read-only even here;
// actions are limited to plans/subscriptions/tenant status and are all
// audited (admin_audit_log, via security-definer RPCs that re-check you).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Select, Spinner } from '@/components/ui'
import { money } from '@/lib/pos'

const PLANS = ['starter', 'growth', 'chain'] as const

export default function AdminPage() {
  const { loading, claims } = useSession()
  const isAdmin = !!claims.platform_admin

  const [overview, setOverview] = useState<any>(null)
  const [rows, setRows] = useState<any[] | null>(null)
  const [actions, setActions] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    if (!isAdmin) return
    setError('')
    const [ov, tn, ac] = await Promise.all([
      supabase.rpc('admin_overview'),
      supabase.rpc('admin_tenants'),
      supabase.rpc('admin_recent_actions', { p_limit: 15 }),
    ])
    if (ov.error) return setError(ov.error.message)
    if (tn.error) return setError(tn.error.message)
    setOverview(ov.data)
    setRows((tn.data as any[]) ?? [])
    setActions((ac.data as any[]) ?? [])
  }, [isAdmin])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    if (!rows) return []
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r) => [r.name, r.slug, r.town, r.plan].some((v) => String(v ?? '').toLowerCase().includes(s)))
  }, [rows, q])

  if (loading) return <Spinner />
  if (!isAdmin) return <Alert kind="info">This page is for the NafPOS platform owner only.</Alert>

  async function run(action: string, payload: Record<string, unknown>, msg: string) {
    setBusy(action)
    setError('')
    setInfo('')
    const { error } = await supabase.rpc(action, payload)
    setBusy('')
    if (error) return setError(error.message)
    setInfo(msg)
    await load()
  }

  const act = overview ?? {}
  const kpis: [string, string][] = [
    ['Shops', String(act.tenants_total ?? '—')],
    ['Active', String(act.tenants_active ?? '—')],
    ['Suspended', String(act.tenants_suspended ?? '—')],
    ['Trialing', String(act.trials_trialing ?? '—')],
    ['Past due', String(act.subs_past_due ?? '—')],
    ['MRR', `KES ${money(act.mrr ?? 0)}`],
    ['ARR run-rate', `KES ${money(act.arr_run_rate ?? 0)}`],
    ['Signups (30d)', String(act.signups_30d ?? '—')],
    ['Open invoices', `${act.open_invoices ?? 0} · KES ${money(act.open_invoice_amount ?? 0)}`],
    ['Collected (30d)', `KES ${money(act.collected_30d ?? 0)}`],
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-4xl font-bold">Super admin</h1>
        <p className="text-sm text-muted">
          You alone. You can see every shop and change plans, trials and suspensions. Shop sales, stock and customer
          data stay read-only for you — and every action you take is written to the audit log.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}
      {info && <Alert kind="success">{info}</Alert>}
      {!overview && !error && <Spinner />}

      {overview && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {kpis.slice(0, 5).map(([label, value]) => (
              <Card key={label}>
                <div className="text-xs text-muted">{label}</div>
                <div className="font-display text-2xl font-bold">{value}</div>
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {kpis.slice(5).map(([label, value]) => (
              <Card key={label}>
                <div className="text-xs text-muted">{label}</div>
                <div className="font-display text-xl font-bold sm:text-2xl">{value}</div>
              </Card>
            ))}
          </div>
          {Array.isArray(act.plan_mix) && act.plan_mix.length > 0 && (
            <div className="flex flex-wrap gap-2 text-sm">
              {act.plan_mix.map((p: any) => (
                <span key={p.plan} className="rounded-full border border-charcoal-3 bg-charcoal-2 px-3 py-1.5">
                  {p.plan}: <b>{p.count}</b>
                </span>
              ))}
            </div>
          )}
        </>
      )}

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-bold">Shops ({filtered.length})</h2>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, slug, town, plan..."
            className="w-64 rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2 text-sm placeholder:text-muted/60 focus:border-brand focus:outline-none"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1.5 pr-2 font-medium">Shop</th>
                <th className="px-2 py-1.5 font-medium">Plan</th>
                <th className="px-2 py-1.5 font-medium">Subscription</th>
                <th className="px-2 py-1.5 font-medium">Trial ends</th>
                <th className="px-2 py-1.5 font-medium">Period / grace</th>
                <th className="px-2 py-1.5 text-right font-medium">Staff</th>
                <th className="px-2 py-1.5 font-medium">Last sale</th>
                <th className="py-1.5 pl-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-charcoal-3 align-top">
                  <td className="py-2 pr-2">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted">
                      {r.slug}
                      {r.town ? ` · ${r.town}` : ''} · since {new Date(r.created_at).toLocaleDateString('en-KE')}
                    </div>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${r.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : r.status === 'suspended' ? 'bg-red-400/15 text-red-300' : 'bg-charcoal-3 text-muted'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <Select
                      aria-label={`Plan for ${r.name}`}
                      value={r.plan === '—' ? 'starter' : String(r.plan).toLowerCase()}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                        const plan = e.target.value
                        if (window.confirm(`Change ${r.name} to the ${plan} plan?`)) {
                          run('admin_set_plan', { p_tenant_id: r.id, p_plan_code: plan, p_note: 'admin console' }, `Plan changed to ${plan}.`)
                        }
                      }}
                    >
                      {PLANS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-2 py-2">{r.sub_status}</td>
                  <td className="px-2 py-2">{r.trial_ends_at ? new Date(r.trial_ends_at).toLocaleDateString('en-KE') : '—'}</td>
                  <td className="px-2 py-2 text-xs">
                    {r.current_period_end ? new Date(r.current_period_end).toLocaleDateString('en-KE') : '—'}
                    {r.grace_ends_at && <div className="text-red-300">grace until {new Date(r.grace_ends_at).toLocaleDateString('en-KE')}</div>}
                  </td>
                  <td className="px-2 py-2 text-right">{r.members}</td>
                  <td className="px-2 py-2">{r.last_sale_at ? new Date(r.last_sale_at).toLocaleDateString('en-KE') : 'never'}</td>
                  <td className="py-2 pl-2">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => {
                          const next = r.status === 'suspended' ? 'active' : 'suspended'
                          if (window.confirm(`${next === 'suspended' ? 'Suspend' : 'Reactivate'} ${r.name}?${next === 'suspended' ? ' They will get read-only access immediately.' : ''}`)) {
                            run('admin_set_tenant_status', { p_tenant_id: r.id, p_status: next, p_note: 'admin console' }, `${r.name} is now ${next}.`)
                          }
                        }}
                        className="rounded-lg border border-charcoal-3 px-2.5 py-1.5 text-xs font-semibold hover:bg-charcoal-3 disabled:opacity-50"
                      >
                        {r.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                      </button>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => run('admin_extend_trial', { p_tenant_id: r.id, p_days: 7, p_note: 'admin console' }, `Trial extended by 7 days.`)}
                        className="rounded-lg border border-charcoal-3 px-2.5 py-1.5 text-xs font-semibold hover:bg-charcoal-3 disabled:opacity-50"
                      >
                        +7d trial
                      </button>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => run('admin_extend_trial', { p_tenant_id: r.id, p_days: 30, p_note: 'admin console' }, `Trial extended by 30 days.`)}
                        className="rounded-lg border border-charcoal-3 px-2.5 py-1.5 text-xs font-semibold hover:bg-charcoal-3 disabled:opacity-50"
                      >
                        +30d
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-muted">
                    No shops match “{q}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-xl font-bold">Recent admin actions</h2>
        {actions.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet — every action above will show up here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1.5 pr-2 font-medium">When</th>
                  <th className="px-2 py-1.5 font-medium">Admin</th>
                  <th className="px-2 py-1.5 font-medium">Action</th>
                  <th className="px-2 py-1.5 font-medium">Shop</th>
                  <th className="py-1.5 pl-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((a) => (
                  <tr key={a.id} className="border-t border-charcoal-3">
                    <td className="py-1.5 pr-2 text-muted">{new Date(a.created_at).toLocaleString('en-KE')}</td>
                    <td className="px-2 py-1.5">{a.admin_email ?? a.admin_id.slice(0, 8)}</td>
                    <td className="px-2 py-1.5 font-mono text-xs">{a.action}</td>
                    <td className="px-2 py-1.5">{a.tenant_name ?? '—'}</td>
                    <td className="py-1.5 pl-2 text-xs text-muted">{JSON.stringify(a.detail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
