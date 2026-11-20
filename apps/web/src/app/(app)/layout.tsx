'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Spinner } from '@/components/ui'
import OfflineStatus from '@/components/OfflineStatus'
import BillingLockBar from '@/components/BillingLockBar'
import { setLang, t, useLang, type Lang } from '@/lib/i18n'
import { adminAal } from '@/lib/mfa'

type NavLink = { href: string; label: string }
type NavGroup = { id: string; label: string; items: NavLink[] }

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { loading, session, claims, signOut } = useSession()
  const [businessName, setBusinessName] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [mobileGroup, setMobileGroup] = useState<string | null>(null)
  const [adminAalState, setAdminAalState] = useState<'unknown' | 'aal1' | 'aal2'>('unknown')
  const desktopNavRef = useRef<HTMLElement>(null)
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

  // Super-admin must complete TOTP (authenticator app) before the console.
  // Shop users are never asked.
  useEffect(() => {
    if (loading) return
    if (!session || !claims.platform_admin || claims.tenant_id) {
      setAdminAalState('aal2')
      return
    }
    let live = true
    adminAal().then((level) => {
      if (!live) return
      setAdminAalState(level)
      if (level === 'aal1' && pathname !== '/admin/mfa') router.replace('/admin/mfa')
      if (level === 'aal2' && pathname === '/admin/mfa') router.replace('/admin')
    })
    return () => {
      live = false
    }
  }, [loading, session, claims.platform_admin, claims.tenant_id, pathname, router])

  useEffect(() => {
    if (!claims.tenant_id) return
    supabase
      .from('tenants')
      .select('name')
      .maybeSingle()
      .then(({ data }) => setBusinessName(data?.name ?? ''))
  }, [claims.tenant_id])

  // close menus when the page changes
  useEffect(() => {
    setMenuOpen(false)
    setOpenGroup(null)
    setMobileGroup(null)
  }, [pathname])
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setMenuOpen(false)
      setOpenGroup(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!openGroup) return
    const onDown = (e: MouseEvent) => {
      if (desktopNavRef.current && !desktopNavRef.current.contains(e.target as Node)) setOpenGroup(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openGroup])
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
    if (adminAalState === 'unknown') return <Spinner />
    if (adminAalState === 'aal1') {
      if (pathname !== '/admin/mfa') return <Spinner />
      return <>{children}</>
    }
    if (pathname === '/admin/mfa') return <Spinner />
    const adminNav = [
      { href: '/admin', label: t('adminShops', lang), match: (p: string) => p === '/admin' || p.startsWith('/admin/shops') },
      { href: '/admin/health', label: t('adminHealth', lang), match: (p: string) => p.startsWith('/admin/health') },
      { href: '/admin/activity', label: t('adminActivity', lang), match: (p: string) => p.startsWith('/admin/activity') },
    ]
    const adminSignOut = () => signOut().then(() => router.replace('/login'))
    return (
      <div className="min-h-screen">
        <header className="fixed inset-x-0 top-0 z-50 border-b border-charcoal-3 bg-charcoal">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-expanded={menuOpen}
              className="-ml-2 shrink-0 rounded-lg p-2 text-offwhite hover:bg-charcoal-3 lg:hidden"
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <Link href="/admin" className="flex min-w-0 flex-1 items-center gap-3 lg:flex-none">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/naf-icon.png" alt="" className="h-9 w-9 shrink-0 rounded-full" />
              <div className="min-w-0">
                <div className="font-display text-xl font-bold uppercase leading-none tracking-wide">NafPOS</div>
                <div className="text-xs text-muted">{t('admin', lang)}</div>
              </div>
            </Link>
            <nav className="hidden min-w-0 flex-1 items-center gap-1 text-sm font-semibold lg:flex">
              {adminNav.map((item) => (
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
              onClick={adminSignOut}
              className="hidden rounded-lg border border-charcoal-3 px-3 py-1.5 text-sm font-semibold text-muted hover:bg-charcoal-3 hover:text-offwhite lg:block"
            >
              {t('signOut', lang)}
            </button>
          </div>
        </header>

        <div
          onClick={() => setMenuOpen(false)}
          className={`fixed inset-0 z-40 bg-black/80 transition-opacity lg:hidden ${
            menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        />
        <aside
          aria-hidden={!menuOpen}
          className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85%] flex-col border-r border-charcoal-3 bg-charcoal-2 transition-[transform,visibility] duration-200 lg:hidden ${
            menuOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'
          }`}
        >
          <div className="flex items-center gap-3 border-b border-charcoal-3 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/naf-icon.png" alt="" className="h-10 w-10 rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-lg font-bold uppercase leading-none">NafPOS</div>
              <div className="text-xs text-muted">{t('admin', lang)}</div>
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
            {adminNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-xl px-4 py-3 text-lg font-medium ${
                  item.match(pathname) ? 'bg-brand text-charcoal' : 'text-offwhite hover:bg-charcoal-3'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-charcoal-3 p-3">
            <button
              onClick={adminSignOut}
              className="w-full rounded-xl border border-charcoal-3 px-4 py-3 text-left text-lg text-muted hover:bg-charcoal-3 hover:text-offwhite"
            >
              {t('signOut', lang)}
            </button>
          </div>
        </aside>

        <main className="mx-auto max-w-6xl px-4 py-5 pt-24">{children}</main>
      </div>
    )
  }

  const role = claims.tenant_role ?? ''
  const counter: NavLink[] = []
  if (role === 'owner' || role === 'manager' || role === 'cashier') {
    counter.push(
      { href: '/sell', label: t('sell', lang) },
      { href: '/sales', label: t('sales', lang) },
      { href: '/customers', label: t('customers', lang) },
      { href: '/deni', label: t('deni', lang) },
      { href: '/till', label: t('till', lang) },
    )
  }
  const stock: NavLink[] = [{ href: '/inventory', label: t('inventory', lang) }]
  if (role === 'owner' || role === 'manager' || role === 'storekeeper') {
    stock.push({ href: '/purchases', label: t('purchases', lang) })
  }
  const money: NavLink[] = []
  if (role === 'owner' || role === 'manager') {
    money.push({ href: '/reports', label: t('reports', lang) }, { href: '/billing', label: t('billing', lang) })
  }
  const shop: NavLink[] = [{ href: '/branches', label: t('branches', lang) }]
  if (role === 'owner' || role === 'manager') {
    shop.push({ href: '/staff', label: t('staff', lang) }, { href: '/customers/commissions', label: t('commissions', lang) })
  }
  const groups: NavGroup[] = [
    { id: 'home', label: t('dashboard', lang), items: [{ href: '/dashboard', label: t('dashboard', lang) }] },
  ]
  if (counter.length) groups.push({ id: 'sell', label: t('navGroupSell', lang), items: counter })
  if (stock.length) groups.push({ id: 'stock', label: t('navGroupStock', lang), items: stock })
  if (money.length) groups.push({ id: 'money', label: t('navGroupMoney', lang), items: money })
  if (shop.length) groups.push({ id: 'shop', label: t('navGroupShop', lang), items: shop })

  const isActive = (href: string) => {
    if (pathname === href) return true
    if (!pathname.startsWith(href + '/')) return false
    // Fundi commissions lives under /customers but is its own Shop item
    if (href === '/customers' && pathname.startsWith('/customers/commissions')) return false
    return true
  }
  const doSignOut = () => signOut().then(() => router.replace('/login'))
  const activeGroupId = groups.find((g) => g.items.some((i) => isActive(i.href)))?.id ?? 'home'
  const expandedMobile = mobileGroup === null ? activeGroupId : mobileGroup
  const linkClass = (href: string) =>
    `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
      isActive(href) ? 'bg-brand text-charcoal' : 'text-muted hover:bg-charcoal-3 hover:text-offwhite'
    }`

  return (
    <div className="min-h-screen">
      {/* ---------- top bar ---------- */}
      <header className="print:hidden fixed inset-x-0 top-0 z-50 border-b border-charcoal-3 bg-charcoal">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 lg:gap-3">
          {/* hamburger: phones and small tablets only */}
          <button
            type="button"
            onClick={() => {
              setMenuOpen(true)
              setMobileGroup(null)
            }}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            className="-ml-2 shrink-0 rounded-lg p-2 text-offwhite hover:bg-charcoal-3 lg:hidden"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/naf-icon.png" alt="" className="h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 lg:max-w-[10.5rem] lg:flex-none">
            <div className="truncate font-display text-xl font-bold uppercase leading-none tracking-wide">
              {businessName || 'NafPOS'}
            </div>
            <div className="truncate text-xs text-muted">{t(`role_${role || 'staff'}`, lang)}</div>
          </div>

          <nav ref={desktopNavRef} className="hidden min-w-0 flex-1 items-center gap-1 lg:flex">
            {groups.map((group) => {
              if (group.items.length === 1) {
                const item = group.items[0]
                return (
                  <Link key={item.href} href={item.href} className={linkClass(item.href)}>
                    {item.label}
                  </Link>
                )
              }
              const groupActive = group.items.some((item) => isActive(item.href))
              const open = openGroup === group.id
              return (
                <div key={group.id} className="relative">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-haspopup="menu"
                    onClick={() => setOpenGroup(open ? null : group.id)}
                    className={`inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                      groupActive ? 'bg-brand text-charcoal' : 'text-muted hover:bg-charcoal-3 hover:text-offwhite'
                    }`}
                  >
                    {group.label}
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {open && (
                    <div
                      role="menu"
                      className={`absolute top-full z-50 mt-1 min-w-[13rem] rounded-xl border border-charcoal-3 bg-charcoal-2 py-1 shadow-xl ${
                        group.id === 'money' || group.id === 'shop' ? 'right-0' : 'left-0'
                      }`}
                    >
                      {group.items.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          role="menuitem"
                          onClick={() => setOpenGroup(null)}
                          className={`block px-4 py-2.5 text-sm font-medium ${
                            isActive(item.href) ? 'bg-brand text-charcoal' : 'text-offwhite hover:bg-charcoal-3'
                          }`}
                        >
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={toggleLang}
              aria-label="Toggle language / Badili lugha"
              className="rounded-lg border border-charcoal-3 px-2.5 py-1.5 text-xs font-semibold text-muted hover:bg-charcoal-3 hover:text-offwhite"
            >
              {lang === 'en' ? 'EN | SW' : 'SW | EN'}
            </button>
            <button
              onClick={doSignOut}
              className="hidden rounded-lg border border-charcoal-3 px-3 py-1.5 text-sm text-muted hover:bg-charcoal-3 hover:text-offwhite lg:block"
            >
              {t('signOut', lang)}
            </button>
          </div>
        </div>
      </header>

      <OfflineStatus />
      <BillingLockBar />

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
            <div className="text-xs text-muted">{t(`role_${role || 'staff'}`, lang)}</div>
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
          {groups.map((group) => {
            if (group.items.length === 1) {
              const item = group.items[0]
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded-xl px-4 py-3 text-lg font-medium ${
                    isActive(item.href) ? 'bg-brand text-charcoal' : 'text-offwhite hover:bg-charcoal-3'
                  }`}
                >
                  {item.label}
                </Link>
              )
            }
            const open = expandedMobile === group.id
            const groupActive = group.items.some((item) => isActive(item.href))
            return (
              <div key={group.id}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setMobileGroup(open ? '' : group.id)}
                  className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-lg font-medium ${
                    groupActive ? 'bg-brand text-charcoal' : 'text-offwhite hover:bg-charcoal-3'
                  }`}
                >
                  {group.label}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 12 12"
                    fill="none"
                    aria-hidden="true"
                    className={open ? 'rotate-180' : ''}
                  >
                    <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {open && (
                  <div className="mb-2 mt-1 space-y-1 pl-2">
                    {group.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`block rounded-xl px-4 py-2.5 text-base font-medium ${
                          isActive(item.href) ? 'bg-brand text-charcoal' : 'text-muted hover:bg-charcoal-3 hover:text-offwhite'
                        }`}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
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

      <main className="mx-auto max-w-6xl px-4 py-6 pt-24 print:max-w-none print:p-0">{children}</main>
    </div>
  )
}
