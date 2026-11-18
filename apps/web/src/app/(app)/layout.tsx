'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ROLE_LABEL, useSession } from '@/lib/session'
import { Spinner } from '@/components/ui'
import OfflineStatus from '@/components/OfflineStatus'
import { setLang, t, useLang, type Lang } from '@/lib/i18n'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { loading, session, claims, signOut } = useSession()
  const [businessName, setBusinessName] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const lang = useLang()

  const toggleLang = () => {
    const next: Lang = lang === 'en' ? 'sw' : 'en'
    setLang(next)
    // Persist to profile so it follows the user across devices
    supabase.from('profiles').update({ language: next }).then(() => {})
  }

  // Guard: signed in AND (belongs to a business OR is platform admin).
  // A tenant-less platform admin is the SaaS operator — they get a minimal
  // admin shell below, never the shop UI or onboarding.
  useEffect(() => {
    if (loading) return
    if (!session) router.replace('/login')
    else if (!claims.tenant_id && !claims.platform_admin) router.replace('/onboarding')
    else if (!claims.tenant_id && claims.platform_admin && !pathname.startsWith('/admin')) router.replace('/admin')
  }, [loading, session, claims.tenant_id, claims.platform_admin, pathname, router])

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
  // auto-transmit any queued eTIMS invoices — at most once per 5 minutes per device
  useEffect(() => {
    if (!claims.tenant_id) return
    const KICK_KEY = 'etims_kick_v1'
    const kick = () => {
      try {
        const last = Number(sessionStorage.getItem(KICK_KEY) ?? 0)
        if (Date.now() - last < 5 * 60 * 1000) return
        sessionStorage.setItem(KICK_KEY, String(Date.now()))
      } catch {}
      supabase.functions.invoke('etims-submit', { body: { transmit_all: true } }).catch(() => {})
    }
    kick()
    window.addEventListener('online', kick)
    return () => window.removeEventListener('online', kick)
  }, [claims.tenant_id])
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

  if (loading || !session || (!claims.tenant_id && !claims.platform_admin)) return <Spinner />

  // SaaS operator with no shop tenant: minimal admin-only shell
  if (!claims.tenant_id && claims.platform_admin) {
    return (
      <div className="min-h-screen">
        <header className="sticky top-0 z-30 border-b border-charcoal-3 bg-charcoal">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
            <Link href="/admin" className="flex min-w-0 items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/naf-icon.png" alt="" className="h-9 w-9 rounded-full" />
              <div className="min-w-0 hidden sm:block">
                <div className="font-display text-xl font-bold uppercase leading-none tracking-wide">NafPOS</div>
                <div className="text-xs text-muted">{t('admin', lang)}</div>
              </div>
            </Link>
            <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm font-semibold">
              {[
                { href: '/admin', label: 'Shops', match: (p: string) => p === '/admin' || p.startsWith('/admin/shops') },
                { href: '/admin/health', label: 'Health', match: (p: string) => p.startsWith('/admin/health') },
                { href: '/admin/activity', label: 'Activity', match: (p: string) => p.startsWith('/admin/activity') },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-2.5 py-1.5 whitespace-nowrap ${item.match(pathname) ? 'bg-charcoal-3 text-offwhite' : 'text-muted hover:bg-charcoal-3 hover:text-offwhite'}`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <button
              type="button"
              onClick={() => signOut().then(() => router.replace('/login'))}
              className="rounded-lg border border-charcoal-3 px-3 py-1.5 text-sm font-semibold text-muted hover:bg-charcoal-3 hover:text-offwhite"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-5">{children}</main>
      </div>
    )
  }

  const role = claims.tenant_role ?? ''
  const nav = [
    { href: '/dashboard', label: t('dashboard', lang) },
    ...(role === 'owner' || role === 'manager' || role === 'cashier'
      ? [
          { href: '/sell', label: t('sell', lang) },
          { href: '/sales', label: t('sales', lang) },
          { href: '/customers', label: t('customers', lang) },
          { href: '/deni', label: t('deni', lang) },
          { href: '/till', label: t('till', lang) },
        ]
      : []),
    ...(role === 'owner' || role === 'manager' ? [{ href: '/customers/commissions', label: t('commissions', lang) }] : []),
    { href: '/inventory', label: t('inventory', lang) },
    ...(role === 'owner' || role === 'manager' || role === 'storekeeper' ? [{ href: '/purchases', label: t('purchases', lang) }] : []),
    ...(role === 'owner' || role === 'manager'
      ? [
          { href: '/reports', label: t('reports', lang) },
          { href: '/billing', label: t('billing', lang) },
        ]
      : []),
    { href: '/branches', label: t('branches', lang) },
    ...(role === 'owner' || role === 'manager' ? [{ href: '/staff', label: t('staff', lang) }] : []),
  ]
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')
  const doSignOut = () => signOut().then(() => router.replace('/login'))

  return (
    <div className="min-h-screen">
      {/* ---------- top bar ---------- */}
      <header className="print:hidden sticky top-0 z-30 border-b border-charcoal-3 bg-charcoal">
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
              {businessName || 'NafPOS'}
            </div>
            <div className="text-xs text-muted">{ROLE_LABEL[role] ?? role}</div>
          </div>
          <button
            type="button"
            onClick={toggleLang}
            aria-label="Toggle language / Badili lugha"
            className="rounded-lg border border-charcoal-3 px-2.5 py-1.5 text-xs font-semibold text-muted hover:bg-charcoal-3 hover:text-offwhite"
          >
            {lang === 'en' ? 'EN | SW' : 'SW | EN'}
          </button>

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
            {t('signOut', lang)}
          </button>
        </div>
      </header>

      <OfflineStatus />

      {/* ---------- mobile menu (slides in from the left) ---------- */}
      <div
        onClick={() => setMenuOpen(false)}
        className={`print:hidden fixed inset-0 z-40 bg-black/80 transition-opacity lg:hidden ${
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
              {businessName || 'NafPOS'}
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
            onClick={toggleLang}
            className="mb-2 w-full rounded-xl border border-charcoal-3 px-4 py-3 text-left text-lg text-muted hover:bg-charcoal-3 hover:text-offwhite"
          >
            {lang === 'en' ? 'Kiswahili' : 'English'}
          </button>
          <button
            onClick={doSignOut}
            className="w-full rounded-xl border border-charcoal-3 px-4 py-3 text-left text-lg text-muted hover:bg-charcoal-3 hover:text-offwhite"
          >
            {t('signOut', lang)}
          </button>
        </div>
      </aside>

      <main className="mx-auto max-w-6xl px-4 py-6 print:max-w-none print:p-0">{children}</main>
    </div>
  )
}
