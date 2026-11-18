'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const KEY = 'nafpos-cookie-notice-v1'

export default function CookieNotice() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    try {
      setShow(localStorage.getItem(KEY) !== '1')
    } catch {
      setShow(true)
    }
  }, [])

  if (!show) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-charcoal-3 bg-charcoal p-4 print:hidden">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          NafPOS uses essential cookies to keep you signed in and remember your language. We do not use advertising
          cookies.{' '}
          <Link href="/cookies" className="text-offwhite underline hover:text-brand">
            Cookie details
          </Link>
          {' · '}
          <Link href="/privacy" className="text-offwhite underline hover:text-brand">
            Privacy
          </Link>
        </p>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(KEY, '1')
            } catch {}
            setShow(false)
          }}
          className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-charcoal hover:bg-brand-hover"
        >
          OK
        </button>
      </div>
    </div>
  )
}
