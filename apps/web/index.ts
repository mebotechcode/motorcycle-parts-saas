// =====================================================================
// Edge Function: send-invite
// 1. Creates the staff invite AS THE LOGGED-IN USER (the database itself checks
//    that they are the owner, plan limits, branches...).
// 2. Emails the invite link through Brevo.
// If email is not configured, it still returns the link so the owner can share it.
//
// Secrets (set with `npx supabase secrets set ...`):
//   BREVO_API_KEY, MAIL_FROM_EMAIL (a sender verified in Brevo),
//   MAIL_FROM_NAME (optional), APP_URL (your website address)
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const ROLE: Record<string, string> = {
  manager: 'Manager',
  cashier: 'Cashier',
  storekeeper: 'Storekeeper',
  owner: 'Owner',
}

function emailHtml(opts: { business: string; inviter: string; role: string; link: string }) {
  const { business, inviter, role, link } = opts
  return `<!doctype html>
<html><body style="margin:0;background:#f4f4f2;font-family:Arial,Helvetica,sans-serif;color:#111214">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden">
        <tr><td style="background:#111214;padding:20px 24px">
          <div style="font-size:22px;font-weight:bold;letter-spacing:1px;color:#F5F5F2">NAF'S <span style="color:#FF5B14">MOTOR SPARES</span></div>
        </td></tr>
        <tr><td style="padding:24px">
          <h1 style="margin:0 0 12px;font-size:20px">You're invited to join ${esc(business)}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.5">
            ${esc(inviter)} has invited you to join <b>${esc(business)}</b> as <b>${esc(role)}</b>.
          </p>
          <p style="margin:0 0 24px">
            <a href="${esc(link)}" style="display:inline-block;background:#FF5B14;color:#111214;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px">Accept invitation</a>
          </p>
          <p style="margin:0 0 8px;font-size:13px;color:#555">
            Create your account with <b>this same email address</b>. The link works for 7 days.
          </p>
          <p style="margin:0;font-size:12px;color:#777;word-break:break-all">
            Button not working? Copy this link into your browser:<br>${esc(link)}
          </p>
        </td></tr>
      </table>
      <p style="font-size:11px;color:#888;margin-top:12px">If you were not expecting this, you can ignore this email.</p>
    </td></tr>
  </table>
</body></html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Please sign in first' }, 401)

    // A client that acts as the caller: all permission checks happen in the database
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })

    const body = await req.json()
    const email = String(body.email ?? '').trim().toLowerCase()
    const role = String(body.role ?? '')
    const branchIds: string[] = Array.isArray(body.branch_ids) ? body.branch_ids : []

    const { data: token, error } = await supabase.rpc('invite_staff', {
      p_email: email,
      p_role: role,
      p_branch_ids: branchIds,
    })
    if (error) return json({ error: error.message }, 400)

    const appUrl = (Deno.env.get('APP_URL') || req.headers.get('origin') || '').replace(/\/+$/, '')
    const link = `${appUrl}/join?token=${token}`

    // Names for the email
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    const { data: userData } = await supabase.auth.getUser(jwt)
    const [{ data: tenant }, { data: profile }] = await Promise.all([
      supabase.from('tenants').select('name').maybeSingle(),
      supabase.from('profiles').select('full_name').eq('id', userData?.user?.id ?? '').maybeSingle(),
    ])
    const business = tenant?.name ?? 'a shop'
    const inviter = profile?.full_name || 'The shop owner'

    const key = Deno.env.get('BREVO_API_KEY')
    const fromEmail = Deno.env.get('MAIL_FROM_EMAIL')
    if (!key || !fromEmail) {
      return json({ link, emailed: false, reason: 'Email sending is not set up yet.' })
    }

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: Deno.env.get('MAIL_FROM_NAME') ?? "Naf's Motor Spares", email: fromEmail },
        to: [{ email }],
        subject: `${inviter} invited you to join ${business}`,
        htmlContent: emailHtml({ business, inviter, role: ROLE[role] ?? role, link }),
        textContent: `${inviter} invited you to join ${business} as ${ROLE[role] ?? role}.\n\nAccept here: ${link}\n\nUse this same email address to create your account. The link works for 7 days.`,
      }),
    })

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300)
      return json({ link, emailed: false, reason: `The email service refused it: ${detail}` })
    }
    return json({ link, emailed: true })
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500)
  }
})