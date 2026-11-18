'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Spinner } from '@/components/ui'
import { money } from '@/lib/pos'
import { waNumber } from '@/lib/pos'
import { t, useLang } from '@/lib/i18n'

type Row = {
  mechanic_id: string
  name: string
  phone: string | null
  owed_count: number
  owed_total: number
  paid_total: number
  last_referral_at: string | null
}

export default function CommissionsPage() {
  const { claims } = useSession()
  const manager = claims.tenant_role === 'owner' || claims.tenant_role === 'manager'
  const lang = useLang()

  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setError('')
    const { data, error } = await supabase.from('mechanic_commission_summary').select('*').order('owed_total', { ascending: false })
    if (error) setError(error.message)
    setRows((data as Row[]) ?? [])
  }, [])

  useEffect(() => {
    if (manager) load()
  }, [manager, load])

  if (!manager) return <Alert kind="info">Only the owner and managers can settle fundi commissions.</Alert>
  if (rows === null) return <Spinner />

  const owed = rows.filter((r) => Number(r.owed_total) > 0)
  const totalOwed = rows.reduce((s, r) => s + Number(r.owed_total), 0)

  async function settle(row: Row) {
    setError('')
    setInfo('')
    if (!window.confirm(`Mark all commissions owed to ${row.name} as paid? (KES ${money(Number(row.owed_total))})`)) return
    setBusy(row.mechanic_id)
    const { data, error } = await supabase.rpc('settle_mechanic_commissions', { p_mechanic_id: row.mechanic_id })
    setBusy('')
    if (error) return setError(error.message)
    const d: any = data ?? {}
    setInfo(`Settled ${d.settled_count ?? 0} referral${(d.settled_count ?? 0) === 1 ? '' : 's'} — KES ${money(d.settled_total ?? 0)} paid to ${row.name}.`)
    load()
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href="/customers" className="text-sm text-muted hover:text-offwhite">
        {t('backCustomers', lang)}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold">{t('commissions', lang)}</h1>
          <p className="text-sm text-muted">{t('commissionsSub', lang)}</p>
        </div>
        {totalOwed > 0 && (
          <div className="text-right">
            <div className="text-xs uppercase text-muted">{t('totalOwed', lang)}</div>
            <div className="font-display text-3xl font-bold text-brand">KES {money(totalOwed)}</div>
          </div>
        )}
      </div>

      {error && <Alert>{error}</Alert>}
      {info && <Alert kind="success">{info}</Alert>}

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            No fundis yet. Add a mechanic customer (type “Mechanic / garage”), then pick them under “Referred by (fundi)” at checkout to track their commission.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const o = Number(r.owed_total)
            const message = `Habari ${r.name.split(' ')[0]}, asante kwa kuelekeza wateja kwenye duka letu. Kamisheni yako ya KES ${Number(o).toLocaleString('en-KE')} iko tayari kulipwa.`
            return (
              <Card key={r.mechanic_id} className="flex flex-wrap items-center gap-4">
                <div className="min-w-0 flex-1 basis-48">
                  <Link href={`/customers/${r.mechanic_id}`} className="font-semibold hover:text-brand">
                    {r.name}
                  </Link>
                  <div className="text-xs text-muted">
                    {r.phone ?? 'No phone'} · {Number(r.owed_count)} open referral{Number(r.owed_count) === 1 ? '' : 's'}
                    {r.last_referral_at && ` · last ${new Date(r.last_referral_at).toLocaleDateString('en-KE')}`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted">Owed</div>
                  <div className={`font-display text-2xl font-bold ${o > 0 ? 'text-brand' : 'text-muted'}`}>KES {money(o)}</div>
                  <div className="text-[11px] text-muted">paid so far KES {money(Number(r.paid_total))}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {r.phone && o > 0 && (
                    <a
                      href={`https://wa.me/${waNumber(r.phone)}?text=${encodeURIComponent(message)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-charcoal-3 px-3 py-2 text-sm font-semibold hover:bg-charcoal-3"
                    >
                      WhatsApp
                    </a>
                  )}
                  <Button disabled={o <= 0 || busy === r.mechanic_id} onClick={() => settle(r)}>
                    {busy === r.mechanic_id ? 'Settling…' : 'Settle all'}
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {owed.length > 0 && (
        <p className="text-xs text-muted">Tip: settle with cash or M-Pesa as usual, then tap “Settle all” to clear the balance and mark the underlying sales as paid.</p>
      )}
    </div>
  )
}
