'use client'

// Super-admin console (SaaS operator). Shop sales/stock stay read-only;
// actions go through security-definer RPCs and are audited.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Card, Select, Spinner } from '@/components/ui'
import { money } from '@/lib/pos'
import { friendlyError } from '@/lib/errors'

const PLANS = ['starter', 'growth', 'chain'] as const
const FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'closed', label: 'Closed' },
]
const PAGE_SIZE = 25

function keDate(v?: string | null) {
  return v ? new Date(v).toLocaleDateString('en-KE') : '—'
}

export default function AdminPage() {
  const { loading, claims } = useSession()
  const isAdmin = !!claims.platform_admin

  const [overview, setOverview] = useState<any>(null)
  const [rows, setRows] = useState<any[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [actions, setActions] = useState<any[]>([])
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState('')
  const [listLoading, setListLoading] = useState(false)

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to = Math.min(page * PAGE_SIZE, total)

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [qInput])

  const loadOverview = useCallback(async () => {
    if (!isAdmin) return
    const [ov, ac] = await Promise.all([
      supabase.rpc('admin_overview'),
      supabase.rpc('admin_recent_actions', { p_limit: 15 }),
    ])
    if (ov.error) setError(friendlyError(ov.error))
    else setOverview(ov.data)
    setActions((ac.data as any[]) ?? [])
  }, [isAdmin])

  const loadList = useCallback(async () => {
    if (!isAdmin) return
    setListLoading(true)
    const { data, error } = await supabase.rpc('admin_tenants', {
      p_q: q,
      p_status: status,
      p_page: page,
      p_page_size: PAGE_SIZE,
    })
    setListLoading(false)
    if (error) return setError(friendlyError(error))
    const payload = data as { total?: number; rows?: any[] } | any[]
    // Paginated v2 returns {total, rows}; old table RPC returned an array.
    if (Array.isArray(payload)) {
      setRows(payload)
      setTotal(payload.length)
    } else {
      setRows(payload?.rows ?? [])
      setTotal(Number(payload?.total ?? 0))
    }
  }, [isAdmin, q, status, page])

  useEffect(() => {
    loadOverview()
  }, [loadOverview])
  useEffect(() => {
    loadList()
  }, [loadList])

  if (loading) return <Spinner />
  if (!isAdmin) return <Alert kind="info">This page is for the NafPOS platform owner only.</Alert>

  async function run(action: string, payload: Record<string, unknown>, msg: string) {
    setBusy(action)
    setError('')
    setInfo('')
    const { error } = await supabase.rpc(action, payload)
    setBusy('')
    if (error) return setError(friendlyError(error))
    setInfo(msg)
    await Promise.all([loadList(), loadOverview()])
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
          You oversee every shop. Sales, stock and customers stay read-only. Open a shop for billing, notes and
          health.
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
          <h2 className="text-xl font-bold">
            Shops <span className="text-sm font-normal text-muted">({total})</span>
          </h2>
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search name, slug, town, phone, plan..."
            className="w-full max-w-xs rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2 text-sm placeholder:text-muted/60 focus:border-brand focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setStatus(f.id)
                setPage(1)
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${status === f.id ? 'bg-brand text-charcoal' : 'border border-charcoal-3 text-muted hover:bg-charcoal-3 hover:text-offwhite'}`}
            >
              {f.label}
            </button>
          ))}
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
              {(rows ?? []).map((r) => (
                <tr key={r.id} className="border-t border-charcoal-3 align-top">
                  <td className="py-2 pr-2">
                    <Link href={`/admin/shops/${r.id}`} className="font-medium text-brand hover:underline">
                      {r.name}
                    </Link>
                    <div className="text-xs text-muted">
                      {r.slug}
                      {r.town ? ` · ${r.town}` : ''} · since {keDate(r.created_at)}
                    </div>
                    <span
                      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${r.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : r.status === 'suspended' ? 'bg-red-400/15 text-red-300' : 'bg-charcoal-3 text-muted'}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <Select
                      aria-label={`Plan for ${r.name}`}
                      value={r.plan_code || (r.plan === '—' ? 'starter' : String(r.plan).toLowerCase())}
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
                  <td className="px-2 py-2">{keDate(r.trial_ends_at)}</td>
                  <td className="px-2 py-2 text-xs">
                    {keDate(r.current_period_end)}
                    {r.grace_ends_at && <div className="text-red-300">grace until {keDate(r.grace_ends_at)}</div>}
                  </td>
                  <td className="px-2 py-2 text-right">{r.members}</td>
                  <td className="px-2 py-2">{r.last_sale_at ? keDate(r.last_sale_at) : 'never'}</td>
                  <td className="py-2 pl-2">
                    <div className="flex flex-wrap gap-1.5">
                      <Link
                        href={`/admin/shops/${r.id}`}
                        className="rounded-lg border border-charcoal-3 px-2.5 py-1.5 text-xs font-semibold hover:bg-charcoal-3"
                      >
                        Open
                      </Link>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => {
                          const next = r.status === 'suspended' ? 'active' : 'suspended'
                          if (
                            window.confirm(
                              `${next === 'suspended' ? 'Suspend' : 'Reactivate'} ${r.name}?${next === 'suspended' ? ' They will get read-only access immediately.' : ''}`,
                            )
                          ) {
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
                        +7d
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-muted">
                    {q || status !== 'all' ? 'No shops match this search.' : 'No shops yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
          <span>
            {listLoading ? 'Loading…' : total === 0 ? '0 shops' : `Showing ${from}–${to} of ${total}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || listLoading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-charcoal-3 px-3 py-1.5 text-xs font-semibold hover:bg-charcoal-3 disabled:opacity-40"
            >
              Prev
            </button>
            <span>
              Page {Math.min(page, pages)} of {pages}
            </span>
            <button
              type="button"
              disabled={page >= pages || listLoading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-charcoal-3 px-3 py-1.5 text-xs font-semibold hover:bg-charcoal-3 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-xl font-bold">Recent admin actions</h2>
        {actions.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet — every action you take will show up here.</p>
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
                    <td className="px-2 py-1.5">
                      {a.tenant_id ? (
                        <Link href={`/admin/shops/${a.tenant_id}`} className="text-brand hover:underline">
                          {a.tenant_name ?? '—'}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
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
