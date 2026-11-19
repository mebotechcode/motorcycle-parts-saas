'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Select } from '@/components/ui'
import CustomerPicker from '@/components/pos/CustomerPicker'
import { uuid, qty as fmtQty } from '@/lib/inventory'
import { isNetworkError, nextOfflineReceipt, queueAdd, useCatalog, type CProduct } from '@/lib/offline'
import {
  BRANCH_KEY,
  CART_KEY,
  computeTax,
  discountPct,
  lineTotal,
  listPrice,
  money,
  round2,
  type CartLine,
  type Customer,
  type Tier,
} from '@/lib/pos'
import { t as tr, useLang } from '@/lib/i18n'
import { binLabel, searchProducts } from '@/lib/search'
import { sendStkPush } from '@/lib/mpesa'
import { friendlyError } from '@/lib/errors'
import CameraScanner from '@/components/CameraScanner'

export default function SellPage() {
  const router = useRouter()
  const { claims, session } = useSession()
  const role = claims.tenant_role
  const isOwner = role === 'owner'
  const maxPct = isOwner ? 100 : Number(claims.max_discount_pct ?? 0)

  const [branchId, setBranchId] = useState('')
  const catalog = useCatalog(branchId)
  const { products, customers, balances, stock, tenant } = catalog

  const [online, setOnline] = useState(true)
  const [tier, setTier] = useState<Tier>('retail')
  const [lines, setLines] = useState<CartLine[]>([])
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [billDiscount, setBillDiscount] = useState('')
  const [cash, setCash] = useState('')
  const [mpesa, setMpesa] = useState('')
  const [mpesaCode, setMpesaCode] = useState('')
  const [bank, setBank] = useState('')
  const [bankRef, setBankRef] = useState('')
  const [saleKey, setSaleKey] = useState(() => uuid())
  const [search, setSearch] = useState('')
  const [scanning, setScanning] = useState(false)
  const [mechanicId, setMechanicId] = useState('')
  const [commission, setCommission] = useState('')
  const [stkPhone, setStkPhone] = useState('')
  const [stkBusy, setStkBusy] = useState(false)
  const [stkInfo, setStkInfo] = useState('')
  const lang = useLang()

  const [desktop, setDesktop] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // ---------- online / screen size
  useEffect(() => {
    setOnline(navigator.onLine)
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    const mq = window.matchMedia('(min-width: 1024px)')
    const m = () => setDesktop(mq.matches)
    m()
    mq.addEventListener('change', m)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      mq.removeEventListener('change', m)
    }
  }, [])

  // ---------- branches (from the device copy)
  const myBranches = useMemo(
    () => catalog.branches.filter((b) => claims.all_branches || (claims.branch_ids ?? []).includes(b.id)),
    [catalog.branches, claims.all_branches, claims.branch_ids]
  )
  useEffect(() => {
    if (branchId || myBranches.length === 0) return
    let saved = ''
    try {
      saved = localStorage.getItem(BRANCH_KEY) ?? ''
    } catch {}
    setBranchId(myBranches.find((b) => b.id === saved)?.id ?? myBranches[0].id)
  }, [myBranches, branchId])
  useEffect(() => {
    if (branchId) {
      try {
        localStorage.setItem(BRANCH_KEY, branchId)
      } catch {}
    }
  }, [branchId])
  const branch = myBranches.find((b) => b.id === branchId)

  // ---------- keep the cart if the page is refreshed
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_KEY)
      if (raw) {
        const c = JSON.parse(raw)
        setLines(c.lines ?? [])
        setTier(c.tier ?? 'retail')
        setCustomer(c.customer ?? null)
        setBillDiscount(c.billDiscount ?? '')
        if (c.saleKey) setSaleKey(c.saleKey)
      }
    } catch {}
    setLoaded(true)
  }, [])
  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(CART_KEY, JSON.stringify({ lines, tier, customer, billDiscount, saleKey }))
    } catch {}
  }, [loaded, lines, tier, customer, billDiscount, saleKey])

  // ---------- product search (on the device: instant, works offline)
  // Matches name, SKU, part number, brand, slang aliases (kenda, coil...)
  // and bike fit. Barcode scan wins immediately.
  const results = useMemo(() => searchProducts(products as any, search, 12) as CProduct[], [search, products])

  const addProduct = useCallback(
    (p: CProduct) => {
      setLines((prev) => {
        const i = prev.findIndex((l) => l.product_id === p.id)
        if (i >= 0) {
          const copy = [...prev]
          copy[i] = { ...copy[i], qty: String(Number(copy[i].qty || 0) + 1) }
          return copy
        }
        const line: CartLine = {
          product_id: p.id,
          name: p.name,
          sku: p.sku,
          unit: p.unit,
          list_retail: Number(p.selling_price),
          list_wholesale: p.wholesale_price === null ? null : Number(p.wholesale_price),
          qty: '1',
          price: '',
          track: p.track_stock,
          tax: p.tax_category,
        }
        line.price = String(listPrice(line, tier))
        return [...prev, line]
      })
      setSearch('')
      setError('')
      searchRef.current?.focus()
    },
    [tier]
  )

  // Enter in the search box: a barcode scanner types the code and presses Enter
  function onSearchEnter() {
    const s = search.trim()
    if (!s) return
    const exact = products.find((p) => p.is_active && !p.deleted_at && p.barcodes?.includes(s))
    const hit = exact ?? results[0]
    if (hit) addProduct(hit)
  }

  // Camera scan: barcode wins, otherwise take the top slang/name match
  function onScanDetected(code: string) {
    const s = code.trim()
    if (!s) return
    const exact = products.find((p) => p.is_active && !p.deleted_at && p.barcodes?.includes(s))
    const hit = exact ?? (searchProducts(products as any, s, 1) as CProduct[])[0]
    if (hit) {
      addProduct(hit)
    } else {
      setSearch(s)
      setError(`No part found for code ${s}`)
    }
    setScanning(false)
  }

  function changeTier(t: Tier) {
    setTier(t)
    setLines((prev) => prev.map((l) => ({ ...l, price: String(listPrice(l, t)) })))
  }
  function pickCustomer(c: Customer | null) {
    setCustomer(c)
    if (c && c.price_tier === 'wholesale' && tier !== 'wholesale') changeTier('wholesale')
  }
  const setLine = (id: string, patch: Partial<CartLine>) => setLines((prev) => prev.map((l) => (l.product_id === id ? { ...l, ...patch } : l)))

  // ---------- totals
  const t = useMemo(() => {
    const subtotal = round2(lines.reduce((s, l) => s + lineTotal(l), 0))
    const disc = Math.min(Math.max(Number(billDiscount || 0), 0), subtotal)
    const total = round2(subtotal - disc)
    const cashIn = Math.max(Number(cash || 0), 0)
    const mp = Math.max(Number(mpesa || 0), 0)
    const bk = Math.max(Number(bank || 0), 0)
    const nonCash = round2(mp + bk)
    const cashApplied = round2(Math.min(cashIn, Math.max(0, total - nonCash)))
    const paid = round2(nonCash + cashApplied)
    return { subtotal, disc, total, cashIn, mp, bk, nonCash, cashApplied, paid, change: round2(cashIn - cashApplied), due: round2(total - paid) }
  }, [lines, billDiscount, cash, mpesa, bank])

  const overLimit = lines.filter((l) => !isOwner && discountPct(l, tier) > maxPct + 0.001)
  const billPct = t.subtotal > 0 ? (t.disc / t.subtotal) * 100 : 0
  const billOver = !isOwner && billPct > maxPct + 0.001

  const problem = (() => {
    if (lines.length === 0) return 'Add at least one item'
    if (!branchId) return 'Choose a branch'
    if (lines.some((l) => !(Number(l.qty) > 0))) return 'Every item needs a quantity'
    if (lines.some((l) => l.price === '' || Number(l.price) < 0)) return 'Every item needs a price'
    if (overLimit.length > 0) return `Discount on ${overLimit[0].name} is above your limit of ${maxPct}%`
    if (billOver) return `The bill discount is above your limit of ${maxPct}%`
    if (t.nonCash > t.total + 0.001) return 'M-Pesa and bank amounts are more than the total'
    if (t.mp > 0 && !/^[A-Za-z0-9]{8,12}$/.test(mpesaCode.trim())) return 'Enter the M-Pesa transaction code (8 to 12 letters and numbers)'
    if (t.due > 0.009 && !customer) return 'Not fully paid: choose a customer to put the balance on credit'
    return ''
  })()

  function clearAll() {
    setLines([])
    setCustomer(null)
    setBillDiscount('')
    setCash('')
    setMpesa('')
    setMpesaCode('')
    setBank('')
    setBankRef('')
    setError('')
    setSaleKey(uuid())
    try {
      localStorage.removeItem(CART_KEY)
    } catch {}
  }

  // Save the sale on this device (no internet). It is sent automatically later.
  async function saveOffline(payload: any) {
    const code = branch?.code ?? 'OFF'
    const receiptNo = await nextOfflineReceipt(branchId, code)
    const soldAt = new Date().toISOString()
    const items = lines.map((l, i) => {
      const list = listPrice(l, tier)
      const unit = Math.max(list, Number(l.price))
      return {
        id: `${saleKey}-${i}`,
        product_name: l.name,
        quantity: Number(l.qty),
        unit_price: unit,
        discount_amount: round2(Number(l.qty) * (unit - Number(l.price))),
        line_total: lineTotal(l),
        returned_qty: 0,
      }
    })
    const payments = (payload.payments as any[]).map((p, i) => ({ id: `${saleKey}-p${i}`, method: p.method, amount: p.amount, reference: p.reference ?? null }))
    const sale = {
      id: saleKey,
      receipt_no: receiptNo,
      sold_at: soldAt,
      status: 'completed',
      subtotal: t.subtotal,
      discount_total: t.disc,
      tax_total: computeTax(lines, tenant, t.subtotal, t.total),
      total: t.total,
      amount_paid: t.paid,
      balance_due: t.due,
    }
    await queueAdd({
      key: saleKey,
      created_at: soldAt,
      status: 'pending',
      attempts: 0,
      payload: { ...payload, receipt_no: receiptNo, sold_at: soldAt },
      receipt: {
        sale,
        items,
        payments,
        customer: customer ? { name: customer.name, phone: customer.phone } : null,
        cashier: (session?.user.user_metadata?.full_name as string) ?? '',
        branch: { name: branch?.name, phone: branch?.phone },
        tenant,
      },
    })
    clearAll()
    router.push(`/sales/pending?key=${saleKey}`)
  }

  async function charge() {
    setError('')
    if (problem) return setError(problem)
    const payments: any[] = []
    if (t.cashApplied > 0) payments.push({ method: 'cash', amount: t.cashApplied })
    if (t.mp > 0) payments.push({ method: 'mpesa', amount: t.mp, reference: mpesaCode.trim().toUpperCase() })
    if (t.bk > 0) payments.push({ method: 'bank', amount: t.bk, reference: bankRef.trim() || null })
    const payload = {
      client_uuid: saleKey,
      branch_id: branchId,
      customer_id: customer?.id ?? null,
      price_tier: tier,
      discount_total: t.disc,
      items: lines.map((l) => ({ product_id: l.product_id, qty: Number(l.qty), unit_price: Number(l.price) })),
      payments,
      // fundi referral rides along so offline sales settle commissions on sync
      mechanic_id: mechanicId || null,
      mechanic_commission: Number(commission || 0),
    }

    setBusy(true)
    try {
      if (!navigator.onLine) {
        await saveOffline(payload)
        return
      }
      const { data, error } = await supabase.rpc('complete_sale', { p_data: payload })
      if (error) {
        if (isNetworkError(error.message)) {
          await saveOffline(payload) // the connection dropped: keep the sale on this device
          return
        }
        setError(friendlyError(error))
        return
      }
      const id = (data as any).sale_id
      // Mechanic referral (fundi commission) — recorded after the sale so
      // offline sales keep working; failures never block the sale.
      if (mechanicId && online) {
        await supabase.rpc('set_sale_referral', { p_sale_id: id, p_mechanic_id: mechanicId, p_commission: Number(commission || 0) })
      }
      // Queue eTIMS transmission (offline-safe: drains when online)
      if (tenant?.kra_pin) {
        await supabase.rpc('queue_etims_invoice', { p_sale_id: id }).then(() => {})
        supabase.functions.invoke('etims-submit', { body: { sale_id: id } }).then(() => {})
      }
      clearAll()
      router.push(`/sales/${id}?new=1`)
    } finally {
      setBusy(false)
    }
  }

  if (role === 'storekeeper') return <Alert kind="info">Storekeepers cannot make sales.</Alert>

  const itemCount = lines.reduce((s, l) => s + Number(l.qty || 0), 0)
  const stockOf = (id: string) => stock[id]

  // ---------- the cart (beside the products on a computer, full-screen sheet on a phone)
  const cart = (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Current sale</h2>
        <div className="flex items-center gap-3">
          {lines.length > 0 && (
            <button type="button" onClick={() => window.confirm('Clear this sale?') && clearAll()} className="text-sm text-muted hover:text-red-300">
              Clear
            </button>
          )}
          {!desktop && (
            <button type="button" onClick={() => setSheet(false)} className="rounded-lg border border-charcoal-3 px-3 py-1.5 text-sm">
              Close
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {myBranches.length > 1 ? (
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {myBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        ) : (
          <div className="flex items-center rounded-lg border border-charcoal-3 bg-charcoal px-3 text-sm text-muted">{branch?.name ?? ''}</div>
        )}
        <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-charcoal-3 text-sm">
          {(['retail', 'wholesale'] as Tier[]).map((x) => (
            <button
              type="button"
              key={x}
              onClick={() => changeTier(x)}
              className={`px-2 py-2.5 font-medium ${tier === x ? 'bg-brand text-charcoal' : 'bg-charcoal text-muted hover:bg-charcoal-3'}`}
            >
              {x === 'retail' ? 'Retail' : 'Wholesale'}
            </button>
          ))}
        </div>
      </div>

      <CustomerPicker
        value={customer}
        onChange={pickCustomer}
        canSetCredit={role === 'owner' || role === 'manager'}
        customers={customers as unknown as Customer[]}
        balances={balances}
        online={online}
        onCreated={() => catalog.sync()}
      />

      {/* Mechanic (fundi) referral + commission */}
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-charcoal-3 bg-charcoal p-3">
        <Select label={tr('referredBy', lang)} value={mechanicId} onChange={(e) => setMechanicId(e.target.value)}>
          <option value="">No fundi</option>
          {(customers as any[]).filter((c: any) => c.customer_type === 'mechanic').map((c: any) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <label className="block">
          <span className="mb-1 block text-sm text-muted">{tr('commission', lang)}</span>
          <input value={commission} inputMode="decimal" onChange={(e) => setCommission(e.target.value)} placeholder="0" className="w-full rounded-lg border border-charcoal-3 bg-charcoal-2 px-3 py-2.5 focus:border-brand focus:outline-none" />
        </label>
      </div>

      {lines.length === 0 ? (
        <p className="rounded-xl border border-dashed border-charcoal-3 p-6 text-center text-sm text-muted">No items yet. Search a part and tap it to add.</p>
      ) : (
        <div className="space-y-2">
          {lines.map((l) => {
            const pct = discountPct(l, tier)
            const left = stockOf(l.product_id)
            const tooMany = l.track && left !== undefined && Number(l.qty) > left
            return (
              <div key={l.product_id} className="rounded-xl border border-charcoal-3 bg-charcoal p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{l.name}</div>
                    <div className="text-xs text-muted">
                      {l.sku} · list KES {money(listPrice(l, tier))}
                      {left !== undefined && l.track && <> · {fmtQty(left)} in stock</>}
                    </div>
                  </div>
                  <button type="button" aria-label="Remove" onClick={() => setLines(lines.filter((x) => x.product_id !== l.product_id))} className="text-lg text-muted hover:text-red-300">
                    ×
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-[auto_1fr_1fr] items-end gap-2">
                  <div className="flex items-center overflow-hidden rounded-lg border border-charcoal-3">
                    <button type="button" className="px-3 py-2 text-lg hover:bg-charcoal-3" onClick={() => setLine(l.product_id, { qty: String(Math.max(0, Number(l.qty || 0) - 1)) })}>
                      −
                    </button>
                    <input value={l.qty} inputMode="decimal" onChange={(e) => setLine(l.product_id, { qty: e.target.value })} aria-label="Quantity" className="w-12 bg-charcoal-2 py-2 text-center focus:outline-none" />
                    <button type="button" className="px-3 py-2 text-lg hover:bg-charcoal-3" onClick={() => setLine(l.product_id, { qty: String(Number(l.qty || 0) + 1) })}>
                      +
                    </button>
                  </div>
                  <label className="block">
                    <span className="block text-[11px] text-muted">Price each</span>
                    <input
                      value={l.price}
                      inputMode="decimal"
                      onChange={(e) => setLine(l.product_id, { price: e.target.value })}
                      className={`w-full rounded-lg border bg-charcoal-2 px-2 py-2 focus:outline-none ${!isOwner && pct > maxPct + 0.001 ? 'border-red-400' : 'border-charcoal-3 focus:border-brand'}`}
                    />
                  </label>
                  <div className="text-right">
                    <div className="text-[11px] text-muted">Total</div>
                    <div className="font-display text-xl font-bold">{money(lineTotal(l))}</div>
                  </div>
                </div>
                {pct > 0 && (
                  <div className={`mt-1 text-xs ${!isOwner && pct > maxPct + 0.001 ? 'text-red-300' : 'text-brand'}`}>
                    Discount {pct.toFixed(1)}%{!isOwner && ` (your limit is ${maxPct}%)`}
                  </div>
                )}
                {tooMany && <div className="mt-1 text-xs text-brand">Only {fmtQty(left)} in stock at this branch</div>}
              </div>
            )
          })}
        </div>
      )}

      {lines.length > 0 && (
        <>
          <div className="space-y-1 rounded-xl bg-charcoal p-3 text-sm">
            <div className="flex justify-between text-muted">
              <span>Subtotal</span>
              <span>KES {money(t.subtotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Bill discount (KES)</span>
              <input value={billDiscount} inputMode="decimal" onChange={(e) => setBillDiscount(e.target.value)} placeholder="0" className="w-28 rounded-lg border border-charcoal-3 bg-charcoal-2 px-2 py-1.5 text-right focus:border-brand focus:outline-none" />
            </div>
            <div className="flex items-baseline justify-between pt-1">
              <span className="font-semibold">TOTAL</span>
              <span className="font-display text-4xl font-bold text-brand">KES {money(t.total)}</span>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-charcoal-3 p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Payment</h3>
              <div className="flex gap-2 text-xs">
                <button type="button" onClick={() => setCash(String(t.total))} className="rounded-lg border border-charcoal-3 px-2 py-1 hover:bg-charcoal-3">
                  All cash
                </button>
                <button type="button" onClick={() => setMpesa(String(Math.max(0, round2(t.total - t.bk - t.cashApplied))))} className="rounded-lg border border-charcoal-3 px-2 py-1 hover:bg-charcoal-3">
                  Rest M-Pesa
                </button>
              </div>
            </div>
            <label className="block">
              <span className="mb-1 block text-sm text-muted">Cash received</span>
              <input value={cash} inputMode="decimal" onChange={(e) => setCash(e.target.value)} placeholder="0" className="w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2.5 focus:border-brand focus:outline-none" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-sm text-muted">{tr('mpesaAmount', lang)}</span>
                <input value={mpesa} inputMode="decimal" onChange={(e) => setMpesa(e.target.value)} placeholder="0" className="w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2.5 focus:border-brand focus:outline-none" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-muted">{tr('mpesaCode', lang)}</span>
                <input value={mpesaCode} onChange={(e) => setMpesaCode(e.target.value.toUpperCase())} placeholder="e.g. SFK1A2B3C4" maxLength={12} className="w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2.5 uppercase focus:border-brand focus:outline-none" />
              </label>
            </div>
            {/* STK Push: send a payment request to the customer's phone */}
            {online && (
              <div className="space-y-2 rounded-lg bg-charcoal p-3">
                <div className="flex flex-wrap gap-2">
                  <input value={stkPhone} onChange={(e) => setStkPhone(e.target.value)} placeholder="Customer phone e.g. 0712 345 678" className="min-w-0 flex-1 rounded-lg border border-charcoal-3 bg-charcoal-2 px-3 py-2.5 text-sm focus:border-brand focus:outline-none" />
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={stkBusy || t.total <= 0}
                    onClick={async () => {
                      setStkBusy(true)
                      setStkInfo('')
                      const r = await sendStkPush({ phone: stkPhone, amount: t.total, branch_id: branchId, customer_id: customer?.id, invoke: (fn, body) => supabase.functions.invoke(fn, { body }) as any })
                      setStkBusy(false)
                      if (r.ok) {
                        setMpesa(String(t.total))
                        setStkInfo(tr('stkSent', lang))
                      } else setError(friendlyError(r.error ?? 'M-Pesa did not accept the request. Try again.'))
                    }}
                  >
                    {stkBusy ? 'Sending...' : tr('sendStk', lang)}
                  </Button>
                </div>
                {stkInfo && <p className="text-xs text-emerald-300">{stkInfo}</p>}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-sm text-muted">Bank amount</span>
                <input value={bank} inputMode="decimal" onChange={(e) => setBank(e.target.value)} placeholder="0" className="w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2.5 focus:border-brand focus:outline-none" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-muted">Bank reference</span>
                <input value={bankRef} onChange={(e) => setBankRef(e.target.value)} className="w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2.5 focus:border-brand focus:outline-none" />
              </label>
            </div>

            <div className="space-y-1 rounded-lg bg-charcoal p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Paid</span>
                <b>KES {money(t.paid)}</b>
              </div>
              {t.change > 0 && (
                <div className="flex justify-between text-emerald-300">
                  <span>Change to give</span>
                  <b className="font-display text-2xl">KES {money(t.change)}</b>
                </div>
              )}
              {t.due > 0.009 && (
                <div className="flex justify-between text-brand">
                  <span>{customer ? 'On credit' : 'Still to pay'}</span>
                  <b>KES {money(t.due)}</b>
                </div>
              )}
            </div>
          </div>

          {(error || problem) && <Alert>{error || problem}</Alert>}
          {!online && <Alert kind="info">You are offline. This sale will be saved on this device and sent when the internet is back.</Alert>}
          <Button onClick={charge} disabled={busy || !!problem} className="w-full py-4 text-lg">
            {busy ? 'Saving...' : `${online ? 'Complete sale' : 'Save sale'} · KES ${money(t.total)}`}
          </Button>
        </>
      )}
    </div>
  )

  const preparing = products.length === 0 && (catalog.status === 'loading' || catalog.status === 'syncing')

  return (
    <div className={`${!desktop && lines.length > 0 ? 'pb-24' : ''}`}>
      <div className="grid gap-6 lg:grid-cols-[1fr_27rem]">
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h1 className="text-4xl font-bold">Sell</h1>
            <div className="text-right text-xs text-muted">
              {catalog.status === 'syncing' ? 'Updating prices and stock...' : catalog.lastSync ? `Prices & stock updated ${new Date(catalog.lastSync).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}` : ''}
              {online && catalog.status !== 'syncing' && (
                <button type="button" onClick={() => catalog.sync(true)} className="ml-2 text-brand hover:underline">
                  Refresh all
                </button>
              )}
            </div>
          </div>

          <div className="flex gap-2">
          <input
            ref={searchRef}
            autoFocus={desktop}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onSearchEnter()
              }
            }}
            placeholder={tr('searchPart', lang)}
            className="w-full rounded-xl border border-charcoal-3 bg-charcoal-2 px-4 py-3.5 text-lg placeholder:text-muted/60 focus:border-brand focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setScanning(true)}
            aria-label="Scan a barcode with the camera"
            title="Scan with camera"
            className="shrink-0 rounded-xl border border-charcoal-3 bg-charcoal-2 px-4 text-xl hover:bg-charcoal-3"
          >
            📷
          </button>
          </div>
          {scanning && <CameraScanner onDetect={onScanDetected} onClose={() => setScanning(false)} />}

          {preparing && <Alert kind="info">Getting your parts list ready. This happens once and may take a moment...</Alert>}
          {catalog.status === 'error' && products.length === 0 && (
            <Alert>
              Could not load your parts list: {catalog.error}{' '}
              <button type="button" className="underline" onClick={() => catalog.sync(true)}>
                Try again
              </button>
            </Alert>
          )}
          {products.length === 0 && !online && catalog.status !== 'syncing' && (
            <Alert>This device has no saved parts list yet. Connect to the internet and open this page once, then offline selling will work.</Alert>
          )}

          {results.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {results.map((p) => {
                const price = tier === 'wholesale' ? p.wholesale_price ?? p.selling_price : p.selling_price
                const left = stockOf(p.id)
                const bin = binLabel(p as any)
                return (
                  <button type="button" key={p.id} onClick={() => addProduct(p)} className="flex items-center justify-between gap-3 rounded-xl border border-charcoal-3 bg-charcoal-2 p-3 text-left hover:border-brand/60">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{p.name}</div>
                      <div className="truncate text-xs text-muted">
                        {p.sku}
                        {p.brand_name ? ` · ${p.brand_name}` : ''}
                      </div>
                      <div className="flex flex-wrap gap-x-2 text-xs">
                        {p.track_stock && left !== undefined && <span className={left <= 0 ? 'text-red-300' : 'text-muted'}>{left <= 0 ? tr('outOfStock', lang) : `${fmtQty(left)} ${tr('inStock', lang)}`}</span>}
                        {bin && <span className="rounded bg-brand/15 px-1.5 py-0.5 font-semibold text-brand">{bin}</span>}
                        {(p.aliases ?? []).length > 0 && <span className="text-muted">aka {(p.aliases ?? []).slice(0, 3).join(', ')}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-display text-xl font-bold text-brand">{money(price)}</div>
                      <div className="text-xs text-muted">{tr('tapToAdd', lang)}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : search.trim().length >= 2 ? (
            <p className="text-muted">No parts found for &quot;{search}&quot;.</p>
          ) : (
            !preparing && <p className="text-sm text-muted">Type at least 2 letters, or scan a barcode and press Enter.</p>
          )}
        </section>

        {desktop && <aside className="lg:sticky lg:top-24 lg:self-start">{cart}</aside>}
      </div>

      {!desktop && lines.length > 0 && !sheet && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-charcoal-3 bg-charcoal/95 p-3 backdrop-blur">
          <button type="button" onClick={() => setSheet(true)} className="flex w-full items-center justify-between rounded-xl bg-brand px-4 py-3.5 font-semibold text-charcoal">
            <span>
              Cart · {fmtQty(itemCount)} item{itemCount === 1 ? '' : 's'}
            </span>
            <span className="font-display text-2xl font-bold">KES {money(t.total)} →</span>
          </button>
        </div>
      )}
      {!desktop && sheet && <div className="fixed inset-0 z-50 overflow-y-auto bg-charcoal p-4 pb-10">{cart}</div>}
    </div>
  )
}
