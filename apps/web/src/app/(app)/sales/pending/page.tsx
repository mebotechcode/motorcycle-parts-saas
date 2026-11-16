'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Alert, Button, Spinner } from '@/components/ui'
import Receipt from '@/components/pos/Receipt'
import { idbGet, type QueuedSale } from '@/lib/offline'
import { receiptText, waNumber } from '@/lib/pos'

// Receipt of a sale that is saved on this device (made offline, or not yet sent).
export default function PendingReceiptPage() {
  const router = useRouter()
  const [item, setItem] = useState<QueuedSale | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')

  const load = useCallback(async () => {
    const key = new URLSearchParams(window.location.search).get('key') ?? ''
    if (!key) return setState('missing')
    const q = await idbGet<QueuedSale>('queue', key)
    if (q) {
      setItem(q)
      setState('ready')
      return
    }
    // already sent: open the proper receipt from the server
    try {
      const { data } = await supabase.from('sales').select('id').eq('client_uuid', key).maybeSingle()
      if (data?.id) {
        router.replace(`/sales/${data.id}?new=1`)
        return
      }
    } catch {}
    setState('missing')
  }, [router])

  useEffect(() => {
    load()
    window.addEventListener('offline-queue-changed', load)
    return () => window.removeEventListener('offline-queue-changed', load)
  }, [load])

  if (state === 'loading') return <Spinner />
  if (state === 'missing' || !item) {
    return (
      <div className="space-y-3">
        <Alert kind="info">This saved sale was not found on this device.</Alert>
        <Link href="/sales" className="text-brand hover:underline">
          ← All sales
        </Link>
      </div>
    )
  }

  const r = item.receipt
  const text = receiptText({ shop: r.tenant?.name ?? '', sale: r.sale, items: r.items, payments: r.payments, customer: r.customer?.name })
  const wa = `https://wa.me/${waNumber(r.customer?.phone)}?text=${encodeURIComponent(text)}`

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/sales" className="text-sm text-muted hover:text-offwhite">
          ← All sales
        </Link>
        <Link href="/sell" className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-charcoal hover:bg-brand-hover">
          + New sale
        </Link>
      </div>

      <div className="print:hidden">
        {item.status === 'failed' ? (
          <Alert>
            This sale could not be sent: {item.error}.{' '}
            <Link href="/sales/queue" className="underline">
              See saved sales
            </Link>
          </Alert>
        ) : (
          <Alert kind="info">Saved on this device. It will be sent to the server automatically when the internet is available. The receipt number below stays the same.</Alert>
        )}
      </div>

      <Receipt sale={r.sale} items={r.items} payments={r.payments} tenant={r.tenant} branch={r.branch} customer={r.customer} cashier={r.cashier} />

      <div className="mx-auto flex max-w-sm flex-wrap justify-center gap-2 print:hidden">
        <Button onClick={() => window.print()}>Print receipt</Button>
        <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg border border-charcoal-3 px-4 py-2.5 text-sm font-semibold hover:bg-charcoal-3">
          Send on WhatsApp
        </a>
        <Button variant="ghost" onClick={() => navigator.clipboard.writeText(text)}>
          Copy text
        </Button>
      </div>
    </div>
  )
}
