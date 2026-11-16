'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { queueAll, syncQueue } from '@/lib/offline'

// A thin bar under the top menu: offline notice, sending progress, sales needing attention.
// It also sends saved sales automatically whenever the internet is back.
export default function OfflineStatus() {
  const [online, setOnline] = useState(true)
  const [pending, setPending] = useState(0)
  const [failed, setFailed] = useState(0)
  const [sending, setSending] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const q = await queueAll()
      setPending(q.filter((x) => x.status === 'pending').length)
      setFailed(q.filter((x) => x.status === 'failed').length)
    } catch {}
  }, [])

  const send = useCallback(async () => {
    if (!navigator.onLine) return
    try {
      const q = await queueAll()
      if (!q.some((x) => x.status === 'pending')) return
    } catch {
      return
    }
    setSending(true)
    await syncQueue()
    setSending(false)
    refresh()
  }, [refresh])

  useEffect(() => {
    setOnline(navigator.onLine)
    const on = () => {
      setOnline(true)
      send()
    }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    window.addEventListener('offline-queue-changed', refresh)
    refresh()
    send()
    const timer = setInterval(send, 30000)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      window.removeEventListener('offline-queue-changed', refresh)
      clearInterval(timer)
    }
  }, [send, refresh])

  if (online && pending === 0 && failed === 0) return null

  return (
    <div className="print:hidden">
      {!online && (
        <div className="bg-amber-500/90 px-4 py-2 text-center text-sm font-semibold text-charcoal">
          You are offline. Sales are saved on this device and sent when the internet is back.
          {pending > 0 && ` (${pending} waiting)`}
        </div>
      )}
      {online && pending > 0 && (
        <div className="bg-brand/90 px-4 py-2 text-center text-sm font-semibold text-charcoal">
          {sending ? 'Sending' : 'Waiting to send'} {pending} saved sale{pending === 1 ? '' : 's'}...
        </div>
      )}
      {failed > 0 && (
        <Link href="/sales/queue" className="block bg-red-600 px-4 py-2 text-center text-sm font-semibold text-white">
          {failed} saved sale{failed === 1 ? '' : 's'} could not be sent. Tap to see why.
        </Link>
      )}
    </div>
  )
}
