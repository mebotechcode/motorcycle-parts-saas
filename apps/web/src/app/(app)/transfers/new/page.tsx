'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Field, Select } from '@/components/ui'
import { canEditInventory, qty } from '@/lib/inventory'
import { t, useLang } from '@/lib/i18n'

type Branch = { id: string; name: string }
type Found = { id: string; name: string; sku: string; unit: string }
type Line = Found & { qty: string }

export default function NewTransferPage() {
  const router = useRouter()
  const { claims } = useSession()
  const lang = useLang()
  const [branches, setBranches] = useState<Branch[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const [search, setSearch] = useState('')
  const [found, setFound] = useState<Found[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [available, setAvailable] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('branches')
      .select('id,name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setBranches((data as Branch[]) ?? []))
  }, [])

  const mine = branches.filter((b) => claims.all_branches || (claims.branch_ids ?? []).includes(b.id))
  useEffect(() => {
    if (!from && mine.length > 0) setFrom(mine[0].id)
  }, [mine.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // search products to add
  useEffect(() => {
    const s = search.trim().replace(/[,()%*\\]/g, ' ').trim()
    if (s.length < 2) {
      setFound([])
      return
    }
    const t = setTimeout(async () => {
      const parts = [`name.ilike.%${s}%`, `sku.ilike.%${s}%`, `part_number.ilike.%${s}%`]
      if (/^[A-Za-z0-9-]+$/.test(s)) parts.push(`barcodes.cs.{${s}}`)
      const { data } = await supabase
        .from('product_overview')
        .select('id,name,sku,unit')
        .eq('track_stock', true)
        .eq('is_active', true)
        .is('deleted_at', null)
        .or(parts.join(','))
        .order('name')
        .limit(8)
      setFound((data as Found[]) ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  // how many of each added product the sending branch has
  useEffect(() => {
    if (!from || lines.length === 0) return
    supabase
      .from('stock_levels')
      .select('product_id,quantity')
      .eq('branch_id', from)
      .in('product_id', lines.map((l) => l.id))
      .then(({ data }) => {
        const m: Record<string, number> = {}
        ;((data as any[]) ?? []).forEach((x) => (m[x.product_id] = Number(x.quantity)))
        setAvailable(m)
      })
  }, [from, lines.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!canEditInventory(claims.tenant_role)) {
    return <Alert kind="info">Only the owner, managers and storekeepers can transfer stock.</Alert>
  }

  const add = (p: Found) => {
    if (!lines.find((l) => l.id === p.id)) setLines([...lines, { ...p, qty: '' }])
    setSearch('')
    setFound([])
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!from || !to) return setError('Choose the sending and receiving branches')
    if (from === to) return setError('Choose two different branches')
    if (lines.length === 0) return setError('Add at least one item')
    for (const l of lines) {
      const n = Number(l.qty)
      if (!l.qty || Number.isNaN(n) || n <= 0) return setError(`Enter a quantity for ${l.name}`)
      if (n > (available[l.id] ?? 0)) return setError(`${l.name}: you only have ${qty(available[l.id] ?? 0)} at the sending branch`)
    }
    setBusy(true)
    const { data, error } = await supabase.rpc('send_transfer', {
      p_from: from,
      p_to: to,
      p_items: lines.map((l) => ({ product_id: l.id, qty: Number(l.qty) })),
      p_note: note || null,
    })
    setBusy(false)
    if (error) return setError(error.message)
    router.push(`/transfers/${data}`)
  }

  return (
    <div className="space-y-5">
      <Link href="/transfers" className="text-sm text-muted hover:text-offwhite">
        ← Back to transfers
      </Link>
      <h1 className="text-4xl font-bold">{t('newTransferTitle', lang)}</h1>

      <form onSubmit={send} className="space-y-5">
        <Card className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Send from" value={from} onChange={(e) => setFrom(e.target.value)}>
              {mine.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
            <Select label="Send to" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose branch...</option>
              {branches
                .filter((b) => b.id !== from)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </Select>
          </div>
          {branches.length < 2 && <Alert kind="info">You need at least two branches to transfer stock. Add another branch first (Branches page).</Alert>}
          <Field label="Note (optional)" placeholder="e.g. sent with the 3pm bus" value={note} onChange={(e) => setNote(e.target.value)} />
        </Card>

        <Card className="space-y-3">
          <h2 className="text-xl font-bold">Items</h2>
          <div className="relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search a product to add (name, code or barcode)"
              className="w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2.5 text-offwhite placeholder:text-muted/60 focus:border-brand focus:outline-none"
            />
            {found.length > 0 && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-charcoal-3 bg-charcoal-2 shadow-xl">
                {found.map((p) => (
                  <button type="button" key={p.id} onClick={() => add(p)} className="block w-full px-3 py-2 text-left text-sm hover:bg-charcoal-3">
                    {p.name} <span className="text-xs text-muted">· {p.sku}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {lines.length === 0 ? (
            <p className="text-sm text-muted">No items yet. Search above to add one.</p>
          ) : (
            <div className="space-y-2">
              {lines.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-charcoal-3 bg-charcoal p-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="truncate font-semibold">{l.name}</div>
                    <div className="text-xs text-muted">
                      {l.sku} · available here: <b className="text-offwhite">{qty(available[l.id] ?? 0)}</b> {l.unit}
                    </div>
                  </div>
                  <div className="w-28">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      placeholder="Qty"
                      value={l.qty}
                      onChange={(e) => setLines(lines.map((x) => (x.id === l.id ? { ...x, qty: e.target.value } : x)))}
                      className="w-full rounded-lg border border-charcoal-3 bg-charcoal-2 px-3 py-2 focus:border-brand focus:outline-none"
                    />
                  </div>
                  <button type="button" onClick={() => setLines(lines.filter((x) => x.id !== l.id))} className="text-sm text-muted hover:text-red-300">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {error && <Alert>{error}</Alert>}
        <Button type="submit" disabled={busy}>
          {busy ? 'Sending...' : 'Send transfer'}
        </Button>
        <p className="text-xs text-muted">The stock leaves the sending branch now and is added to the receiving branch when they confirm it arrived.</p>
      </form>
    </div>
  )
}
