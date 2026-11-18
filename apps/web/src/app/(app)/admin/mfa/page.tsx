'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/session'
import { Alert, AuthShell, Button, Field, Spinner } from '@/components/ui'
import { adminAal, startTotpEnroll, verifiedTotpId, verifyTotp } from '@/lib/mfa'

export default function AdminMfaPage() {
  const router = useRouter()
  const { loading, session, claims, signOut } = useSession()
  const [mode, setMode] = useState<'boot' | 'enroll' | 'verify'>('boot')
  const [factorId, setFactorId] = useState('')
  const [secret, setSecret] = useState('')
  const [qr, setQr] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (loading) return
    if (!session) {
      router.replace('/login')
      return
    }
    if (!claims.platform_admin || claims.tenant_id) {
      router.replace('/dashboard')
      return
    }
    let live = true
    ;(async () => {
      const aal = await adminAal()
      if (!live) return
      if (aal === 'aal2') {
        router.replace('/admin')
        return
      }
      const existing = await verifiedTotpId()
      if (!live) return
      if (existing) {
        setFactorId(existing)
        setMode('verify')
        return
      }
      const enrolled = await startTotpEnroll()
      if (!live) return
      if (enrolled.error) {
        setError(enrolled.error)
        setMode('verify')
        return
      }
      setFactorId(enrolled.factorId)
      setSecret(enrolled.secret)
      setQr(enrolled.qr)
      setMode('enroll')
    })()
    return () => {
      live = false
    }
  }, [loading, session, claims.platform_admin, claims.tenant_id, router])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const msg = await verifyTotp(factorId, code)
    setBusy(false)
    if (msg) {
      setError(msg)
      return
    }
    router.replace('/admin')
  }

  if (loading || !session || mode === 'boot') return <Spinner label="Checking authenticator..." />

  return (
    <AuthShell
      title={mode === 'enroll' ? 'Protect this console' : 'Authenticator code'}
      subtitle={
        mode === 'enroll'
          ? 'Scan this with Google Authenticator, Authy or Microsoft Authenticator. Shop staff are never asked for this.'
          : 'Open your authenticator app and enter the 6-digit code.'
      }
    >
      {mode === 'enroll' && (
        <div className="mb-5 space-y-3">
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="Authenticator QR code" className="mx-auto h-52 w-52 rounded-lg bg-offwhite p-2" />
          )}
          {secret && (
            <p className="break-all text-center text-sm text-offwhite">
              Or type this key: <span className="font-mono tracking-wider">{secret}</span>
            </p>
          )}
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" disabled={busy || code.length !== 6} className="w-full">
          {busy ? 'Checking...' : 'Continue'}
        </Button>
      </form>
      <button
        type="button"
        onClick={() => signOut().then(() => router.replace('/login'))}
        className="mt-4 w-full text-center text-sm text-muted hover:text-offwhite"
      >
        Sign out
      </button>
    </AuthShell>
  )
}
