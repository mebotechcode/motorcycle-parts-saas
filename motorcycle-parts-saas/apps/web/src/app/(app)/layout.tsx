'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ROLE_LABEL, useSession } from '@/lib/session'
import { Spinner } from '@/components/ui'
import OfflineStatus from '@/components/OfflineStatus'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { loading, session, claims, signOut } = useSession()
  const [businessName, setBusinessName] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  // Guard: must be signed in AND belong to a business
  useEffect(() => {
    if (loading) return
    if (!session) router.replace('/login')
    else if (!claims.tenant_id) router.replace('/onboarding')
  }, [loading, session, claims.tenant_id, router])

  useEffect(() => {
    if (!claims.tenant_id) return
    supabase
      .from('tenants')
      .select('name')
      .maybeSingle()
      .then(({ data }) => setBusinessName(data?.name ?? ''))
  }, [claims.tenant_id])

  // close the mobile menu when the page changes, or Escape is pressed
  useEffect(() => setMenuOpen(false), [pathname])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // stop the page behind the menu from scrolling
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  if (loading || !session || !claims.tenant_id) return <Spinner />

  const role = claims.tenant_role ?? ''
  const nav = [
    { href: '/dashboard', label: 'Dashboard' },
    ...(role === 'owner' || role === 'manager' || role === 'cashier'
      ? [
          { href: '/sell', label: 'Sell' },
          { href: '/sales', label: 'Sales' },
          { href: '/customers', label: 'Customers' },
        ]
      : []),
    { href: '/inventory', label: 'Inventory' },
    ...(role === 'owner' || role === 'manager' || role === 'storekeeper' ? [{ href: '/purchases', label: 'Purchases' }] : []),
    ...(role === 'owner' || role === 'manager' ? [{ href: '/reports', label: 'Reports' }] : []),
    { href: '/branches', label: 'Branches' },
    ...(role === 'owner' || role === 'manager' ? [{ href: '/staff', label: 'Staff' }] : []),
  ]
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')
  const doSignOut = () => signOut().then(() => router.replace('/login'))

  return (
    <div className="min-h-screen">
      {/* ---------- top bar ---------- */}
      <header className="print:hidden sticky top-0 z-30 border-b border-charcoal-3 bg-charcoal/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          {/* hamburger: phones and small tablets only */}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            className="-ml-2 rounded-lg p-2 text-offwhite hover:bg-charcoal-3 lg:hidden"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/naf-icon.png" alt="" className="h-9 w-9 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-xl font-bold uppercase leading-none tracking-wide">
              {businessName || "Naf's Motor Spares"}
            </div>
            <div className="text-xs text-muted">{ROLE_LABEL[role] ?? role}</div>
          </div>

          {/* desktop links */}
          <nav className="hidden items-center gap-1 lg:flex">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                  isActive(item.href) ? 'bg-brand text-charcoal' : 'text-muted hover:bg-charcoal-3 hover:text-offwhite'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <button
            onClick={doSignOut}
            className="hidden rounded-lg border border-charcoal-3 px-3 py-1.5 text-sm text-muted hover:bg-charcoal-3 hover:text-offwhite lg:block"
          >
            Sign out
          </button>
        </div>
      </header>

      <OfflineStatus />

      {/* ---------- mobile menu (slides in from the left) ---------- */}
      <div
        onClick={() => setMenuOpen(false)}
        className={`print:hidden fixed inset-0 z-40 bg-black/60 transition-opacity lg:hidden ${
          menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <aside
        aria-hidden={!menuOpen}
        className={`print:hidden fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85%] flex-col border-r border-charcoal-3 bg-charcoal-2 transition-[transform,visibility] duration-200 lg:hidden ${
          menuOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'
        }`}
      >
        <div className="flex items-center gap-3 border-b border-charcoal-3 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/naf-icon.png" alt="" className="h-10 w-10 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-lg font-bold uppercase leading-none">
              {businessName || "Naf's Motor Spares"}
            </div>
            <div className="text-xs text-muted">{ROLE_LABEL[role] ?? role}</div>
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
            className="rounded-lg p-2 text-muted hover:bg-charcoal-3 hover:text-offwhite"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-xl px-4 py-3 text-lg font-medium ${
                isActive(item.href) ? 'bg-brand text-charcoal' : 'text-offwhite hover:bg-charcoal-3'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-charcoal-3 p-3">
          <button
            onClick={doSignOut}
            className="w-full rounded-xl border border-charcoal-3 px-4 py-3 text-left text-lg text-muted hover:bg-charcoal-3 hover:text-offwhite"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="mx-auto max-w-6xl px-4 py-6 print:max-w-none print:p-0">{children}</main>
    </div>
  )
}
