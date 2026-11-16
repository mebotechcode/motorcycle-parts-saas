'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from '@/lib/session'

const LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#how', label: 'How it works' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
]

export default function SiteHeader() {
  const { session } = useSession()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  const primary = session
    ? { href: '/dashboard', label: 'Go to dashboard' }
    : { href: '/signup', label: 'Start free trial' }

  return (
    <header className="sticky top-0 z-30 border-b border-charcoal-3 bg-charcoal/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="-ml-2 rounded-lg p-2 hover:bg-charcoal-3 md:hidden"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        <Link href="/" className="flex flex-1 items-center gap-2 md:flex-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/naf-icon.png" alt="" className="h-9 w-9 rounded-full" />
          <span className="font-display text-xl font-bold uppercase leading-none tracking-wide">
            Naf&apos;s <span className="text-brand">Motor Spares</span>
          </span>
        </Link>

        <nav className="ml-8 hidden flex-1 items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-charcoal-3 hover:text-offwhite">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          {!session && (
            <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-semibold hover:bg-charcoal-3">
              Sign in
            </Link>
          )}
          <Link href={primary.href} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-charcoal hover:bg-brand-hover">
            {primary.label}
          </Link>
        </div>

        {/* small phones: a quick sign-in shortcut next to the logo */}
        {!session && (
          <Link href="/login" className="rounded-lg border border-charcoal-3 px-3 py-1.5 text-sm font-semibold md:hidden">
            Sign in
          </Link>
        )}
      </div>

      {/* mobile menu */}
      <div
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity md:hidden ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      />
      <aside
        aria-hidden={!open}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85%] flex-col border-r border-charcoal-3 bg-charcoal-2 transition-[transform,visibility] duration-200 md:hidden ${
          open ? 'visible translate-x-0' : 'invisible -translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-charcoal-3 p-4">
          <span className="font-display text-lg font-bold uppercase">
            Naf&apos;s <span className="text-brand">Motor Spares</span>
          </span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="rounded-lg p-2 text-muted hover:bg-charcoal-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="block rounded-xl px-4 py-3 text-lg hover:bg-charcoal-3">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="space-y-2 border-t border-charcoal-3 p-3">
          <Link href={primary.href} className="block rounded-xl bg-brand px-4 py-3 text-center text-lg font-semibold text-charcoal">
            {primary.label}
          </Link>
          {!session && (
            <Link href="/login" className="block rounded-xl border border-charcoal-3 px-4 py-3 text-center text-lg">
              Sign in
            </Link>
          )}
        </div>
      </aside>
    </header>
  )
}
