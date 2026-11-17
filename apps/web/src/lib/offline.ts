// Offline engine: keeps a copy of the catalogue on the device (IndexedDB),
// queues sales made without internet, and sends them when the connection returns.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// =====================================================================
// IndexedDB helpers (no extra packages)
// =====================================================================
type Store = 'products' | 'stock' | 'customers' | 'balances' | 'queue' | 'meta'

let dbPromise: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('naf-pos', 1)
      req.onupgradeneeded = () => {
        const d = req.result
        d.createObjectStore('products', { keyPath: 'id' })
        d.createObjectStore('stock', { keyPath: 'key' })
        d.createObjectStore('customers', { keyPath: 'id' })
        d.createObjectStore('balances', { keyPath: 'customer_id' })
        d.createObjectStore('queue', { keyPath: 'key' })
        d.createObjectStore('meta', { keyPath: 'k' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

async function run<T = any>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  const d = await db()
  return new Promise<T>((resolve, reject) => {
    const t = d.transaction(store, mode)
    const r = fn(t.objectStore(store))
    t.oncomplete = () => resolve((r ? (r as IDBRequest).result : undefined) as T)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export const idbGetAll = <T = any>(s: Store) => run<T[]>(s, 'readonly', (st) => st.getAll())
export const idbGet = <T = any>(s: Store, key: string) => run<T | undefined>(s, 'readonly', (st) => st.get(key))
export const idbPut = (s: Store, v: any) => run(s, 'readwrite', (st) => st.put(v))
export const idbDelete = (s: Store, key: string) => run(s, 'readwrite', (st) => st.delete(key))
export const idbClear = (s: Store) => run(s, 'readwrite', (st) => st.clear())

export async function idbPutMany(s: Store, rows: any[]) {
  if (rows.length === 0) return
  const d = await db()
  return new Promise<void>((resolve, reject) => {
    const t = d.transaction(s, 'readwrite')
    const st = t.objectStore(s)
    rows.forEach((r) => st.put(r))
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export const getMeta = async <T = any>(k: string): Promise<T | undefined> => (await idbGet<{ k: string; v: T }>('meta', k))?.v
export const setMeta = (k: string, v: any) => idbPut('meta', { k, v })

// =====================================================================
// Types
// =====================================================================
export type CProduct = {
  id: string
  name: string
  sku: string
  unit: string
  part_number: string | null
  brand_name: string | null
  selling_price: number
  wholesale_price: number | null
  tax_category: string
  track_stock: boolean
  is_active: boolean
  deleted_at: string | null
  updated_at: string
  barcodes: string[]
  aliases?: string[]
  aisle?: string | null
  rack?: string | null
  bin?: string | null
  shelf_location?: string | null
  hs_code?: string | null
  etims_code?: string | null
  bike_model_ids?: string[]
}
export type CCustomer = {
  id: string
  name: string
  phone: string | null
  credit_limit: number
  payment_terms_days?: number
  boda_stage?: string | null
  price_tier: 'retail' | 'wholesale'
  customer_type: string
  is_active: boolean
  deleted_at: string | null
  updated_at: string
}
export type CBranch = { id: string; name: string; code: string; phone: string | null }

export type QueuedSale = {
  key: string
  created_at: string
  status: 'pending' | 'failed'
  error?: string
  attempts: number
  payload: any
  receipt: any
}

export const isNetworkError = (msg: string) => /failed to fetch|network|load failed|timeout|fetch|offline/i.test(msg)

// =====================================================================
// Catalogue download (full the first time, then only what changed)
// =====================================================================
const PAGE = 1000

async function pullAll(build: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data as any[]) ?? []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

const maxTs = (rows: any[], prev?: string) => rows.reduce((m, r) => (r.updated_at && (!m || r.updated_at > m) ? r.updated_at : m), prev ?? '')

export async function syncCatalog(branchId: string, full = false) {
  // products
  const pSince = full ? undefined : await getMeta<string>('products_at')
  const products = await pullAll((a, b) => {
    let q = supabase
      .from('product_overview')
      .select('id,name,sku,unit,part_number,brand_name,selling_price,wholesale_price,tax_category,track_stock,is_active,deleted_at,updated_at,barcodes,aliases,aisle,rack,bin,shelf_location,hs_code,etims_code,bike_model_ids')
      .order('updated_at', { ascending: true })
      .order('id')
      .range(a, b)
    if (pSince) q = q.gte('updated_at', pSince)
    return q
  })
  if (full) await idbClear('products')
  await idbPutMany('products', products)
  if (products.length > 0 || full) await setMeta('products_at', maxTs(products, full ? '' : pSince) || undefined)

  // stock of this branch
  if (branchId) {
    const sSince = full ? undefined : await getMeta<string>('stock_at:' + branchId)
    const levels = await pullAll((a, b) => {
      let q = supabase.from('stock_levels').select('product_id,quantity,updated_at').eq('branch_id', branchId).order('updated_at', { ascending: true }).order('product_id').range(a, b)
      if (sSince) q = q.gte('updated_at', sSince)
      return q
    })
    await idbPutMany('stock', levels.map((r) => ({ key: `${branchId}:${r.product_id}`, branch_id: branchId, product_id: r.product_id, quantity: Number(r.quantity) })))
    if (levels.length > 0) await setMeta('stock_at:' + branchId, maxTs(levels, sSince))
  }

  // customers and what they owe
  const cSince = full ? undefined : await getMeta<string>('customers_at')
  const customers = await pullAll((a, b) => {
    let q = supabase
      .from('customers')
      .select('id,name,phone,credit_limit,payment_terms_days,boda_stage,price_tier,customer_type,is_active,deleted_at,updated_at')
      .order('updated_at', { ascending: true })
      .order('id')
      .range(a, b)
    if (cSince) q = q.gte('updated_at', cSince)
    return q
  })
  await idbPutMany('customers', customers)
  if (customers.length > 0) await setMeta('customers_at', maxTs(customers, cSince))

  const bal = await supabase.from('customer_balances').select('customer_id,balance')
  if (!bal.error) {
    await idbClear('balances')
    await idbPutMany('balances', ((bal.data as any[]) ?? []).map((x) => ({ customer_id: x.customer_id, balance: Number(x.balance) })))
  }

  // shop and branches (for offline receipts)
  const [ten, br] = await Promise.all([
    supabase.from('tenants').select('name,address,town,phone,kra_pin,receipt_footer,vat_registered,vat_rate,etims_device_serial,etims_vscu_serial,etims_branch_code,mpesa_till_number,mpesa_paybill_number').maybeSingle(),
    supabase.from('branches').select('id,name,code,phone').eq('is_active', true).order('name'),
  ])
  if (ten.data) await setMeta('tenant', ten.data)
  if (br.data) await setMeta('branches', br.data)
  await setMeta('last_sync', new Date().toISOString())
}

// =====================================================================
// The queue of sales made offline
// =====================================================================
export const notifyQueue = () => typeof window !== 'undefined' && window.dispatchEvent(new Event('offline-queue-changed'))

export const queueAll = () => idbGetAll<QueuedSale>('queue')
export async function queueAdd(q: QueuedSale) {
  await idbPut('queue', q)
  notifyQueue()
}
export async function queueRemove(key: string) {
  await idbDelete('queue', key)
  notifyQueue()
}

function deviceId(): string {
  try {
    let d = localStorage.getItem('pos_device')
    if (!d) {
      d = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')
      localStorage.setItem('pos_device', d)
    }
    return d
  } catch {
    return 'ZZZZ'
  }
}

// e.g. NRB-D4F2-0007: branch code, this device, a running number
export async function nextOfflineReceipt(branchId: string, branchCode: string) {
  const n = ((await getMeta<number>('seq:' + branchId)) ?? 0) + 1
  await setMeta('seq:' + branchId, n)
  return `${branchCode}-D${deviceId()}-${String(n).padStart(4, '0')}`
}

let sending = false
export async function syncQueue(): Promise<{ sent: number; failed: number; stopped: boolean }> {
  const result = { sent: 0, failed: 0, stopped: false }
  if (sending) return result
  sending = true
  try {
    const tenant = await getMeta<any>('tenant').catch(() => null)
    const items = (await queueAll()).filter((x) => x.status === 'pending').sort((a, b) => a.created_at.localeCompare(b.created_at))
    for (const it of items) {
      const { data, error } = await supabase.rpc('complete_sale', { p_data: { ...it.payload, offline: true } })
      if (error) {
        // no connection, or the login needs refreshing: stop and try again later
        if (isNetworkError(error.message) || /jwt|token|expired|not authenticated/i.test(error.message)) {
          result.stopped = true
          break
        }
        await idbPut('queue', { ...it, status: 'failed', error: error.message, attempts: it.attempts + 1 })
        result.failed++
      } else {
        const saleId = (data as any)?.sale_id
        // Post-sync bookkeeping (never blocks the sale): fundi commission + eTIMS queue
        if (saleId) {
          if (it.payload?.mechanic_id) {
            await supabase
              .rpc('set_sale_referral', { p_sale_id: saleId, p_mechanic_id: it.payload.mechanic_id, p_commission: Number(it.payload.mechanic_commission ?? 0) })
              .then(() => {}, () => {})
          }
          if (tenant?.kra_pin) {
            await supabase.rpc('queue_etims_invoice', { p_sale_id: saleId }).then(() => {}, () => {})
            supabase.functions.invoke('etims-submit', { body: { transmit_all: true } }).then(() => {}, () => {})
          }
        }
        await idbDelete('queue', it.key)
        result.sent++
      }
      notifyQueue()
    }
  } finally {
    sending = false
  }
  notifyQueue()
  return result
}

// units of each product sitting in unsent sales (so stock on screen stays honest)
export async function pendingQuantities(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const q of await queueAll()) {
    for (const i of q.payload?.items ?? []) out[i.product_id] = (out[i.product_id] ?? 0) + Number(i.qty)
  }
  return out
}

// =====================================================================
// React hook: the local catalogue for the Sell screen
// =====================================================================
export function useCatalog(branchId: string) {
  const [products, setProducts] = useState<CProduct[]>([])
  const [customers, setCustomers] = useState<CCustomer[]>([])
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [stock, setStock] = useState<Record<string, number>>({})
  const [branches, setBranches] = useState<CBranch[]>([])
  const [tenant, setTenant] = useState<any>(null)
  const [lastSync, setLastSync] = useState('')
  const [status, setStatus] = useState<'loading' | 'syncing' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')

  const loadLocal = useCallback(async () => {
    const [p, c, b, s, br, ten, ls, pend] = await Promise.all([
      idbGetAll<CProduct>('products'),
      idbGetAll<CCustomer>('customers'),
      idbGetAll<{ customer_id: string; balance: number }>('balances'),
      idbGetAll<{ branch_id: string; product_id: string; quantity: number }>('stock'),
      getMeta<CBranch[]>('branches'),
      getMeta<any>('tenant'),
      getMeta<string>('last_sync'),
      pendingQuantities(),
    ])
    setProducts(p)
    setCustomers(c.filter((x) => x.is_active && !x.deleted_at))
    setBalances(Object.fromEntries(b.map((x) => [x.customer_id, x.balance])))
    const st: Record<string, number> = {}
    s.filter((x) => x.branch_id === branchId).forEach((x) => (st[x.product_id] = Number(x.quantity)))
    Object.entries(pend).forEach(([id, n]) => (st[id] = (st[id] ?? 0) - n))
    setStock(st)
    setBranches(br ?? [])
    setTenant(ten ?? null)
    setLastSync(ls ?? '')
    return { products: p.length, branches: (br ?? []).length }
  }, [branchId])

  const sync = useCallback(
    async (full = false) => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return
      setStatus('syncing')
      try {
        await syncCatalog(branchId, full)
        await loadLocal()
        setError('')
        setStatus('ready')
      } catch (e: any) {
        await loadLocal()
        setError(e?.message ?? 'Could not update the catalogue')
        setStatus('error')
      }
    },
    [branchId, loadLocal]
  )

  useEffect(() => {
    let alive = true
    ;(async () => {
      const r = await loadLocal()
      if (!alive) return
      setStatus(r.products > 0 ? 'ready' : 'loading')
      if (navigator.onLine) sync()
    })()
    return () => {
      alive = false
    }
  }, [branchId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onOnline = () => sync()
    const onQueue = () => loadLocal()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline-queue-changed', onQueue)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline-queue-changed', onQueue)
    }
  }, [sync, loadLocal])

  return { products, customers, balances, stock, branches, tenant, lastSync, status, error, sync, reload: loadLocal }
}
