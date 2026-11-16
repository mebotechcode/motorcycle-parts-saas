'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui'
import { money } from '@/lib/pos'
import { qty } from '@/lib/inventory'

// What this product cost on each delivery (price history per supplier)
export default function PurchaseHistory({ productId }: { productId: string }) {
  const [rows, setRows] = useState<any[] | null>(null)

  useEffect(() => {
    supabase
      .from('purchase_prices')
      .select('id,quantity,unit_cost,received_at,supplier_id,supplier_name')
      .eq('product_id', productId)
      .order('received_at', { ascending: false })
      .limit(8)
      .then(({ data }) => setRows((data as any[]) ?? []))
  }, [productId])

  if (rows === null) return null

  return (
    <Card className="space-y-2">
      <h2 className="text-xl font-bold">Buying history</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No deliveries recorded yet. Receive goods from the Purchases page to build a price history.</p>
      ) : (
        <div className="divide-y divide-charcoal-3">
          {rows.map((r, i) => {
            const prev = rows[i + 1]
            const change = prev && Number(prev.unit_cost) > 0 ? ((Number(r.unit_cost) - Number(prev.unit_cost)) / Number(prev.unit_cost)) * 100 : null
            return (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <Link href={`/suppliers/${r.supplier_id}`} className="font-semibold hover:text-brand">
                    {r.supplier_name}
                  </Link>
                  <div className="text-xs text-muted">{new Date(r.received_at).toLocaleDateString('en-KE')} · {qty(r.quantity)} bought</div>
                </div>
                <div className="text-right">
                  <div className="font-display text-xl font-bold">KES {money(r.unit_cost)}</div>
                  {change !== null && Math.abs(change) >= 1 && <div className={`text-xs ${change > 0 ? 'text-red-300' : 'text-emerald-300'}`}>{change > 0 ? '▲' : '▼'} {Math.abs(change).toFixed(0)}% vs before</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
