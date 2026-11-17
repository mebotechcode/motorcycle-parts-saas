'use client'

// A4 tax invoice / delivery note for a sale — mainly for garage and fundi
// accounts on 7/14/30-day credit. Prints like a proper Kenyan invoice:
// seller PIN, item HS codes, VAT breakdown, eTIMS CU block when submitted.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Spinner } from '@/components/ui'
import { etimsQrDataUrl } from '@/lib/etims'
import { money } from '@/lib/pos'

const TAX_LABEL: Record<string, string> = { standard: '16%', zero_rated: '0%', exempt: 'Exempt' }

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  void router
  const { claims } = useSession()
  void claims

  const [state, setState] = useState<'loading' | 'missing' | 'ready'>('loading')
  const [sale, setSale] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [tenant, setTenant] = useState<any>(null)
  const [branch, setBranch] = useState<any>(null)
  const [customer, setCustomer] = useState<any>(null)
  const [cashier, setCashier] = useState('')
  const [hsCodes, setHsCodes] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const s = await supabase.from('sales').select('*').eq('id', id).maybeSingle()
    if (!s.data) {
      setState('missing')
      return
    }
    const sl = s.data as any
    const [it, pay, ten, br, cu, pr] = await Promise.all([
      supabase.from('sale_items').select('*').eq('sale_id', id).order('created_at'),
      supabase.from('payments').select('*').eq('sale_id', id).order('paid_at'),
      supabase.from('tenants').select('name,address,town,phone,kra_pin,receipt_footer').maybeSingle(),
      supabase.from('branches').select('name,phone,address').eq('id', sl.branch_id).maybeSingle(),
      sl.customer_id ? supabase.from('customers').select('name,phone,payment_terms_days').eq('id', sl.customer_id).maybeSingle() : Promise.resolve({ data: null }),
      sl.cashier_id ? supabase.from('profiles').select('full_name').eq('id', sl.cashier_id).maybeSingle() : Promise.resolve({ data: null }),
    ])
    setSale(sl)
    setItems((it.data as any[]) ?? [])
    setPayments((pay.data as any[]) ?? [])
    setTenant(ten.data)
    setBranch(br.data)
    setCustomer((cu as any).data)
    setCashier((pr as any)?.data?.full_name ?? '')
    const ids = [...new Set(((it.data as any[]) ?? []).map((i) => i.product_id))]
    if (ids.length) {
      const { data } = await supabase.from('products').select('id,hs_code').in('id', ids)
      const m: Record<string, string> = {}
      for (const p of (data as any[]) ?? []) if (p.hs_code) m[p.id] = p.hs_code
      setHsCodes(m)
    }
    setState('ready')
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (state === 'loading') return <Spinner />
  if (state === 'missing') return <Alert kind="info">This sale was not found.</Alert>

  const paid = payments.reduce((s, p) => (p.is_verified === false && p.method === 'mpesa' ? s : s + Number(p.amount)), 0)
  const due = Math.max(0, Number(sale.total) - paid)
  const sold = new Date(sale.sold_at)
  const terms = Number(customer?.payment_terms_days ?? 0)
  const dueDate = terms > 0 ? new Date(sold.getTime() + terms * 24 * 3600 * 1000) : null
  const taxable = items.reduce((s, i) => s + Number(i.line_total) - Number(i.tax_amount), 0)
  const vat = items.reduce((s, i) => s + Number(i.tax_amount), 0)
  const qr = sale.etims_status === 'submitted' || sale.etims_cu_number ? etimsQrDataUrl(sale.etims_qr_payload) : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/sales/${id}`} className="text-sm text-muted hover:text-offwhite">
          &larr; Back to sale
        </Link>
        <div className="flex gap-2">
          <Button onClick={() => window.print()}>Print invoice</Button>
        </div>
      </div>

      {/* the sheet */}
      <div className="invoice-sheet mx-auto w-full max-w-3xl rounded-lg bg-white p-8 font-sans text-[12px] leading-snug text-black shadow print:shadow-none">
        <div className="flex flex-wrap justify-between gap-6 border-b-2 border-black pb-4">
          <div>
            <div className="text-xl font-extrabold uppercase tracking-wide">{tenant?.name}</div>
            {branch?.name && <div>{branch.name}</div>}
            <div className="mt-1 text-gray-700">
              {branch?.address || tenant?.address || ''}
              {(branch?.address || tenant?.address) && (tenant?.town || '') ? ', ' : ''}
              {tenant?.town || ''}
            </div>
            {(branch?.phone || tenant?.phone) && <div>Tel: {branch?.phone || tenant?.phone}</div>}
            {tenant?.kra_pin && <div className="mt-1 font-semibold">KRA PIN: {tenant.kra_pin}</div>}
          </div>
          <div className="text-right">
            <div className="text-2xl font-black uppercase tracking-widest">Tax Invoice</div>
            <div className="mt-1">
              <div className="flex justify-end gap-2"><span className="text-gray-600">Invoice No</span><b>{sale.receipt_no}</b></div>
              <div className="flex justify-end gap-2"><span className="text-gray-600">Date</span><b>{sold.toLocaleDateString('en-KE', { day: '2-digit', month: 'long', year: 'numeric' })}</b></div>
              <div className="flex justify-end gap-2"><span className="text-gray-600">Terms</span><b>{terms > 0 ? `Net ${terms} days` : 'Cash / immediate'}</b></div>
              {dueDate && <div className="flex justify-end gap-2"><span className="text-gray-600">Due</span><b>{dueDate.toLocaleDateString('en-KE')}</b></div>}
            </div>
          </div>
        </div>

        {/* bill to */}
        <div className="mt-4 flex flex-wrap justify-between gap-6 border-b border-gray-300 pb-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Bill to</div>
            <div className="mt-0.5 font-semibold">{customer?.name ?? 'Walk-in customer'}</div>
            {customer?.phone && <div>{customer.phone}</div>}
          </div>
          {cashier && <div className="text-right"><div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Served by</div><div className="font-semibold">{cashier}</div></div>}
        </div>

        {/* lines */}
        <table className="mt-4 w-full border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-black text-[10px] uppercase tracking-wider">
              <th className="py-2 pr-2">#</th>
              <th className="py-2 pr-2">Description</th>
              <th className="py-2 pr-2">HS Code</th>
              <th className="py-2 pr-2 text-right">Qty</th>
              <th className="py-2 pr-2 text-right">Unit price</th>
              <th className="py-2 pr-2 text-right">VAT</th>
              <th className="py-2 text-right">Line total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, n) => (
              <tr key={i.id} className="border-b border-gray-200 align-top">
                <td className="py-1.5 pr-2 text-gray-500">{n + 1}</td>
                <td className="py-1.5 pr-2">
                  <div className="font-medium">{i.product_name}</div>
                  <div className="text-[10px] text-gray-500">{i.sku}{Number(i.returned_qty) > 0 ? ` · returned ${i.returned_qty}` : ''}</div>
                </td>
                <td className="py-1.5 pr-2 text-gray-600">{hsCodes[i.product_id] ?? '—'}</td>
                <td className="py-1.5 pr-2 text-right">{Number(i.quantity)}</td>
                <td className="py-1.5 pr-2 text-right">{money(i.unit_price)}</td>
                <td className="py-1.5 pr-2 text-right">{TAX_LABEL[i.tax_category] ?? '16%'}</td>
                <td className="py-1.5 text-right">{money(i.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* totals + etims */}
        <div className="mt-4 flex flex-wrap justify-between gap-6">
          <div className="max-w-[16rem] text-[10px] text-gray-600">
            {sale.etims_cu_number && (
              <div className="space-y-0.5">
                <div className="text-[10px] font-bold uppercase tracking-widest">KRA eTIMS</div>
                <div>CU Invoice No: <b className="break-all">{sale.etims_cu_number}</b></div>
                {sale.etims_internal_data && <div className="break-all">Internal Data: {sale.etims_internal_data}</div>}
                {sale.etims_receipt_signature && <div className="break-all">Signature: {sale.etims_receipt_signature}</div>}
                {qr && <img src={qr} alt="KRA eTIMS QR code" className="mt-1 h-24 w-24" />}
              </div>
            )}
          </div>
          <div className="ml-auto w-64 text-[12px]">
            <div className="flex justify-between border-b border-gray-200 py-1"><span className="text-gray-600">Subtotal (excl. VAT)</span><span>{money(taxable)}</span></div>
            <div className="flex justify-between border-b border-gray-200 py-1"><span className="text-gray-600">VAT</span><span>{money(vat)}</span></div>
            <div className="flex justify-between border-b-2 border-black py-1.5 text-sm font-extrabold"><span>TOTAL (KES)</span><span>{money(sale.total)}</span></div>
            <div className="flex justify-between py-1"><span className="text-gray-600">Amount paid</span><span>{money(paid)}</span></div>
            <div className="flex justify-between py-1 font-bold"><span>Balance due</span><span>{money(due)}</span></div>
          </div>
        </div>

        <div className="mt-6 border-t border-gray-300 pt-3 text-[10px] text-gray-600">
          {tenant?.receipt_footer || 'Thank you for your business.'} · Goods once sold are exchangeable within 7 days with this invoice.
          <div className="mt-1 text-right text-gray-400">Powered by NafPOS</div>
        </div>
      </div>
    </div>
  )
}
