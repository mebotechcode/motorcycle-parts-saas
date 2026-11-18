// Super-admin TOTP only. Shop staff never see this.
import qrcode from 'qrcode-generator'
import { supabase } from './supabase'

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

export async function adminAal(): Promise<'aal1' | 'aal2'> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  return data?.currentLevel === 'aal2' ? 'aal2' : 'aal1'
}

export async function verifiedTotpId(): Promise<string | null> {
  const { data } = await supabase.auth.mfa.listFactors()
  const totp = data?.totp?.find((f) => f.status === 'verified')
  return totp?.id ?? null
}

export async function startTotpEnroll(): Promise<{ factorId: string; secret: string; qr: string | null; error: string }> {
  const { data: listed } = await supabase.auth.mfa.listFactors()
  const stale = [...(listed?.totp ?? []), ...(listed?.phone ?? [])].filter((f) => f.status !== 'verified')
  await Promise.all(stale.map((f) => supabase.auth.mfa.unenroll({ factorId: f.id })))

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'NafPOS operator',
  })
  if (error || !data) return { factorId: '', secret: '', qr: null, error: error?.message ?? 'Could not start authenticator setup' }

  const uri = data.totp.uri
  const qr = totpQrDataUrl(uri) ?? (data.totp.qr_code?.startsWith('data:') ? data.totp.qr_code : null)
  return { factorId: data.id, secret: data.totp.secret, qr, error: '' }
}

export async function verifyTotp(factorId: string, code: string): Promise<string> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') })
  return error?.message ?? ''
}
