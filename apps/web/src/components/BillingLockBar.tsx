'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { t, useLang } from '@/lib/i18n'

// Shown under the header when the shop cannot write (trial ended / unpaid).
export default function BillingLockBar() {
  const lang = useLang()
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    let live = true
    supabase.rpc('billing_status').then(({ data }) => {
      if (!live) return
      const info = data as { writable?: boolean } | null
      setLocked(Boolean(info) && info?.writable === false)
    })
    return () => {
      live = false
    }
  }, [])

  if (!locked) return null

  return (
    <Link href="/billing" className="print:hidden block bg-red-600 px-4 py-2 text-center text-sm font-semibold text-white">
      {t('shopLocked', lang)}
    </Link>
  )
}
