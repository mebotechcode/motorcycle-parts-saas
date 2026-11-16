'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Select, Spinner } from '@/components/ui'
import { QUALITY, canEditInventory, kes, qty } from '@/lib/inventory'

const PAGE = 25

type Row = {
  id: string
  sku: string
  name: string
  category_name: string | null
  brand_name: string | null
  quality_grade: string
  part_number: string | null
  unit: string
  selling_price: number
  wholesale_price: number | null
  stock_qty: number
  is_low: boolean
  is_out: boolean
  is_active: boolean
  track_stock: boolean
}
type Opt = { id: string; name: string }

export default function InventoryPage() {
  const { claims } = useSession()
  const canEdit = canEditInventory(claims.tenant_role)

  const [text, setText] = useState('')
  const [q, setQ] = useState('') // debounced search text
  const [cat, setCat] = useState('')
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [status, setStatus] = useState('all')
  const [showInactive, setShowInactive] = useState(false)
  const [page, setPage] = useState(0)

  const [rows, setRows] = useState<Row[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [cats, setCats] = useState<Opt[]>([])
  const [brands, setBrands] = useState<Opt[]>([])
  const [models, setModels] = useState<(Opt & { make_id: string })[]>([])
  const [makes, setMakes] = useState<Opt[]>([])

  // filter lists, loaded once
  useEffect(() => {
    ;(async () => {
      const [c, b, m, mk] = await Promise.all([
        supabase.from('product_categories').select('id,name').order('name'),
        supabase.from('brands').select('id,name').order('name'),
        supabase.from('bike_models').select('id,name,make_id').order('name'),
        supabase.from('bike_makes').select('id,name').order('name'),
      ])
      setCats((c.data as Opt[]) ?? [])
      setBrands((b.data as Opt[]) ?? [])
      setModels((m.data as any[]) ?? [])
      setMakes((mk.data as Opt[]) ?? [])
    })()
  }, [])

  // wait a moment after typing before searching
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(text)
      setPage(0)
    }, 300)
    return () => clearTimeout(t)
  }, [text])

  const load = useCallback(async () => {
    setError('')
    let query = supabase.from('product_overview').select('*', { count: 'exact' }).is('deleted_at', null)

    const s = q.trim().replace(/[,()%*\\]/g, ' ').trim()
    if (s) {
      const parts = [`name.ilike.%${s}%`, `sku.ilike.%${s}%`, `part_number.ilike.%${s}%`]
      if (/^[A-Za-z0-9-]+$/.test(s)) parts.push(`barcodes.cs.{${s}}`)
      query = query.or(parts.join(','))
    }
    if (cat) query = query.eq('category_id', cat)
    if (brand) query = query.eq('brand_id', brand)
    if (model) query = query.contains('bike_model_ids', [model])
    if (status === 'low') query = query.eq('is_low', true)
    if (status === 'out') query = query.eq('is_out', true)
    if (!showInactive) query = query.eq('is_active', true)

    const { data, count, error } = await query.order('name').range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) {
      setError(error.message)
      setRows([])
      return
    }
    setRows((data as Row[]) ?? [])
    setTotal(count ?? 0)
  }, [q, cat, brand, model, status, showInactive, page])

  useEffect(() => {
    load()
  }, [load])

  const reset = (fn: () => void) => {
    fn()
    setPage(0)
  }
  const pages = Math.max(1, Math.ceil(total / PAGE))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold">Inventory</h1>
          <p className="text-sm text-muted">{rows === null ? 'Loading...' : `${total} product${total === 1 ? '' : 's'}`}</p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Link href="/transfers" className="rounded-lg border border-charcoal-3 px-4 py-2.5 text-sm font-semibold hover:bg-charcoal-3">
              Transfers
            </Link>
            <Link href="/inventory/import" className="rounded-lg border border-charcoal-3 px-4 py-2.5 text-sm font-semibold hover:bg-charcoal-3">
              Import from Excel
            </Link>
            <Link href="/inventory/new" className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-charcoal hover:bg-brand-hover">
              + Add product
            </Link>
          </div>
        )}
      </div>

      <Card className="space-y-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search by name, code, part number or barcode"
          className="w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2.5 text-offwhite placeholder:text-muted/60 focus:border-brand focus:outline-none"
        />
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Select value={cat} onChange={(e) => reset(() => setCat(e.target.value))}>
            <option value="">All categories</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select value={brand} onChange={(e) => reset(() => setBrand(e.target.value))}>
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Select value={model} onChange={(e) => reset(() => setModel(e.target.value))}>
            <option value="">Fits any bike</option>
            {makes.map((mk) => (
              <optgroup key={mk.id} label={mk.name}>
                {models
                  .filter((m) => m.make_id === mk.id)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
          <Select value={status} onChange={(e) => reset(() => setStatus(e.target.value))}>
            <option value="all">All stock levels</option>
            <option value="low">Running low</option>
            <option value="out">Out of stock</option>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showInactive} onChange={(e) => reset(() => setShowInactive(e.target.checked))} className="h-4 w-4 accent-[#FF5B14]" />
          Show deactivated products
        </label>
      </Card>

      {error && <Alert>{error}</Alert>}

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-muted">
            {total === 0 && !q && !cat && !brand && !model && status === 'all'
              ? canEdit
                ? 'No products yet. Add your first product to get started.'
                : 'No products yet.'
              : 'No products match these filters.'}
          </p>
          {canEdit && total === 0 && !q && (
            <Link href="/inventory/new" className="mt-3 inline-block rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-charcoal">
              + Add product
            </Link>
          )}
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/inventory/${r.id}`}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-charcoal-3 bg-charcoal-2 p-3 hover:border-brand/60 ${r.is_active ? '' : 'opacity-60'}`}
            >
              <div className="min-w-0 flex-1 basis-56">
                <div className="truncate font-semibold">{r.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span>{r.sku}</span>
                  {r.part_number && <span>· {r.part_number}</span>}
                  {r.brand_name && <span>· {r.brand_name}</span>}
                  {r.category_name && <span>· {r.category_name}</span>}
                </div>
                <div className="mt-1 flex gap-1.5">
                  <span className="rounded bg-charcoal-3 px-1.5 py-0.5 text-[11px]">{QUALITY[r.quality_grade] ?? r.quality_grade}</span>
                  {!r.is_active && <span className="rounded bg-charcoal-3 px-1.5 py-0.5 text-[11px]">Deactivated</span>}
                </div>
              </div>
              <div className="text-right">
                <div className="font-display text-xl font-bold">{kes(r.selling_price)}</div>
                {r.wholesale_price !== null && <div className="text-xs text-muted">Wholesale {kes(r.wholesale_price)}</div>}
              </div>
              <div className="w-24 text-right">
                {r.track_stock ? (
                  <>
                    <div className={`font-display text-2xl font-bold ${r.is_out ? 'text-red-300' : r.is_low ? 'text-brand' : ''}`}>{qty(r.stock_qty)}</div>
                    <div className="text-xs text-muted">{r.is_out ? 'Out of stock' : r.is_low ? 'Running low' : `${r.unit} in stock`}</div>
                  </>
                ) : (
                  <div className="text-xs text-muted">Not counted</div>
                )}
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
