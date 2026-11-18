'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Card, Select, Spinner } from '@/components/ui'
import { canEditInventory } from '@/lib/inventory'
import { t as tr, useLang } from '@/lib/i18n'

type T = {
  id: string
  transfer_no: string
  from_branch_id: string
  to_branch_id: string
  status: 'draft' | 'in_transit' | 'received' | 'cancelled'
  created_at: string
  note: string | null
}

const STATUS: Record<string, { label: string; cls: string }> = {
  in_transit: { label: 'On its way', cls: 'bg-brand/15 text-brand' },
  received: { label: 'Received', cls: 'bg-emerald-500/15 text-emerald-300' },
  cancelled: { label: 'Cancelled', cls: 'bg-charcoal-3 text-muted' },
  draft: { label: 'Draft', cls: 'bg-charcoal-3 text-muted' },
}

export default function TransfersPage() {
  const lang = useLang()
  const { claims } = useSession()
  const canEdit = canEditInventory(claims.tenant_role)
  const [rows, setRows] = useState<T[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [b, t] = await Promise.all([
      supabase.from('branches').select('id,name'),
      (filter === 'all'
        ? supabase.from('stock_transfers').select('*')
        : supabase.from('stock_transfers').select('*').eq('status', filter)
      )
        .order('created_at', { ascending: false })
        .limit(50),
    ])
    if (t.error) setError(t.error.message)
    const map: Record<string, string> = {}
    ;((b.data as any[]) ?? []).forEach((x) => (map[x.id] = x.name))
    setNames(map)
    const list = (t.data as T[]) ?? []
    setRows(list)
    if (list.length) {
      const { data } = await supabase.from('stock_transfer_items').select('transfer_id').in('transfer_id', list.map((x) => x.id))
      const c: Record<string, number> = {}
      ;((data as any[]) ?? []).forEach((x) => (c[x.transfer_id] = (c[x.transfer_id] ?? 0) + 1))
      setCounts(c)
    }
  }, [filter])

  useEffect(() => {
    if (canEdit) load()
  }, [canEdit, load])

  if (!canEdit) return <Alert kind="info">{tr('onlyTransfers', lang)}</Alert>

  const mine = (id: string) => claims.all_branches || (claims.branch_ids ?? []).includes(id)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold">{tr('transfers', lang)}</h1>
          <p className="text-sm text-muted">{tr('transfersSub', lang)}</p>
        </div>
        <Link href="/transfers/new" className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-charcoal hover:bg-brand-hover">
          {tr('newTransfer', lang)}
        </Link>
      </div>

      <div className="w-48">
        <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">{tr('allTransfers', lang)}</option>
          <option value="in_transit">{tr('onItsWay', lang)}</option>
          <option value="received">{tr('receivedStatus', lang)}</option>
          <option value="cancelled">{tr('cancelled', lang)}</option>
        </Select>
      </div>

      {error && <Alert>{error}</Alert>}

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-muted">{tr('noTransfers', lang)}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((t) => {
            const waiting = t.status === 'in_transit' && mine(t.to_branch_id)
            return (
              <Link
                key={t.id}
                href={`/transfers/${t.id}`}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-charcoal-2 p-3 hover:border-brand/60 ${waiting ? 'border-brand/60' : 'border-charcoal-3'}`}
              >
                <div className="min-w-0">
                  <div className="font-semibold">{t.transfer_no}</div>
                  <div className="text-sm text-muted">
                    {names[t.from_branch_id] ?? 'Branch'} → {names[t.to_branch_id] ?? 'Branch'} · {counts[t.id] ?? 0} item{(counts[t.id] ?? 0) === 1 ? '' : 's'}
                  </div>
                  <div className="text-xs text-muted">{new Date(t.created_at).toLocaleString()}</div>
                </div>
                <div className="text-right">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS[t.status].cls}`}>{STATUS[t.status].label}</span>
                  {waiting && <div className="mt-1 text-xs text-brand">Waiting for you to receive</div>}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
