'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Card, Spinner } from '@/components/ui'
import { QUALITY, TAX, canEditInventory, kes, qty } from '@/lib/inventory'
import ProductForm from '@/components/inventory/ProductForm'
import StockPanel from '@/components/inventory/StockPanel'
import PurchaseHistory from '@/components/inventory/PurchaseHistory'

export default function ProductPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const { claims } = useSession()
  const canEdit = canEditInventory(claims.tenant_role)

  const [state, setState] = useState<'loading' | 'missing' | 'ready'>('loading')
  const [version, setVersion] = useState(0)
  const [product, setProduct] = useState<any>(null)
  const [overview, setOverview] = useState<any>(null)
  const [costs, setCosts] = useState<any>(null)
  const [barcodes, setBarcodes] = useState<string[]>([])
  const [modelIds, setModelIds] = useState<string[]>([])
  const [bikes, setBikes] = useState<string[]>([])

  const load = useCallback(async () => {
    const [p, o, c, b, m] = await Promise.all([
      supabase.from('products').select('*').eq('id', id).maybeSingle(),
      supabase.from('product_overview').select('*').eq('id', id).maybeSingle(),
      canEdit ? supabase.from('product_costs').select('*').eq('product_id', id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from('product_barcodes').select('barcode').eq('product_id', id),
      supabase.from('product_compatibility').select('bike_model_id').eq('product_id', id),
    ])
    if (!p.data) {
      setState('missing')
      return
    }
    const ids = ((m.data as any[]) ?? []).map((x) => x.bike_model_id)
    setProduct(p.data)
    setOverview(o.data)
    setCosts((c as any).data)
    setBarcodes(((b.data as any[]) ?? []).map((x) => x.barcode))
    setModelIds(ids)

    if (ids.length) {
      const [models, makes] = await Promise.all([
        supabase.from('bike_models').select('id,make_id,name').in('id', ids),
        supabase.from('bike_makes').select('id,name'),
      ])
      const mk: Record<string, string> = {}
      ;((makes.data as any[]) ?? []).forEach((x) => (mk[x.id] = x.name))
      setBikes(((models.data as any[]) ?? []).map((x) => `${mk[x.make_id] ?? ''} ${x.name}`.trim()))
    } else setBikes([])
    setState('ready')
    setVersion((v) => v + 1)
  }, [id, canEdit])

  useEffect(() => {
    load()
  }, [load])

  if (state === 'loading') return <Spinner />
  if (state === 'missing') {
    return (
      <div className="space-y-3">
        <Alert kind="info">This product was not found.</Alert>
        <Link href="/inventory" className="text-brand hover:underline">
          ← Back to inventory
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Link href="/inventory" className="text-sm text-muted hover:text-offwhite">
        ← Back to inventory
      </Link>

      {canEdit ? (
        <>
          <div>
            <h1 className="text-4xl font-bold">{product.name}</h1>
            <p className="text-sm text-muted">
              {product.sku} · Stock now: <b className="text-offwhite">{qty(overview?.stock_qty ?? 0)}</b> {product.unit}
              {overview?.is_out ? ' · Out of stock' : overview?.is_low ? ' · Running low' : ''}
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <ProductForm key={`form-${version}`} product={product} costs={costs} barcodes={barcodes} modelIds={modelIds} onSaved={load} />
            </div>
            <div>
              <div className="space-y-5">
              {product.track_stock ? (
                <StockPanel productId={id} unit={product.unit} onChanged={load} />
              ) : (
                <Card>
                  <p className="text-sm text-muted">Stock is not counted for this item.</p>
                </Card>
              )}
                <PurchaseHistory productId={id} />
              </div>
            </div>
          </div>
        </>
      ) : (
        // Read-only view for cashiers: no buying price, no editing
        <>
          <div>
            <h1 className="text-4xl font-bold">{product.name}</h1>
            <p className="text-sm text-muted">{product.sku}</p>
          </div>
          <Card className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Info label="Selling price" value={kes(product.selling_price)} />
              <Info label="Wholesale price" value={kes(product.wholesale_price)} />
              <Info label="Quality" value={QUALITY[product.quality_grade] ?? product.quality_grade} />
              <Info label="VAT" value={TAX[product.tax_category] ?? product.tax_category} />
              <Info label="Part number" value={product.part_number ?? '-'} />
              <Info label="Shelf" value={product.shelf_location ?? '-'} />
              <Info label="In stock (your branches)" value={`${qty(overview?.stock_qty ?? 0)} ${product.unit}`} />
            </div>
            <div>
              <div className="text-sm text-muted">Fits</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {bikes.length === 0 ? <span className="text-sm text-muted">Not bike-specific</span> : bikes.map((b) => <span key={b} className="rounded-lg bg-brand/15 px-2.5 py-1 text-sm text-brand">{b}</span>)}
              </div>
            </div>
          </Card>
          <StockLevelsReadOnly productId={id} />
        </>
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm text-muted">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  )
}

function StockLevelsReadOnly({ productId }: { productId: string }) {
  const [rows, setRows] = useState<{ name: string; qty: number }[]>([])
  useEffect(() => {
    ;(async () => {
      const [b, l] = await Promise.all([
        supabase.from('branches').select('id,name'),
        supabase.from('stock_levels').select('branch_id,quantity').eq('product_id', productId),
      ])
      const names: Record<string, string> = {}
      ;((b.data as any[]) ?? []).forEach((x) => (names[x.id] = x.name))
      setRows(((l.data as any[]) ?? []).map((x) => ({ name: names[x.branch_id] ?? 'Branch', qty: Number(x.quantity) })))
    })()
  }, [productId])
  if (rows.length === 0) return null
  return (
    <Card>
      <h2 className="text-xl font-bold">Stock by branch</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.name} className="flex justify-between rounded-xl border border-charcoal-3 bg-charcoal px-3 py-2">
            <span>{r.name}</span>
            <span className="font-display text-2xl font-bold">{qty(r.qty)}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}
