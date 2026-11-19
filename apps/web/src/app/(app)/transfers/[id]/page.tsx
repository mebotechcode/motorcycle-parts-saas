'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Spinner } from '@/components/ui'
import { canEditInventory, qty } from '@/lib/inventory'
import { friendlyError } from '@/lib/errors'

type Item = { id: string; product_id: string; qty_sent: number; qty_received: number; discrepancy_note: string | null }

export default function TransferPage() {
  const { id } = useParams<{ id: string }>()
  const { claims } = useSession()
  const canEdit = canEditInventory(claims.tenant_role)

  const [t, setT] = useState<any>(null)
  const [missing, setMissing] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [products, setProducts] = useState<Record<string, { name: string; sku: string; unit: string }>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [recv, setRecv] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [tr, it, br] = await Promise.all([
      supabase.from('stock_transfers').select('*').eq('id', id).maybeSingle(),
      supabase.from('stock_transfer_items').select('id,product_id,qty_sent,qty_received,discrepancy_note').eq('transfer_id', id),
      supabase.from('branches').select('id,name'),
    ])
    if (!tr.data) {
      setMissing(true)
      return
    }
    const list = ((it.data as any[]) ?? []).map((x) => ({ ...x, qty_sent: Number(x.qty_sent), qty_received: Number(x.qty_received) })) as Item[]
    setT(tr.data)
    setItems(list)
    const n: Record<string, string> = {}
    ;((br.data as any[]) ?? []).forEach((b) => (n[b.id] = b.name))
    setNames(n)
    const r: Record<string, string> = {}
    list.forEach((x) => (r[x.id] = String(x.qty_sent)))
    setRecv(r)
    if (list.length) {
      const { data } = await supabase.from('products').select('id,name,sku,unit').in('id', list.map((x) => x.product_id))
      const p: Record<string, any> = {}
      ;((data as any[]) ?? []).forEach((x) => (p[x.id] = x))
      setProducts(p)
    }
  }, [id])

  useEffect(() => {
    if (canEdit) load()
  }, [canEdit, load])

  if (!canEdit) return <Alert kind="info">Only the owner, managers and storekeepers can see transfers.</Alert>
  if (missing) return <Alert kind="info">Transfer not found.</Alert>
  if (!t) return <Spinner />

  const mine = (b: string) => claims.all_branches || (claims.branch_ids ?? []).includes(b)
  const canReceive = t.status === 'in_transit' && mine(t.to_branch_id)
  const canCancel = t.status === 'in_transit' && mine(t.from_branch_id)

  async function receive() {
    setError('')
    for (const it of items) {
      const n = Number(recv[it.id])
      if (Number.isNaN(n) || n < 0 || n > it.qty_sent) return setError('Each received quantity must be between 0 and the quantity sent')
      if (n < it.qty_sent && !(notes[it.id] ?? '').trim())
        return setError(`Say what happened to the missing units of "${products[it.product_id]?.name ?? 'an item'}" (e.g. 2 boxes missing, 3 damaged in transit)`)
    }
    setBusy(true)
    const { error } = await supabase.rpc('receive_transfer', {
      p_transfer_id: id,
      p_received: items.map((it) => ({ item_id: it.id, qty: Number(recv[it.id]), note: (notes[it.id] ?? '').trim() || null })),
    })
    setBusy(false)
    if (error) return setError(friendlyError(error))
    await load()
  }

  async function cancel() {
    if (!window.confirm('Cancel this transfer? The stock will go back to the sending branch.')) return
    setError('')
    setBusy(true)
    const { error } = await supabase.rpc('cancel_transfer', { p_transfer_id: id })
    setBusy(false)
    if (error) return setError(friendlyError(error))
    await load()
  }

  const label: Record<string, string> = { in_transit: 'On its way', received: 'Received', cancelled: 'Cancelled', draft: 'Draft' }

  return (
    <div className="space-y-5">
      <Link href="/transfers" className="text-sm text-muted hover:text-offwhite">
        ← Back to transfers
      </Link>
      <div>
        <h1 className="text-4xl font-bold">{t.transfer_no}</h1>
        <p className="text-muted">
          {names[t.from_branch_id]} → {names[t.to_branch_id]} · <b className="text-offwhite">{label[t.status]}</b>
        </p>
        <p className="text-xs text-muted">
          Sent {t.sent_at ? new Date(t.sent_at).toLocaleString() : ''}
          {t.received_at ? ` · Received ${new Date(t.received_at).toLocaleString()}` : ''}
          {t.note ? ` · ${t.note}` : ''}
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      <Card className="space-y-2">
        <h2 className="text-xl font-bold">Items</h2>
        {items.map((it) => {
          const p = products[it.product_id]
          const short = t.status === 'received' && it.qty_received < it.qty_sent
          return (
            <div key={it.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-charcoal-3 bg-charcoal p-3">
              <div className="min-w-0 flex-1 basis-48">
                <div className="truncate font-semibold">{p?.name ?? 'Product'}</div>
                <div className="text-xs text-muted">{p?.sku}</div>
              </div>
              <div className="text-sm">
                Sent <b>{qty(it.qty_sent)}</b> {p?.unit}
                {t.status === 'received' && (
                  <span className={short ? 'ml-2 text-red-300' : 'ml-2 text-emerald-300'}>
                    · received {qty(it.qty_received)}
                  </span>
                )}
                {t.status === 'received' && short && it.discrepancy_note && (
                  <div className="mt-1 text-xs text-red-300">Missing: {it.discrepancy_note}</div>
                )}
              </div>
              {canReceive && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-28">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={it.qty_sent}
                      step="any"
                      value={recv[it.id] ?? ''}
                      onChange={(e) => setRecv({ ...recv, [it.id]: e.target.value })}
                      aria-label={`Received quantity for ${p?.name ?? 'item'}`}
                      className="w-full rounded-lg border border-charcoal-3 bg-charcoal-2 px-3 py-2 focus:border-brand focus:outline-none"
                    />
                  </div>
                  {Number(recv[it.id] ?? it.qty_sent) < it.qty_sent && (
                    <input
                      value={notes[it.id] ?? ''}
                      onChange={(e) => setNotes({ ...notes, [it.id]: e.target.value })}
                      placeholder="What happened to the missing units?"
                      aria-label="Discrepancy note"
                      className="w-56 rounded-lg border border-brand/50 bg-charcoal-2 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </Card>

      {canReceive && (
        <Card className="space-y-3">
          <h2 className="text-xl font-bold">Receive this stock</h2>
          <p className="text-sm text-muted">Count what actually arrived and change the numbers above if something is missing. Anything missing is recorded as lost.</p>
          <Button onClick={receive} disabled={busy}>
            {busy ? 'Saving...' : 'Confirm received'}
          </Button>
        </Card>
      )}

      {t.status === 'in_transit' && !canReceive && (
        <Alert kind="info">Waiting for staff of {names[t.to_branch_id]} to receive this transfer.</Alert>
      )}

      {canCancel && (
        <Button variant="danger" onClick={cancel} disabled={busy}>
          Cancel transfer
        </Button>
      )}
    </div>
  )
}
