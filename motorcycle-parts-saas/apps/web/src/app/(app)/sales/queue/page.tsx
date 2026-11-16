'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Alert, Button, Card, Spinner } from '@/components/ui'
import { idbPut, queueAll, queueRemove, syncQueue, type QueuedSale } from '@/lib/offline'
import { money } from '@/lib/pos'

export default function QueuePage() {
  const [items, setItems] = useState<QueuedSale[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState('')

  const load = useCallback(async () => {
    const all = await queueAll()
    setItems(all.sort((a, b) => b.created_at.localeCompare(a.created_at)))
  }, [])

  useEffect(() => {
    load()
    window.addEventListener('offline-queue-changed', load)
    return () => window.removeEventListener('offline-queue-changed', load)
  }, [load])

  async function sendNow() {
    setInfo('')
    if (!navigator.onLine) return setInfo('You are offline. Try again when the internet is back.')
    setBusy(true)
    const r = await syncQueue()
    setBusy(false)
    setInfo(r.stopped ? 'Could not reach the server. Will try again soon.' : `Sent ${r.sent} sale${r.sent === 1 ? '' : 's'}${r.failed ? `, ${r.failed} could not be sent` : ''}.`)
    load()
  }

  async function retry(q: QueuedSale) {
    await idbPut('queue', { ...q, status: 'pending', error: undefined })
    window.dispatchEvent(new Event('offline-queue-changed'))
    await sendNow()
  }

  async function discard(q: QueuedSale) {
    if (!window.confirm(`Delete saved sale ${q.payload.receipt_no}? The sale will NOT be recorded on the server and the stock will not change.`)) return
    if (!window.confirm('Are you sure? This cannot be undone.')) return
    await queueRemove(q.key)
    load()
  }

  if (items === null) return <Spinner />

  const failed = items.filter((x) => x.status === 'failed')
  const pending = items.filter((x) => x.status === 'pending')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold">Saved sales</h1>
          <p className="text-sm text-muted">Sales made without internet that are waiting to be sent from this device.</p>
        </div>
        <Button onClick={sendNow} disabled={busy || pending.length === 0}>
          {busy ? 'Sending...' : 'Send now'}
        </Button>
      </div>

      {info && <Alert kind="info">{info}</Alert>}

      {items.length === 0 ? (
        <Card>
          <p className="text-muted">Nothing waiting. All sales from this device have been sent.</p>
          <Link href="/sales" className="mt-3 inline-block text-brand hover:underline">
            ← All sales
          </Link>
        </Card>
      ) : (
        <div className="space-y-2">
          {[...failed, ...pending].map((q) => (
            <div key={q.key} className={`rounded-xl border bg-charcoal-2 p-3 ${q.status === 'failed' ? 'border-red-400/60' : 'border-charcoal-3'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">{q.payload.receipt_no}</div>
                  <div className="text-xs text-muted">{new Date(q.created_at).toLocaleString('en-KE')}</div>
                </div>
                <div className="text-right">
                  <div className="font-display text-xl font-bold">KES {money(q.receipt?.sale?.total)}</div>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${q.status === 'failed' ? 'bg-red-500/15 text-red-300' : 'bg-brand/15 text-brand'}`}>{q.status === 'failed' ? 'Could not be sent' : 'Waiting to send'}</span>
                </div>
              </div>
              {q.status === 'failed' && <p className="mt-2 text-sm text-red-200">{q.error}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href={`/sales/pending?key=${q.key}`} className="rounded-lg border border-charcoal-3 px-3 py-1.5 text-sm hover:bg-charcoal-3">
                  View receipt
                </Link>
                {q.status === 'failed' && (
                  <>
                    <Button variant="ghost" onClick={() => retry(q)}>
                      Try again
                    </Button>
                    <Button variant="danger" onClick={() => discard(q)}>
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {failed.length > 0 && (
        <p className="text-xs text-muted">If a sale keeps failing, show this message to the owner. The goods were sold, so the owner should record it by hand or fix the cause (for example, the shop subscription) and press Try again.</p>
      )}
    </div>
  )
}
