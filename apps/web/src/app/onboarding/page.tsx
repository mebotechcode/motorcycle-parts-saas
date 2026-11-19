'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { decodeClaims, useSession } from '@/lib/session'
import { Alert, AuthShell, Button, Field, Spinner } from '@/components/ui'
import { friendlyError } from '@/lib/errors'

export default function OnboardingPage() {
  const router = useRouter()
  const { loading, session, claims, refresh, signOut } = useSession()
  const [name, setName] = useState('')
  const [branchName, setBranchName] = useState('Main Shop')
  const [branchCode, setBranchCode] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [hookProblem, setHookProblem] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (loading) return
    if (!session) {
      router.replace('/login')
      return
    }
    if (claims.tenant_id) {
      router.replace('/dashboard')
      return
    }
    if (claims.platform_admin) {
      router.replace('/admin')
      return
    }
    // Already a member of a business but the token has no tenant_id => the login hook is not enabled
    supabase
      .from('tenant_members')
      .select('id')
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) setHookProblem(true)
      })
  }, [loading, session, claims.tenant_id, claims.platform_admin, router])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.rpc('create_business', {
      p_name: name,
      p_branch_name: branchName,
      p_branch_code: branchCode,
      p_phone: phone || null,
    })
    if (error) {
      setError(friendlyError(error))
      setBusy(false)
      return
    }
    const fresh = await refresh()
    if (!decodeClaims(fresh?.access_token).tenant_id) {
      setHookProblem(true)
      setBusy(false)
      return
    }
    router.replace('/dashboard')
  }

  if (loading || !session || claims.platform_admin) return <Spinner />

  return (
    <AuthShell title="Set up your shop" subtitle="Tell us about your business. You can change this later.">
      {hookProblem ? (
        <div className="space-y-4">
          <Alert>
            Your shop was created, but your login does not carry it yet. In Supabase go to{' '}
            <b>Authentication → Hooks → Custom Access Token</b> and enable{' '}
            <b>public.custom_access_token_hook</b>. Then sign out and sign in again.
          </Alert>
          <Button variant="ghost" className="w-full" onClick={() => signOut().then(() => router.replace('/login'))}>
            Sign out
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="Business name"
            required
            placeholder="e.g. Kamau's Spare Parts"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Field label="First branch name" required value={branchName} onChange={(e) => setBranchName(e.target.value)} />
          <Field
            label="Branch code"
            required
            maxLength={6}
            placeholder="NRB"
            hint="2 to 6 letters. Used on receipts, e.g. NRB-000123"
            value={branchCode}
            onChange={(e) => setBranchCode(e.target.value.toUpperCase())}
          />
          <Field label="Shop phone (optional)" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          {error && <Alert>{error}</Alert>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Setting up...' : 'Create my shop'}
          </Button>
        </form>
      )}
    </AuthShell>
  )
}
