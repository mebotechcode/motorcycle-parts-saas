'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Card, Spinner } from '@/components/ui'
import { keDate } from '@/lib/admin'

type ShopHit = { id: string; name: string; slug?: string; count?: number; trial_ends_at?: string; grace_ends_at?: string }

function ShopList({ title, rows, empty, extra }: { title: string; rows: ShopHit[]; empty: string; extra?: (r: ShopHit) => string }) {
  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-bold">
        {title} <span className="text-sm font-normal text-muted">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-charcoal-3 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2">
              <Link href={`/admin/shops/${r.id}`} className="font-medium text-brand hover:underline">
                {r.name}
              </Link>
              <span className="text-muted">{extra ? extra(r) : r.count != null ? String(r.count) : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export default function AdminHealthPage() {
  const { loading, claims } = useSession()
  const isAdmin = !!claims.platform_admin
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!isAdmin) return
    const { data, error } = await supabase.rpc('admin_health')
    if (error) setError(error.message)
    else setData(data)
  }, [isAdmin])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <Spinner />
  if (!isAdmin) return <Alert kind="info">This page is for the NafPOS platform owner only.</Alert>
  if (!data && !error) return <Spinner />

  const n = (k: string) => (Array.isArray(data?.[k]) ? data[k].length : 0)
  const total =
    n('suspended') + n('past_due') + n('trials_ending_7d') + n('mpesa_failed_7d') + n('mpesa_unmatched') + n('etims_failed') + n('etims_pending')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-4xl font-bold">Health</h1>
        <p className="text-sm text-muted">Shops that need a look — billing, M-Pesa, eTIMS. Empty lists are good.</p>
      </div>
      {error && <Alert>{error}</Alert>}
      <Card>
        <div className="text-xs text-muted">Shops currently in a list</div>
        <div className="font-display text-3xl font-bold">{total}</div>
      </Card>
      {data && (
        <div className="grid gap-3 sm:grid-cols-2">
          <ShopList title="Suspended" rows={data.suspended ?? []} empty="None suspended." />
          <ShopList title="Past due" rows={data.past_due ?? []} empty="Nobody past due." extra={(r) => (r.grace_ends_at ? `grace ${keDate(r.grace_ends_at)}` : '')} />
          <ShopList title="Trials ending (7d)" rows={data.trials_ending_7d ?? []} empty="No trials ending this week." extra={(r) => keDate(r.trial_ends_at)} />
          <ShopList title="M-Pesa failed (7d)" rows={data.mpesa_failed_7d ?? []} empty="No failed STK/C2B this week." extra={(r) => `${r.count} failed`} />
          <ShopList title="M-Pesa unmatched" rows={data.mpesa_unmatched ?? []} empty="No unmatched till payments." extra={(r) => `${r.count} unmatched`} />
          <ShopList title="eTIMS failed" rows={data.etims_failed ?? []} empty="No failed KRA invoices." extra={(r) => `${r.count} failed`} />
          <ShopList title="eTIMS pending" rows={data.etims_pending ?? []} empty="Queue is clear." extra={(r) => `${r.count} pending`} />
        </div>
      )}
    </div>
  )
}
