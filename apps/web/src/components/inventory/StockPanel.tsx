'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Field, Select } from '@/components/ui'
import { MOVEMENT_LABEL, qty, uuid } from '@/lib/inventory'
import { friendlyError } from '@/lib/errors'

type Branch = { id: string; name: string; code: string }
type Level = { branch_id: string; quantity: number }
type Move = {
  id: string
  branch_id: string
  movement_type: string
  quantity: number
  balance_after: number | null
  reason: string | null
  created_by: string | null
  created_at: string
}

export default function StockPanel({ productId, unit, onChanged }: { productId: string; unit: string; onChanged?: () => void }) {
  const { claims } = useSession()
  const [branches, setBranches] = useState<Branch[]>([])
  const [levels, setLevels] = useState<Level[]>([])
  const [moves, setMoves] = useState<Move[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<'count' | 'add' | 'damage'>('count')
  const [branchId, setBranchId] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    const [b, l, m] = await Promise.all([
      supabase.from('branches').select('id,name,code').eq('is_active', true).order('name'),
      supabase.from('stock_levels').select('branch_id,quantity').eq('product_id', productId),
      supabase
        .from('stock_movements')
        .select('id,branch_id,movement_type,quantity,balance_after,reason,created_by,created_at')
        .eq('product_id', productId)
        .order('created_at', { ascending: false })
        .limit(30),
    ])
    const all = (b.data as Branch[]) ?? []
    setBranches(all)
    setLevels((l.data as Level[]) ?? [])
    const list = (m.data as Move[]) ?? []
    setMoves(list)
    const ids = Array.from(new Set(list.map((x) => x.created_by).filter(Boolean))) as string[]
    if (ids.length) {
      const { data } = await supabase.from('profiles').select('id,full_name').in('id', ids)
      const map: Record<string, string> = {}
      ;((data as any[]) ?? []).forEach((p) => (map[p.id] = p.full_name || 'Staff'))
      setNames(map)
    }
  }, [productId])

  useEffect(() => {
    load()
  }, [load])

  const mine = branches.filter((b) => claims.all_branches || (claims.branch_ids ?? []).includes(b.id))
  useEffect(() => {
    if (!branchId && mine.length > 0) setBranchId(mine[0].id)
  }, [mine.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const current = Number(levels.find((l) => l.branch_id === branchId)?.quantity ?? 0)
  const bcode = (id: string) => branches.find((b) => b.id === id)?.code ?? '?'
  const total = levels.reduce((s, l) => s + Number(l.quantity), 0)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('')
    const n = Number(amount)
    if (!branchId) return setError('Choose a branch')
    if (amount.trim() === '' || Number.isNaN(n) || n < 0) return setError('Enter a number (zero or more)')

    let movement_type: 'adjustment' | 'damage' = 'adjustment'
    let quantity = 0
    let why = reason.trim()

    if (mode === 'count') {
      quantity = n - current
      if (quantity === 0) return setError('That is the same as the current stock. Nothing to change.')
      why = why || 'Stock count'
    } else if (mode === 'add') {
      if (n === 0) return setError('Enter how many were added')
      quantity = n
      if (!why) return setError('Please say why stock is being added (for example: stock found, delivery not yet entered)')
    } else {
      if (n === 0) return setError('Enter how many were damaged or lost')
      movement_type = 'damage'
      quantity = -n
      if (!why) return setError('Please say what happened (for example: cracked, stolen, expired)')
    }

    setBusy(true)
    const { error } = await supabase.from('stock_movements').insert({
      branch_id: branchId,
      product_id: productId,
      movement_type,
      quantity,
      reason: why,
      client_uuid: uuid(),
    })
    setBusy(false)
    if (error) {
      setError(error.message.includes('row-level security') ? 'You are not allowed to change stock in that branch.' : friendlyError(error))
      return
    }
    setNotice('Stock updated.')
    setAmount('')
    setReason('')
    await load()
    onChanged?.()
  }

  const tab = (m: typeof mode, label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(m)
        setError('')
        setNotice('')
      }}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === m ? 'bg-brand text-charcoal' : 'border border-charcoal-3 text-muted hover:bg-charcoal-3'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-bold">Stock by branch</h2>
          <div className="text-sm text-muted">
            Total: <b className="text-offwhite">{qty(total)}</b> {unit}
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {branches.map((b) => (
            <div key={b.id} className="flex items-center justify-between rounded-xl border border-charcoal-3 bg-charcoal px-3 py-2">
              <span>
                {b.name} <span className="text-xs text-muted">({b.code})</span>
              </span>
              <span className="font-display text-2xl font-bold">{qty(levels.find((l) => l.branch_id === b.id)?.quantity ?? 0)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-xl font-bold">Change stock</h2>
        <div className="flex flex-wrap gap-2">
          {tab('count', 'Stock count')}
          {tab('add', 'Add stock')}
          {tab('damage', 'Damaged / lost')}
        </div>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {mine.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
            <Field
              label={mode === 'count' ? `Counted on the shelf (now ${qty(current)})` : mode === 'add' ? 'How many to add' : 'How many damaged or lost'}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <Field
            label={mode === 'count' ? 'Note (optional)' : 'Reason (required)'}
            placeholder={mode === 'damage' ? 'e.g. cracked, stolen, expired' : mode === 'add' ? 'e.g. delivery not yet entered' : 'e.g. monthly stock count'}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {mode === 'count' && amount.trim() !== '' && !Number.isNaN(Number(amount)) && (
            <p className="text-sm text-muted">
              Change: <b className="text-offwhite">{Number(amount) - current >= 0 ? '+' : ''}{qty(Number(amount) - current)}</b>
            </p>
          )}
          {error && <Alert>{error}</Alert>}
          {notice && <Alert kind="success">{notice}</Alert>}
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving...' : 'Update stock'}
          </Button>
        </form>
        <p className="text-xs text-muted">Every change is recorded with your name and the reason.</p>
      </Card>

      <Card>
        <h2 className="text-xl font-bold">Recent movements</h2>
        {moves.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No stock movements yet.</p>
        ) : (
          <div className="mt-3 divide-y divide-charcoal-3">
            {moves.map((m) => (
              <div key={m.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-semibold">
                    {MOVEMENT_LABEL[m.movement_type] ?? m.movement_type}
                    <span className="ml-2 text-xs font-normal text-muted">{bcode(m.branch_id)}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {new Date(m.created_at).toLocaleString()} · {m.created_by ? names[m.created_by] ?? 'Staff' : 'System'}
                    {m.reason ? ` · ${m.reason}` : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-display text-xl font-bold ${Number(m.quantity) < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                    {Number(m.quantity) > 0 ? '+' : ''}
                    {qty(m.quantity)}
                  </div>
                  {m.balance_after !== null && <div className="text-xs text-muted">now {qty(m.balance_after)}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
