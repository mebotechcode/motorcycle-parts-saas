'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Field, Select, Spinner } from '@/components/ui'
import { money } from '@/lib/pos'
import { TYPE_LABEL, type COverview } from '@/lib/customers'
import { t, useLang } from '@/lib/i18n'

const PAGE = 25

export default function CustomersPage() {
  const router = useRouter()
  const { claims } = useSession()
  const role = claims.tenant_role
  const manager = role === 'owner' || role === 'manager'
  const lang = useLang()

  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  // Honour ?filter=owing so the "Deni" sidebar entry lands pre-filtered (no useSearchParams needed)
  const [filter, setFilter] = useState(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('filter') === 'owing' ? 'owing' : 'all',
  )
  const [sort, setSort] = useState('name')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<COverview[] | null>(null)
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState<any>(null)
  const [error, setError] = useState('')

  const [adding, setAdding] = useState(false)
  const [nName, setNName] = useState('')
  const [nPhone, setNPhone] = useState('')
  const [nType, setNType] = useState('retail')
  const [nLimit, setNLimit] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(text)
      setPage(0)
    }, 300)
    return () => clearTimeout(t)
  }, [text])

  const load = useCallback(async () => {
    setError('')
    let query = supabase.from('customer_overview').select('*', { count: 'exact' }).is('deleted_at', null).eq('is_active', true)
    const s = q.trim().replace(/[,()%*\\]/g, ' ').trim()
    if (s) query = query.or(`name.ilike.%${s}%,phone.ilike.%${s}%`)
    if (filter === 'owing') query = query.gt('balance', 0)
    if (filter === 'over') query = query.eq('over_limit', true)
    if (sort === 'balance') query = query.order('balance', { ascending: false })
    else query = query.order('name')
    const { data, count, error } = await query.range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) {
      setError(error.message)
      setRows([])
      return
    }
    setRows((data as COverview[]) ?? [])
    setTotal(count ?? 0)
  }, [q, filter, sort, page])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (manager) supabase.rpc('customers_summary').then(({ data }) => setSummary(data))
  }, [manager])

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
        credit_limit: manager && nLimit ? Number(nLimit) : 0,
      })
      .select('id')
      .single()
    setBusy(false)
    if (error) return setError(error.message)
    router.push(`/customers/${(data as any).id}`)
  }

  if (role === 'storekeeper') return <Alert kind="info">Storekeepers do not use customer accounts.</Alert>

  const pages = Math.max(1, Math.ceil(total / PAGE))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold">{t('customers', lang)}</h1>
          <p className="text-sm text-muted">
            {rows === null ? t('loading', lang) : `${total} ${t(total === 1 ? 'customerOne' : 'customerMany', lang)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {manager && (
            <Link href="/customers/commissions" className="rounded-lg border border-charcoal-3 px-4 py-2.5 text-sm font-semibold hover:bg-charcoal-3">
              {t('commissions', lang)}
            </Link>
          )}
          {manager && (
            <Link href="/customers/remind" className="rounded-lg border border-charcoal-3 px-4 py-2.5 text-sm font-semibold hover:bg-charcoal-3">
              {t('remindDebtors', lang)}
            </Link>
          )}
          <Button onClick={() => setAdding(!adding)}>{t('addCustomer', lang)}</Button>
        </div>
      </div>

      {manager && summary && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <div className="text-xs text-muted">Owe you</div>
            <div className="font-display text-2xl font-bold text-brand sm:text-4xl">KES {money(summary.total_owed)}</div>
          </Card>
          <Card>
            <div className="text-xs text-muted">Customers owing</div>
            <div className="font-display text-3xl font-bold sm:text-4xl">{summary.owing_count}</div>
          </Card>
          <Card>
            <div className="text-xs text-muted">Over their limit</div>
            <div className={`font-display text-3xl font-bold sm:text-4xl ${summary.over_limit_count > 0 ? 'text-red-300' : ''}`}>{summary.over_limit_count}</div>
          </Card>
        </div>
      )}

      {adding && (
        <Card>
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required value={nName} onChange={(e) => setNName(e.target.value)} />
            <Field label="Phone" type="tel" value={nPhone} onChange={(e) => setNPhone(e.target.value)} />
            <Select label="Type" value={nType} onChange={(e) => setNType(e.target.value)}>
              {Object.entries(TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
            {manager && <Field label="Credit limit (KES)" type="number" inputMode="decimal" min={0} value={nLimit} onChange={(e) => setNLimit(e.target.value)} hint="Leave empty for no credit" />}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving...' : 'Save customer'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="space-y-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('searchNamePhone', lang)}
          className="w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2.5 placeholder:text-muted/60 focus:border-brand focus:outline-none"
        />
        <div className="grid grid-cols-2 gap-2">
          <Select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0) }}>
            <option value="all">{t('allCustomers', lang)}</option>
            <option value="owing">{t('owingMoney', lang)}</option>
            <option value="over">{t('overCreditLimit', lang)}</option>
          </Select>
          <Select value={sort} onChange={(e) => { setSort(e.target.value); setPage(0) }}>
            <option value="name">{t('sortByName', lang)}</option>
            <option value="balance">{t('biggestDebtFirst', lang)}</option>
          </Select>
        </div>
      </Card>

      {error && <Alert>{error}</Alert>}

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-muted">No customers found.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((c) => (
            <Link key={c.id} href={`/customers/${c.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-charcoal-3 bg-charcoal-2 p-3 hover:border-brand/60">
              <div className="min-w-0">
                <div className="truncate font-semibold">{c.name}</div>
                <div className="text-xs text-muted">
                  {c.phone ?? 'No phone'} · {TYPE_LABEL[c.customer_type] ?? c.customer_type}
                </div>
              </div>
              <div className="text-right">
                {Number(c.balance) > 0 ? (
                  <div className={`font-display text-xl font-bold ${c.over_limit ? 'text-red-300' : 'text-brand'}`}>Owes KES {money(c.balance)}</div>
                ) : Number(c.balance) < 0 ? (
                  <div className="font-display text-xl font-bold text-emerald-300">Credit KES {money(-Number(c.balance))}</div>
                ) : (
                  <div className="text-sm text-muted">Owes nothing</div>
                )}
                <div className="text-xs text-muted">
                  {Number(c.credit_limit) > 0 ? `Limit KES ${money(c.credit_limit)}` : 'No credit'}
                  {c.over_limit && <span className="ml-1 text-red-300">· over limit</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {rows !== null && total > PAGE && (
        <div className="flex items-center justify-between">
          <Button variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted">
            Page {page + 1} of {pages}
          </span>
          <Button variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
