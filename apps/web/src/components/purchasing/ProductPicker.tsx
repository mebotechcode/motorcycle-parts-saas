'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { money } from '@/lib/pos'

export type Picked = { id: string; name: string; sku: string; unit: string; selling_price: number; track_stock: boolean; stock_qty: number; reorder_level: number; last_cost: number | null }

// Search a product (name, code, part number or barcode) and pick it.
export default function ProductPicker({ onPick, placeholder = 'Search a product to add' }: { onPick: (p: Picked) => void; placeholder?: string }) {
  const [text, setText] = useState('')
  const [found, setFound] = useState<Picked[]>([])

  useEffect(() => {
    const s = text.trim().replace(/[,()%*\\]/g, ' ').trim()
    if (s.length < 2) {
      setFound([])
      return
    }
    const t = setTimeout(async () => {
      const parts = [`name.ilike.%${s}%`, `sku.ilike.%${s}%`, `part_number.ilike.%${s}%`]
      if (/^[A-Za-z0-9-]+$/.test(s)) parts.push(`barcodes.cs.{${s}}`)
      const { data } = await supabase
        .from('product_overview')
        .select('id,name,sku,unit,selling_price,track_stock,stock_qty,reorder_level')
        .eq('is_active', true)
        .is('deleted_at', null)
        .or(parts.join(','))
        .order('name')
        .limit(8)
      const rows = (data as any[]) ?? []
      let costs: Record<string, number> = {}
      if (rows.length) {
        const c = await supabase.from('product_costs').select('product_id,cost_price').in('product_id', rows.map((r) => r.id))
        ;((c.data as any[]) ?? []).forEach((x) => (costs[x.product_id] = Number(x.cost_price)))
      }
      setFound(rows.map((r) => ({ ...r, selling_price: Number(r.selling_price), stock_qty: Number(r.stock_qty), reorder_level: Number(r.reorder_level), last_cost: costs[r.id] ?? null })))
    }, 250)
    return () => clearTimeout(t)
  }, [text])

  return (
    <div className="relative">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2.5 text-offwhite placeholder:text-muted/60 focus:border-brand focus:outline-none"
      />
      {found.length > 0 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-charcoal-3 bg-charcoal-2 shadow-xl">
          {found.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => {
                onPick(p)
                setText('')
                setFound([])
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-charcoal-3"
            >
              {p.name} <span className="text-xs text-muted">· {p.sku}{p.last_cost !== null ? ` · last cost ${money(p.last_cost)}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
