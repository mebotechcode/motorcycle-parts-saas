// =====================================================================
// Edge Function: etims-submit
// Processes the eTIMS offline queue in chronological (oldest first) order.
// Called by:
//   - the app after a sale is queued      (POST { sale_id })
//   - the app on reconnect / "Transmit now" / dashboard nudge (POST {} or { transmit_all: true })
//
// Readiness mode: until ETIMS_BASE_URL is set, each queued sale gets a
// STUB CU number (CU-<receipt>-<attempt>) so receipts show a QR and the
// whole queue/retry pipeline works. Point ETIMS_BASE_URL at your
// VSCU/OSCU when KRA is live — the payload shape stays the same.
//
// Safety:
//   - caller must belong to a tenant (tenant_members_select_self)
//   - each row is CLAIMED (status → 'sending', guarded on status) before
//     transmission, so two overlapping invocations never double-submit
//   - 'failed' rows are retried only when next_retry_at has passed
//   - rows stuck in 'sending' for >10 minutes are reclaimed automatically
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

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

    const body = await req.json().catch(() => ({}))
    const singleSale = typeof body.sale_id === 'string' ? body.sale_id : undefined

    // Tenant from the CALLER's membership (RLS self-select policy)
    const { data: member } = await supabase
      .from('tenant_members')
      .select('tenant_id, role')
      .eq('user_id', userData.user.id)
      .eq('status', 'active')
      .maybeSingle()
    if (!member) return json({ error: 'You do not belong to a business' }, 403)
    const tenantId = member.tenant_id

    const nowIso = new Date().toISOString()
    const staleIso = new Date(Date.now() - 10 * 60000).toISOString()

    // Reclaim rows stuck in 'sending' (crashed invocation) — safe: only
    // rows we could not prove either side of the wire get retried.
    await service.from('etims_queue')
      .update({ status: 'queued', last_error: 'Reclaimed after a crashed transmission' })
      .eq('tenant_id', tenantId)
      .eq('status', 'sending')
      .lt('updated_at', staleIso)

    let query = service.from('etims_queue').select('*').eq('tenant_id', tenantId)
      .in('status', ['queued', 'failed'])
      .lte('next_retry_at', nowIso)
      .order('created_at', { ascending: true })
      .limit(50)
    if (singleSale) query = query.eq('sale_id', singleSale)

    const { data: queue } = await query
    if (!queue?.length) return json({ ok: true, processed: 0, submitted: 0, failed: 0, message: 'Nothing waiting to transmit.' })

    const etimsBase = Deno.env.get('ETIMS_BASE_URL')
    const deviceSerial = Deno.env.get('ETIMS_DEVICE_SERIAL') || ''

    let processed = 0
    let submitted = 0
    let failed = 0
    let skipped = 0

    for (const q of queue) {
      // ── claim the row: only if it is still queued/failed. If another
      // invocation got here first, this update matches 0 rows and we skip.
      const { data: claimed } = await service
        .from('etims_queue')
        .update({ status: 'sending', updated_at: nowIso })
        .eq('id', q.id)
        .in('status', ['queued', 'failed'])
        .select('id')
      if (!claimed?.length) {
        skipped++
        continue
      }
      processed++

      const { data: sale } = await service.from('sales').select('*').eq('id', q.sale_id).maybeSingle()
      if (!sale) {
        await service.from('etims_queue').update({ status: 'cancelled', last_error: 'Sale no longer exists' }).eq('id', q.id)
        continue
      }
      const { data: items } = await service.from('sale_items').select('*').eq('sale_id', q.sale_id)
      const { data: tenant } = await service.from('tenants').select('kra_pin, etims_device_serial, etims_vscu_serial, etims_branch_code').eq('id', tenantId).maybeSingle()

      const payload = {
        tin: tenant?.kra_pin ?? '',
        deviceSerialNumber: tenant?.etims_device_serial || deviceSerial,
        vscuSerialNumber: tenant?.etims_vscu_serial ?? '',
        branchCode: tenant?.etims_branch_code ?? '00',
        invoiceNumber: sale.receipt_no,
        invoiceDate: sale.sold_at,
        items: (items ?? []).map((i: any) => ({
          itemCode: i.sku,
          itemDesc: i.product_name,
          quantity: Number(i.quantity),
          unitPrice: Number(i.unit_price),
          totalAmount: Number(i.line_total),
          taxCode: i.tax_category === 'standard' ? 'A' : i.tax_category === 'zero_rated' ? 'B' : 'C',
          taxRate: Number(i.tax_rate ?? 0),
          taxAmount: Number(i.tax_amount ?? 0),
        })),
        totalAmount: Number(sale.total),
        taxAmount: Number(sale.tax_total ?? 0),
        discountAmount: Number(sale.discount_total ?? 0),
      }

      try {
        let cuNumber: string | null = null
        let signature: string | null = null
        let internalData: string | null = null
        let qrPayload: string | null = null

        if (etimsBase) {
          // LIVE: submit to VSCU/OSCU (sign with KRA cert in production)
          const res = await fetch(`${etimsBase}/submitInvoice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          const j = await res.json().catch(() => ({}))
          if (!res.ok || (j?.status !== 'success' && !j?.cuNumber)) {
            throw new Error(j?.message || `eTIMS rejected (${res.status})`)
          }
          cuNumber = j.cuNumber ?? j.invoiceNumber ?? null
          signature = j.receiptSignature ?? null
          internalData = j.internalData ?? null
          qrPayload = j.qrCode ?? (cuNumber ? `${tenant?.kra_pin}|${cuNumber}|${sale.receipt_no}|${sale.total}` : null)
        } else {
          // STUB (no VSCU configured): generate a local CU-style number so
          // receipts show a QR and the queue drains. Replace with live
          // submission before claiming KRA compliance.
          cuNumber = `CU-${sale.receipt_no}-${String(q.attempts + 1).padStart(2, '0')}`
          signature = `STUB-${btoa(sale.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 16)}`
          internalData = btoa(JSON.stringify(payload)).slice(0, 64)
          qrPayload = `${tenant?.kra_pin ?? 'PIN'}|${cuNumber}|${sale.receipt_no}|${sale.total}|${sale.sold_at}`
        }

        await service.from('etims_queue').update({ status: 'submitted', attempts: q.attempts + 1, cu_number: cuNumber, last_error: null }).eq('id', q.id)
        await service.from('sales').update({
          etims_status: 'submitted',
          etims_cu_number: cuNumber,
          etims_invoice_no: cuNumber,
          etims_receipt_signature: signature,
          etims_internal_data: internalData,
          etims_qr_payload: qrPayload,
          etims_qr_url: qrPayload,
          etims_submitted_at: new Date().toISOString(),
          etims_error: null,
          etims_attempts: (sale.etims_attempts ?? 0) + 1,
        }).eq('id', q.sale_id)
        submitted++
      } catch (e) {
        const msg = String((e as Error).message ?? e)
        const delayMin = Math.min(60, 5 * (q.attempts + 1))
        const next = new Date(Date.now() + delayMin * 60000).toISOString()
        await service.from('etims_queue').update({ status: 'failed', attempts: q.attempts + 1, next_retry_at: next, last_error: msg }).eq('id', q.id)
        await service.from('sales').update({ etims_status: 'failed', etims_error: msg, etims_next_retry_at: next, etims_attempts: (sale.etims_attempts ?? 0) + 1 }).eq('id', q.sale_id)
        failed++
      }
    }

    return json({ ok: true, processed, submitted, failed, skipped })
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500)
  }
})
