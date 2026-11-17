// =====================================================================
// Edge Function: mpesa-stk-push
// Sends a Daraja STK Push to the customer's phone for a POS sale OR a
// subscription billing invoice. The callback URL must be publicly
// reachable (your Supabase project URL + /functions/v1/mpesa-callback).
//
// Body (POS):   { phone, amount, branch_id?, sale_id?, customer_id?, account_reference? }
// Body (billing): { phone, amount, invoice_id, purpose: "subscription" }
//
// Secrets: MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE,
//          MPESA_PASSKEY, MPESA_ENV (sandbox|production), MPESA_CALLBACK_URL
//          (optional — defaults to SUPABASE_URL/functions/v1/mpesa-callback)
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const d = raw.replace(/[^\d]/g, '')
  if (/^0[17]\d{8}$/.test(d)) return '254' + d.slice(1)
  if (/^254[17]\d{8}$/.test(d)) return d
  if (/^[17]\d{8}$/.test(d)) return '254' + d
  return null
}

async function darajaToken(env: string): Promise<string> {
  const key = Deno.env.get('MPESA_CONSUMER_KEY')
  const secret = Deno.env.get('MPESA_CONSUMER_SECRET')
  if (!key || !secret) throw new Error('M-Pesa is not set up yet (missing Daraja credentials).')
  const base = env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'
  const res = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: 'Basic ' + btoa(`${key}:${secret}`) },
  })
  if (!res.ok) throw new Error(`Daraja auth failed (${res.status})`)
  const j = await res.json()
  if (!j.access_token) throw new Error('Daraja auth failed')
  return j.access_token
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Please sign in first' }, 401)
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) return json({ error: 'Please sign in first' }, 401)

    const body = await req.json()
    const phone = normalizePhone(body.phone)
    let amount = Math.round(Number(body.amount ?? 0))
    if (!phone) return json({ error: 'Enter a valid Kenyan phone number (e.g. 0712 345 678)' }, 400)

    const purpose = body.purpose === 'subscription' ? 'subscription' : 'pos'
    const env = Deno.env.get('MPESA_ENV') || 'sandbox'
    const shortcode = Deno.env.get('MPESA_SHORTCODE') || '174379'
    const passkey = Deno.env.get('MPESA_PASSKEY') || 'bfb2797f8470b6f99c4e9d4e8b6a5c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1'
    const callbackBase = Deno.env.get('MPESA_CALLBACK_URL') || `${Deno.env.get('SUPABASE_URL')}/functions/v1/mpesa-callback`

    // Resolve tenant + validate the sale/invoice belongs to them
    const { data: member } = await supabase.from('tenant_members').select('tenant_id, role').eq('user_id', userData.user.id).eq('status', 'active').maybeSingle()
    if (!member) return json({ error: 'You do not belong to a business' }, 403)
    const tenantId = member.tenant_id

    if (purpose === 'pos') {
      if (!['owner', 'manager', 'cashier'].includes(member.role)) return json({ error: 'You are not allowed to take M-Pesa payments' }, 403)
      if (!amount || amount <= 0) return json({ error: 'Enter an amount more than zero' }, 400)
      if (body.sale_id) {
        // service role + explicit tenant check (works for every branch's staff)
        const { data: sale } = await service.from('sales').select('id, tenant_id').eq('id', body.sale_id).maybeSingle()
        if (!sale || sale.tenant_id !== tenantId) return json({ error: 'Sale not found' }, 404)
      }
    } else {
      if (!['owner', 'manager'].includes(member.role)) return json({ error: 'Only the owner or a manager can pay the subscription' }, 403)
      if (!body.invoice_id) return json({ error: 'The invoice to pay is missing. Open Billing and tap Pay.' }, 400)
      // The invoice is the source of truth for the amount — never the client.
      const { data: inv } = await service
        .from('subscription_invoices')
        .select('id, tenant_id, status, amount')
        .eq('id', body.invoice_id)
        .maybeSingle()
      if (!inv || inv.tenant_id !== tenantId) return json({ error: 'Invoice not found' }, 404)
      if (inv.status !== 'open') return json({ error: 'That invoice is already paid or no longer open.' }, 400)
      amount = Math.round(Number(inv.amount))
    }

    const token = await darajaToken(env)
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)
    const password = btoa(shortcode + passkey + timestamp)
    const accountRef = String(body.account_reference || body.invoice_id || body.sale_id || tenantId).slice(0, 12).toUpperCase()

    const base = env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'
    const stkRes = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: amount,
        PartyA: phone,
        PartyB: shortcode,
        PhoneNumber: phone,
        CallBackURL: `${callbackBase}/stk`,
        AccountReference: accountRef,
        TransactionDesc: purpose === 'subscription' ? 'NafPOS subscription' : 'NafPOS sale',
      }),
    })
    const stk = await stkRes.json().catch(() => ({}))
    if (!stkRes.ok || !stk.CheckoutRequestID) {
      return json({ error: stk.errorMessage || stk.ResponseDescription || 'M-Pesa did not accept the request. Try again.' }, 502)
    }

    // Record the pending transaction (service role — table is Edge-Function-only)
    if (purpose === 'pos') {
      await service.from('mpesa_transactions').insert({
        tenant_id: tenantId,
        branch_id: body.branch_id || null,
        kind: 'stk_push',
        status: 'pending',
        shortcode,
        phone,
        amount,
        account_reference: accountRef,
        merchant_request_id: stk.MerchantRequestID || null,
        checkout_request_id: stk.CheckoutRequestID,
        sale_id: body.sale_id || null,
        customer_id: body.customer_id || null,
        initiated_by: userData.user.id,
        raw_payload: stk,
      })
    } else {
      await service.from('subscription_payments').insert({
        tenant_id: tenantId,
        invoice_id: body.invoice_id || null,
        phone,
        amount,
        merchant_request_id: stk.MerchantRequestID || null,
        checkout_request_id: stk.CheckoutRequestID,
        status: 'pending',
        raw_payload: stk,
      })
    }

    return json({ ok: true, checkout_request_id: stk.CheckoutRequestID, merchant_request_id: stk.MerchantRequestID, customer_message: stk.CustomerMessage || 'STK push sent. Ask the customer to enter their M-Pesa PIN.' })
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500)
  }
})
