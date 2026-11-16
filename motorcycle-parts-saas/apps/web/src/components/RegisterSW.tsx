'use client'

import { useEffect } from 'react'

// Registers the service worker that lets the app open without internet.
// Only in the real (built) version of the site, not while developing.
export default function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])
  return null
}
