// =====================================================================
// Edge Function: mpesa-callback
// Receives Daraja callbacks (no login required — Safaricom calls this URL):
//   POST /stk  — STK Push result (success / cancelled / timeout)
//   POST /c2b  — Till / Paybill confirmation (customer paid the Till directly)
//
// C2B matching: BillRefNumber is matched against open POS carts via
// mpesa_transactions.account_reference, then against sales receipt_no,
// then left as an unmatched payment for end-of-day reconciliation.
// Safaricom retries callbacks, so every write is idempotent on
// checkout_request_id / mpesa_receipt (unique indexes enforce this).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  try {
    const body = await req.json().catch(() => ({}))

    // ---------------- STK Push result ----------------
    if (url.pathname.endsWith('/stk')) {
      const cb = body?.Body?.stkCallback ?? body
      const checkoutId = cb.CheckoutRequestID
      const merchantId = cb.MerchantRequestID
      const resultCode = cb.ResultCode
      const resultDesc = cb.ResultDesc
      const receipt = cb.CallbackMetadata?.Item?.find((i: any) => i.Name === 'MpesaReceiptNumber')?.Value ?? null

      if (checkoutId) {
        // POS transaction?
        const { data: tx } = await service.from('mpesa_transactions').select('*').eq('checkout_request_id', checkoutId).maybeSingle()
        if (tx) {
          const success = resultCode === 0
          await service.from('mpesa_transactions').update({
            status: success ? 'success' : resultCode === 1032 ? 'cancelled' : resultCode === 1037 ? 'timeout' : 'failed',
            mpesa_receipt: receipt,
            result_code: resultCode,
            result_desc: resultDesc,
            raw_payload: body,
            updated_at: new Date().toISOString(),
          }).eq('id', tx.id)

          if (success && receipt) {
            // Auto-create the payment row so the sale shows as paid.
            // Duplicate codes are impossible: payments_mpesa_reference_unique.
            await service.from('payments').insert({
              tenant_id: tx.tenant_id,
              branch_id: tx.branch_id || (await service.from('sales').select('branch_id').eq('id', tx.sale_id).maybeSingle()).data?.branch_id,
              kind: 'sale_payment',
              sale_id: tx.sale_id,
              customer_id: tx.customer_id,
              method: 'mpesa',
              amount: tx.amount,
              reference: receipt,
              mpesa_transaction_id: tx.id,
              is_verified: true,
              verified_at: new Date().toISOString(),
              note: 'STK Push (auto-matched)',
            }).then(() => {}).catch(() => {}) // already recorded -> ignore
          }
          return json({ ResultCode: 0, ResultDesc: 'Accepted' })
        }

        // Subscription payment?
        const { data: sub } = await service.from('subscription_payments').select('*').eq('checkout_request_id', checkoutId).maybeSingle()
        if (sub) {
          const success = resultCode === 0
          await service.from('subscription_payments').update({
            status: success ? 'success' : resultCode === 1032 ? 'cancelled' : 'failed',
            mpesa_receipt: receipt,
            result_code: resultCode,
            result_desc: resultDesc,
            raw_payload: body,
            updated_at: new Date().toISOString(),
          }).eq('id', sub.id)
          if (success) {
            const now = new Date()
            if (sub.invoice_id) {
              // Paid invoice: mark it paid, switch the tenant to the
              // invoiced plan and extend the subscription to the invoice's
              // period end (cancelled grace no longer applies).
              const { data: inv } = await service
                .from('subscription_invoices')
                .update({ status: 'paid', paid_at: now.toISOString() })
                .eq('id', sub.invoice_id)
                .select('period_end, plan_id')
                .maybeSingle()
              await service.from('subscriptions').update({
                status: 'active',
                grace_ends_at: null,
                plan_id: inv?.plan_id ?? undefined,
                current_period_start: now.toISOString(),
                current_period_end: inv?.period_end ? new Date(inv.period_end).toISOString() : new Date(now.getTime() + 30 * 86400 * 1000).toISOString(),
              }).eq('tenant_id', sub.tenant_id)
            }
            // No invoice attached: the money is recorded as received above,
            // but access is never unlocked here — activation requires a paid
            // invoice (see mpesa-stk-push, which always creates one).
          }
          return json({ ResultCode: 0, ResultDesc: 'Accepted' })
        }
      }
      return json({ ResultCode: 0, ResultDesc: 'Accepted' })
    }

    // ---------------- C2B Till / Paybill confirmation ----------------
    // Daraja sends: TransID, TransTime, TransAmount, BillRefNumber, MSISDN, ...
    const transId = body.TransID
    const billRef = (body.BillRefNumber || '').toUpperCase()
    const amount = Number(body.TransAmount ?? 0)
    const msisdn = body.MSISDN ? String(body.MSISDN) : null
    const shortcode = body.BusinessShortCode ? String(body.BusinessShortCode) : null

    if (transId && amount > 0) {
      // Route to tenant by shortcode
      let tenantId: string | null = null
      let branchId: string | null = null
      if (shortcode) {
        const { data: acct } = await service.from('tenant_mpesa_accounts').select('tenant_id, branch_id').eq('shortcode', shortcode).eq('is_active', true).maybeSingle()
        tenantId = acct?.tenant_id ?? null
        branchId = acct?.branch_id ?? null
      }
      // Fallback: match an open STK cart by account_reference
      let tx: any = null
      if (billRef) {
        const { data } = await service.from('mpesa_transactions').select('*').eq('account_reference', billRef).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle()
        tx = data
        if (tx && !tenantId) tenantId = tx.tenant_id
      }
      // Fallback: match a sale by receipt number
      let sale: any = null
      if (!tx && billRef) {
        const { data } = await service.from('sales').select('id, tenant_id, branch_id').eq('receipt_no', billRef).maybeSingle()
        sale = data
        if (sale && !tenantId) tenantId = sale.tenant_id
      }

      if (tenantId) {
        // Idempotent: mpesa_receipt_unique blocks Safaricom retries
        const { error } = await service.from('mpesa_transactions').insert({
          tenant_id: tenantId,
          branch_id: branchId || sale?.branch_id || tx?.branch_id || null,
          kind: 'c2b',
          status: 'success',
          shortcode,
          phone: msisdn,
          amount,
          account_reference: billRef || null,
          mpesa_receipt: transId,
          sale_id: sale?.id || tx?.sale_id || null,
          customer_id: tx?.customer_id || null,
          transaction_time: body.TransTime ? new Date(String(body.TransTime).replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6Z')).toISOString() : new Date().toISOString(),
          matched_at: sale || tx ? new Date().toISOString() : null,
          raw_payload: body,
        })
        if (!error && (sale || tx)) {
          // Auto-match: record the payment against the sale (verified — it came from Safaricom)
          const saleId = sale?.id || tx?.sale_id
          if (saleId) {
            await service.from('payments').insert({
              tenant_id: tenantId,
              branch_id: branchId || sale?.branch_id || tx?.branch_id,
              kind: 'sale_payment',
              sale_id: saleId,
              customer_id: tx?.customer_id || null,
              method: 'mpesa',
              amount,
              reference: transId,
              is_verified: true,
              verified_at: new Date().toISOString(),
              note: 'C2B Till/Paybill (auto-matched)',
            }).catch(() => {})
          }
        }
      }
    }

    return json({ ResultCode: 0, ResultDesc: 'Accepted' })
  } catch (e) {
    // Always accept so Safaricom does not retry forever; log for debugging
    console.error('mpesa-callback error', e)
    return json({ ResultCode: 0, ResultDesc: 'Accepted' })
  }
})
