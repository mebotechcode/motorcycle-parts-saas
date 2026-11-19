'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Field, Select } from '@/components/ui'
import { QUALITY, TAX, UNITS, kes, num } from '@/lib/inventory'
import { friendlyError } from '@/lib/errors'
import BikePicker from './BikePicker'
import BarcodeInput from './BarcodeInput'

type Opt = { id: string; name: string; code?: string }

type Props = {
  product?: any
  costs?: any
  barcodes?: string[]
  modelIds?: string[]
  onSaved?: () => void
}

export default function ProductForm({ product, costs, barcodes = [], modelIds = [], onSaved }: Props) {
  const router = useRouter()
  const { claims } = useSession()
  const isNew = !product

  const [f, setF] = useState({
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    part_number: product?.part_number ?? '',
    category_id: product?.category_id ?? '',
    brand_id: product?.brand_id ?? '',
    quality_grade: product?.quality_grade ?? 'aftermarket',
    unit: product?.unit ?? 'pc',
    selling_price: product?.selling_price?.toString() ?? '',
    wholesale_price: product?.wholesale_price?.toString() ?? '',
    cost_price: costs?.cost_price?.toString() ?? '',
    min_selling_price: costs?.min_selling_price?.toString() ?? '',
    tax_category: product?.tax_category ?? 'standard',
    reorder_level: product?.reorder_level?.toString() ?? '0',
    shelf_location: product?.shelf_location ?? '',
    aisle: product?.aisle ?? '',
    rack: product?.rack ?? '',
    bin: product?.bin ?? '',
    hs_code: product?.hs_code ?? '',
    etims_code: product?.etims_code ?? '',
    aliases: (product?.aliases ?? []).join(', '),
    description: product?.description ?? '',
    track_stock: product?.track_stock ?? true,
    is_active: product?.is_active ?? true,
    opening_branch_id: '',
    opening_qty: '',
  })
  const [codes, setCodes] = useState<string[]>(barcodes)
  const [models, setModels] = useState<string[]>(modelIds)
  const [categories, setCategories] = useState<Opt[]>([])
  const [brands, setBrands] = useState<Opt[]>([])
  const [branches, setBranches] = useState<Opt[]>([])
  const [newCat, setNewCat] = useState('')
  const [newBrand, setNewBrand] = useState('')
  const [showCat, setShowCat] = useState(false)
  const [showBrand, setShowBrand] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    ;(async () => {
      const [c, b, br] = await Promise.all([
        supabase.from('product_categories').select('id,name').order('name'),
        supabase.from('brands').select('id,name').order('name'),
        supabase.from('branches').select('id,name,code').eq('is_active', true).order('name'),
      ])
      setCategories((c.data as Opt[]) ?? [])
      setBrands((b.data as Opt[]) ?? [])
      const mine = ((br.data as Opt[]) ?? []).filter(
        (x) => claims.all_branches || (claims.branch_ids ?? []).includes(x.id)
      )
      setBranches(mine)
      setF((p) => (p.opening_branch_id || mine.length !== 1 ? p : { ...p, opening_branch_id: mine[0].id }))
    })()
  }, [claims.all_branches, claims.branch_ids])

  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  async function addCategory() {
    const name = newCat.trim()
    if (!name) return
    const { data, error } = await supabase.from('product_categories').insert({ name }).select('id,name').single()
    if (error) return setError(error.message.includes('duplicate') ? 'That category already exists' : friendlyError(error))
    setCategories((p) => [...p, data as Opt])
    setF({ ...f, category_id: (data as Opt).id })
    setNewCat('')
    setShowCat(false)
  }

  async function addBrand() {
    const name = newBrand.trim()
    if (!name) return
    const { data, error } = await supabase.from('brands').insert({ name }).select('id,name').single()
    if (error) return setError(error.message.includes('duplicate') ? 'That brand already exists' : friendlyError(error))
    setBrands((p) => [...p, data as Opt])
    setF({ ...f, brand_id: (data as Opt).id })
    setNewBrand('')
    setShowBrand(false)
  }

  const sell = num(f.selling_price)
  const cost = num(f.cost_price)
  const profit = sell !== null && cost !== null && sell > 0 ? sell - cost : null
  const margin = profit !== null && sell ? Math.round((profit / sell) * 100) : null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')

    const payload: any = {
      name: f.name,
      sku: f.sku,
      part_number: f.part_number,
      description: f.description,
      category_id: f.category_id || null,
      brand_id: f.brand_id || null,
      quality_grade: f.quality_grade,
      unit: f.unit,
      track_stock: f.track_stock,
      is_active: f.is_active,
      selling_price: num(f.selling_price) ?? 0,
      wholesale_price: num(f.wholesale_price),
      cost_price: num(f.cost_price) ?? 0,
      min_selling_price: num(f.min_selling_price),
      tax_category: f.tax_category,
      reorder_level: num(f.reorder_level) ?? 0,
      shelf_location: f.shelf_location,
      aisle: f.aisle,
      rack: f.rack,
      bin: f.bin,
      hs_code: f.hs_code,
      etims_code: f.etims_code,
      aliases: f.aliases.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      barcodes: codes,
      bike_model_ids: models,
    }
    if (isNew && f.opening_branch_id && num(f.opening_qty)) {
      payload.opening_branch_id = f.opening_branch_id
      payload.opening_qty = num(f.opening_qty)
    }

    const { data, error } = await supabase.rpc('save_product', { p_id: product?.id ?? null, p_data: payload })
    setBusy(false)
    if (error) {
      setError(friendlyError(error))
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    if (isNew) router.push(`/inventory/${data}`)
    else {
      setNotice('Saved.')
      onSaved?.()
    }
  }

  const money = { type: 'number', inputMode: 'decimal' as const, step: 'any', min: 0 }

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card className="space-y-4">
        <h2 className="text-xl font-bold">Basics</h2>
        <Field label="Product name" required placeholder="e.g. Brake pad set - Boxer BM100" value={f.name} onChange={set('name')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Product code (SKU)" placeholder="Leave empty to generate" value={f.sku} onChange={set('sku')} hint="Your own short code for this item" />
          <Field label="Manufacturer part number" placeholder="Optional" value={f.part_number} onChange={set('part_number')} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Select label="Category" value={f.category_id} onChange={set('category_id')}>
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            {!showCat ? (
              <button type="button" onClick={() => setShowCat(true)} className="mt-1 text-sm text-brand hover:underline">
                + New category
              </button>
            ) : (
              <div className="mt-2 flex gap-2">
                <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Category name" className="w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2 text-sm focus:border-brand focus:outline-none" />
                <Button type="button" onClick={addCategory}>
                  Add
                </Button>
              </div>
            )}
          </div>
          <div>
            <Select label="Brand" value={f.brand_id} onChange={set('brand_id')}>
              <option value="">No brand</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
            {!showBrand ? (
              <button type="button" onClick={() => setShowBrand(true)} className="mt-1 text-sm text-brand hover:underline">
                + New brand
              </button>
            ) : (
              <div className="mt-2 flex gap-2">
                <input value={newBrand} onChange={(e) => setNewBrand(e.target.value)} placeholder="Brand name" className="w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2 text-sm focus:border-brand focus:outline-none" />
                <Button type="button" onClick={addBrand}>
                  Add
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Quality" value={f.quality_grade} onChange={set('quality_grade')}>
            {Object.entries(QUALITY).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Select label="Sold per" value={f.unit} onChange={set('unit')}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </div>
        <Field label="Description (optional)" value={f.description} onChange={set('description')} />
      </Card>

      <Card className="space-y-4">
        <h2 className="text-xl font-bold">Prices (KES)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Selling price (retail)" required {...money} value={f.selling_price} onChange={set('selling_price')} />
          <Field label="Wholesale price" {...money} value={f.wholesale_price} onChange={set('wholesale_price')} hint="For mechanics and shops buying in bulk" />
          <Field label="Buying price" {...money} value={f.cost_price} onChange={set('cost_price')} hint="Only owner, managers and storekeepers can see this" />
          <Field label="Lowest price allowed" {...money} value={f.min_selling_price} onChange={set('min_selling_price')} hint="Cashiers will not be able to sell below this" />
        </div>
        {profit !== null && (
          <div className="rounded-lg bg-charcoal px-3 py-2 text-sm">
            Profit per item: <b className="text-brand">{kes(profit)}</b>
            {margin !== null && <span className="text-muted"> ({margin}% margin)</span>}
          </div>
        )}
        <Select label="VAT" value={f.tax_category} onChange={set('tax_category')}>
          {Object.entries(TAX).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted">Selling prices include VAT.</p>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-xl font-bold">Stock settings</h2>
        <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Warn me when stock falls to" type="number" inputMode="decimal" min={0} step="any" value={f.reorder_level} onChange={set('reorder_level')} hint="0 = no warning" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Aisle" placeholder="e.g. A" value={f.aisle} onChange={set('aisle')} />
          <Field label="Rack" placeholder="e.g. B" value={f.rack} onChange={set('rack')} />
          <Field label="Bin / Box" placeholder="e.g. Box 14" value={f.bin} onChange={set('bin')} />
        </div>
        <Field label="Shelf / bin location (free text)" placeholder="e.g. Rack B - Box 14" value={f.shelf_location} onChange={set('shelf_location')} hint="Shown on POS search when aisle/rack/bin are empty" />
        <Field label="Also known as (slang / local names)" placeholder="kenda, coil, piston ring" value={f.aliases} onChange={set('aliases')} hint="Comma separated. Helps anyone find this part by what mechanics call it." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="HS code (eTIMS)" placeholder="e.g. 8714.10.00" value={f.hs_code} onChange={set('hs_code')} hint="KRA harmonised system code for this part" />
          <Field label="eTIMS item code (optional)" placeholder="Optional" value={f.etims_code} onChange={set('etims_code')} hint="Only if KRA issued you a specific item code" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.track_stock} onChange={set('track_stock')} className="h-4 w-4 accent-[#FF5B14]" />
          Count stock for this item (untick for services like fitting charges)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.is_active} onChange={set('is_active')} className="h-4 w-4 accent-[#FF5B14]" />
          Active (untick to hide it from selling)
        </label>

        {isNew && f.track_stock && (
          <div className="rounded-xl border border-charcoal-3 bg-charcoal p-3">
            <div className="mb-2 text-sm font-semibold">Opening stock (optional)</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Branch" value={f.opening_branch_id} onChange={set('opening_branch_id')}>
                <option value="">Choose branch...</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
              <Field label="How many do you have now?" type="number" inputMode="decimal" min={0} step="any" value={f.opening_qty} onChange={set('opening_qty')} />
            </div>
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-xl font-bold">Fits these bikes</h2>
        <BikePicker value={models} onChange={setModels} />
      </Card>

      <Card className="space-y-3">
        <h2 className="text-xl font-bold">Barcodes</h2>
        <BarcodeInput value={codes} onChange={setCodes} />
      </Card>

      <div className="sticky bottom-0 -mx-4 border-t border-charcoal-3 bg-charcoal/95 px-4 py-3 backdrop-blur">
        <Button type="submit" disabled={busy} className="w-full sm:w-auto">
          {busy ? 'Saving...' : isNew ? 'Save product' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
