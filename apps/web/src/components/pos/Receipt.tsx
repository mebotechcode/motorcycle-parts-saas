import { PAY_LABEL, money } from '@/lib/pos'
import { etimsQrPayload, etimsQrUrl } from '@/lib/etims'

// A paper-style receipt. White background so it prints and screenshots cleanly.
// Shows the KRA eTIMS QR code (CU number + signature) when available, and
// works for 58mm / 80mm thermal printers via browser print.
export default function Receipt({
  sale,
  items,
  payments,
  tenant,
  branch,
  customer,
  cashier,
  returns = [],
}: {
  sale: any
  items: any[]
  payments: any[]
  tenant: any
  branch: any
  customer?: any
  cashier?: string
  returns?: any[]
}) {
  const voided = sale.status === 'voided'
  const vat = Number(sale.tax_total) > 0
  const qrPayload = etimsQrPayload(sale, tenant)
  const qrUrl = etimsQrUrl(qrPayload)
  const showQr = !voided && (sale.etims_status === 'submitted' || sale.etims_cu_number || tenant?.kra_pin)
  return (
    <div id="receipt" className="mx-auto w-full max-w-sm rounded-lg bg-white p-5 font-mono text-[13px] leading-snug text-black print:max-w-none print:rounded-none print:p-0">
      <div className="text-center">
        <div className="text-lg font-bold uppercase">{tenant?.name}</div>
        {branch?.name && <div>{branch.name}</div>}
        {(tenant?.address || tenant?.town) && <div>{[tenant.address, tenant.town].filter(Boolean).join(', ')}</div>}
        {(branch?.phone || tenant?.phone) && <div>Tel: {branch?.phone || tenant?.phone}</div>}
        {tenant?.kra_pin && <div>PIN: {tenant.kra_pin}</div>}
      </div>

      <div className="my-3 border-y border-dashed border-black py-2">
        <div className="flex justify-between">
          <span>Receipt</span>
          <b>{sale.receipt_no}</b>
        </div>
        <div className="flex justify-between">
          <span>Date</span>
          <span>{new Date(sale.sold_at).toLocaleString('en-KE')}</span>
        </div>
        {cashier && (
          <div className="flex justify-between">
            <span>Served by</span>
            <span>{cashier}</span>
          </div>
        )}
        {customer && (
          <div className="flex justify-between">
            <span>Customer</span>
            <span>{customer.name}</span>
          </div>
        )}
        {sale.etims_cu_number && (
          <div className="flex justify-between">
            <span>CU Invoice No</span>
            <b>{sale.etims_cu_number}</b>
          </div>
        )}
        {sale.etims_status === 'pending' && (
          <div className="flex justify-between text-[12px]">
            <span>eTIMS</span>
            <span>Queued (will transmit when online)</span>
          </div>
        )}
      </div>

      {voided && (
        <div className="my-2 border-2 border-black p-1 text-center font-bold">
          CANCELLED{sale.void_reason ? ` - ${sale.void_reason}` : ''}
        </div>
      )}

      <div className="space-y-1">
        {items.map((i) => (
          <div key={i.id}>
            <div className="flex justify-between gap-2">
              <span className="min-w-0 flex-1 break-words">{i.product_name}</span>
              <span>{money(i.line_total)}</span>
            </div>
            <div className="pl-2 text-[12px] text-gray-700">
              {Number(i.quantity)} x {money(i.unit_price)}
              {Number(i.discount_amount) > 0 && <> (discount {money(i.discount_amount)})</>}
              {Number(i.returned_qty) > 0 && <> · returned {Number(i.returned_qty)}</>}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-0.5 border-t border-dashed border-black pt-2">
        {Number(sale.discount_total) > 0 && (
          <>
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{money(sale.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Bill discount</span>
              <span>-{money(sale.discount_total)}</span>
            </div>
          </>
        )}
        <div className="flex justify-between text-base font-bold">
          <span>TOTAL (KES)</span>
          <span>{money(sale.total)}</span>
        </div>
        {vat && (
          <div className="flex justify-between text-[12px]">
            <span>VAT included</span>
            <span>{money(sale.tax_total)}</span>
          </div>
        )}
      </div>

      {payments.length > 0 && (
        <div className="mt-2 space-y-0.5 border-t border-dashed border-black pt-2">
          {payments.map((p) => (
            <div key={p.id} className="flex justify-between">
              <span>
                {PAY_LABEL[p.method] ?? p.method}
                {p.reference ? ` (${p.reference})` : ''}
              </span>
              <span>{money(p.amount)}</span>
            </div>
          ))}
        </div>
      )}
      {Number(sale.balance_due) > 0 && !voided && (
        <div className="mt-1 flex justify-between font-bold">
          <span>Balance on account</span>
          <span>{money(sale.balance_due)}</span>
        </div>
      )}

      {returns.length > 0 && (
        <div className="mt-2 border-t border-dashed border-black pt-2 text-[12px]">
          {returns.map((r) => (
            <div key={r.id} className="flex justify-between">
              <span>Return {r.return_no}</span>
              <span>-{money(r.total_refund)}</span>
            </div>
          ))}
        </div>
      )}

      {showQr && qrUrl && (
        <div className="mt-3 border-t border-dashed border-black pt-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrUrl} alt="KRA eTIMS QR code" className="mx-auto h-28 w-28" />
          <div className="mt-1 text-[11px]">Scan to verify with KRA</div>
          {sale.etims_receipt_signature && <div className="mt-1 break-all text-[10px]">Signature: {sale.etims_receipt_signature}</div>}
          {sale.etims_internal_data && <div className="break-all text-[10px]">Internal Data: {sale.etims_internal_data}</div>}
        </div>
      )}

      <div className="mt-4 text-center text-[12px]">{tenant?.receipt_footer || 'Thank you for shopping with us!'}</div>
      <div className="mt-1 text-center text-[10px] text-gray-600">Powered by NafPOS</div>
    </div>
  )
}
