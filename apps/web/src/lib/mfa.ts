// Super-admin TOTP only. Shop staff never see this.
import qrcode from 'qrcode-generator'
import { supabase } from './supabase'

const PENDING_KEY = 'nafpos_totp_pending_v1'

type Pending = { userId: string; factorId: string; secret: string; qr: string | null }

export function totpQrDataUrl(uri: string): string | null {
  if (!uri) return null
  try {
    const qr = qrcode(0, 'M')
    qr.addData(uri, 'Byte')
    qr.make()
    return qr.createDataURL(4, 2)
  } catch {
    return null
  }
}

function readPending(userId: string): Pending | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Pending
    if (p.userId !== userId || !p.factorId) return null
    return p
  } catch {
    return null
  }
}

function writePending(p: Pending) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(p))
  } catch {}
}

export function clearPendingTotp() {
  try {
    sessionStorage.removeItem(PENDING_KEY)
  } catch {}
}

export async function adminAal(): Promise<'aal1' | 'aal2'> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  return data?.currentLevel === 'aal2' ? 'aal2' : 'aal1'
}

export async function verifiedTotpId(): Promise<string | null> {
  const { data } = await supabase.auth.mfa.listFactors()
  const totp = data?.totp?.find((f) => f.status === 'verified')
  return totp?.id ?? null
}

let enrollInFlight: Promise<{ factorId: string; secret: string; qr: string | null; error: string }> | null = null

export async function startTotpEnroll(
  userId: string,
  opts: { fresh?: boolean } = {},
): Promise<{ factorId: string; secret: string; qr: string | null; error: string }> {
  if (!opts.fresh && enrollInFlight) return enrollInFlight
  const run = (async () => {
  const { data: listed } = await supabase.auth.mfa.listFactors()
  const totp = listed?.totp ?? []

  if (!opts.fresh) {
    const pending = readPending(userId)
    if (pending && totp.some((f) => f.id === pending.factorId && f.status !== 'verified')) {
      return { ...pending, error: '' }
    }
  }

  const stale = totp.filter((f) => f.status !== 'verified')
  await Promise.all(stale.map((f) => supabase.auth.mfa.unenroll({ factorId: f.id })))
  clearPendingTotp()

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'NafPOS operator',
  })
  if (error || !data) {
    return { factorId: '', secret: '', qr: null, error: error?.message ?? 'Could not start authenticator setup' }
  }

  const uri = data.totp.uri
  const qr = totpQrDataUrl(uri) ?? (data.totp.qr_code?.startsWith('data:') ? data.totp.qr_code : null)
  const pending: Pending = { userId, factorId: data.id, secret: data.totp.secret, qr }
  writePending(pending)
  return { ...pending, error: '' }
  })()
  enrollInFlight = run
  try {
    return await run
  } finally {
    if (enrollInFlight === run) enrollInFlight = null
  }
}

export async function verifyTotp(factorId: string, code: string): Promise<string> {
  const trimmed = code.replace(/\s/g, '')
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
  if (challengeError || !challenge) return challengeError?.message ?? 'Could not start verification'
  const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code: trimmed })
  if (error) {
    return 'That code is wrong or has expired. Use the NafPOS operator account (the one you added by scanning this screen), wait for a fresh 6-digit code, and try again.'
  }
  clearPendingTotp()
  return ''
}
