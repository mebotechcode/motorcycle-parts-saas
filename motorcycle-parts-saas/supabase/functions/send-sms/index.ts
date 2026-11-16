// =====================================================================
// Edge Function: send-sms  (debt reminders through Africa's Talking)
// Only the owner/manager of a shop on a plan with SMS can use it.
// The message may contain {name}, {amount} and {shop}.
//
// Secrets (set with `npx supabase secrets set ...`):
//   AT_USERNAME, AT_API_KEY, AT_SENDER_ID (optional), AT_SANDBOX ("true" to test without real SMS)
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// 0712 345 678 / 254712345678 / +254712345678 -> +254712345678
function normalizePhone(raw: string | null): string | null {
  if (!raw) return null
  const d = raw.replace(/[^\d]/g, '')
  if (/^0[17]\d{8}$/.test(d)) return '+254' + d.slice(1)
  if (/^254[17]\d{8}$/.test(d)) return '+' + d
  if (/^[17]\d{8}$/.test(d)) return '+254' + d
  return null
}

const fill = (tpl: string, v: Record<string, string>) => tpl.replace(/\{(name|amount|shop)\}/g, (_, k) => v[k] ?? '')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Please sign in first' }, 401)
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })

    // who is asking, and is SMS part of their plan?
    const { data: allowed, error: aerr } = await supabase.rpc('sms_allowed')
    if (aerr) return json({ error: aerr.message }, 401)
    if (!allowed?.role_ok) return json({ error: 'Only the owner or a manager can send reminders' }, 403)
    if (!allowed?.plan_ok) return json({ error: 'SMS reminders are included in the Growth and Chain plans' }, 403)

    const username = Deno.env.get('AT_USERNAME')
    const apiKey = Deno.env.get('AT_API_KEY')
    if (!username || !apiKey) return json({ error: 'SMS is not set up yet (missing Africa\'s Talking details).' }, 400)
    const sender = Deno.env.get('AT_SENDER_ID') || ''
    const sandbox = Deno.env.get('AT_SANDBOX') === 'true'
    const endpoint = sandbox
      ? 'https://api.sandbox.africastalking.com/version1/messaging'
      : 'https://api.africastalking.com/version1/messaging'

    const body = await req.json()
    const ids: string[] = Array.isArray(body.customer_ids) ? body.customer_ids.slice(0, 100) : []
    const template = String(body.message ?? '').trim()
    if (ids.length === 0) return json({ error: 'Choose at least one customer' }, 400)
    if (template.length < 5) return json({ error: 'The message is too short' }, 400)
    if (template.length > 320) return json({ error: 'The message is too long (320 characters at most)' }, 400)

    // the customers (the database only returns the ones this user may see)
    const { data: customers, error: cerr } = await supabase
      .from('customer_overview')
      .select('id,name,phone,balance')
      .in('id', ids)
    if (cerr) return json({ error: cerr.message }, 400)

    const results: { customer_id: string; name: string; status: 'sent' | 'failed' | 'skipped'; error?: string }[] = []
    let sent = 0

    for (const c of customers ?? []) {
      const phone = normalizePhone(c.phone)
      if (!phone) {
        results.push({ customer_id: c.id, name: c.name, status: 'skipped', error: 'No valid phone number' })
        continue
      }
      if (Number(c.balance) <= 0) {
        results.push({ customer_id: c.id, name: c.name, status: 'skipped', error: 'Owes nothing' })
        continue
      }
      const text = fill(template, {
        name: String(c.name).split(' ')[0],
        amount: Number(c.balance).toLocaleString('en-KE', { maximumFractionDigits: 0 }),
        shop: allowed.shop ?? '',
      })

      let status: 'sent' | 'failed' = 'failed'
      let err = ''
      let messageId = ''
      try {
        const form = new URLSearchParams({ username, to: phone, message: text })
        if (sender) form.set('from', sender)
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form,
        })
        const raw = await res.text()
        let j: any = null
        try { j = JSON.parse(raw) } catch (_) {}
        const rec = j?.SMSMessageData?.Recipients?.[0]
        if (res.ok && rec && /success|sent|queued/i.test(String(rec.status))) {
          status = 'sent'
          messageId = rec.messageId ?? ''
        } else {
          err = rec?.status || j?.SMSMessageData?.Message || raw.slice(0, 160)
        }
      } catch (e) {
        err = String((e as Error).message ?? e)
      }

      // keep a record (the database checks the user may do this)
      await supabase.from('sms_messages').insert({
        customer_id: c.id,
        to_phone: phone,
        body: text,
        template: 'debt_reminder',
        status,
        provider_message_id: messageId || null,
        error: err || null,
        sent_at: status === 'sent' ? new Date().toISOString() : null,
      })

      if (status === 'sent') sent++
      results.push({ customer_id: c.id, name: c.name, status, error: err || undefined })
    }

    return json({ sent, failed: results.filter((r) => r.status === 'failed').length, results })
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500)
  }
})
