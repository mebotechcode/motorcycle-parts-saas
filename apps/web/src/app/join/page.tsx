'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { decodeClaims, useSession } from '@/lib/session'
import { friendlyError } from '@/lib/errors'
import { Alert, AuthShell, Spinner } from '@/components/ui'

export default function JoinPage() {
  const router = useRouter()
  const { loading, session, refresh } = useSession()
  const [error, setError] = useState('')
  const [hookProblem, setHookProblem] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (loading || started.current) return
    const token = new URLSearchParams(window.location.search).get('token')
    if (!token) {
      setError('This invite link is incomplete. Ask the owner to send it again.')
      return
    }
    if (!session) {
      router.replace(`/signup?invite=${token}`)
      return
    }
    started.current = true
    ;(async () => {
      const { error } = await supabase.rpc('accept_invite', { p_token: token })
      if (error) {
        setError(friendlyError(error))
        return
      }
      const fresh = await refresh()
      if (!decodeClaims(fresh?.access_token).tenant_id) {
        setHookProblem(true)
        return
      }
      router.replace('/dashboard')
    })()
  }, [loading, session, router, refresh])

  return (
    <AuthShell title="Joining shop" subtitle="Accepting your invitation...">
      {error ? (
        <div className="space-y-3">
          <Alert>{error}</Alert>
          <p className="text-sm text-muted">
            Tip: sign in with the same email address the invite was sent to.{' '}
            <Link href="/login" className="text-brand hover:underline">
              Go to sign in
            </Link>
          </p>
        </div>
      ) : hookProblem ? (
        <Alert>
          You joined the shop, but the login hook is not enabled yet (Supabase → Authentication → Hooks → Custom
          Access Token). Enable it, then sign out and sign in again.
        </Alert>
      ) : (
        <Spinner label="Please wait..." />
      )}
    </AuthShell>
  )
}
