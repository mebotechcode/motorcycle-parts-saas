'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { decodeClaims } from '@/lib/session'
import { Alert, AuthShell, Button, Field } from '@/components/ui'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) {
      setError(error.message)
      setBusy(false)
      return
    }
    const invite = new URLSearchParams(window.location.search).get('invite')
    if (invite) {
      router.replace(`/join?token=${invite}`)
      return
    }
    const { data: sess } = await supabase.auth.getSession()
    const claims = decodeClaims(sess.session?.access_token)
    // SaaS operator (platform admin, no shop) goes to the console, not a shop dashboard
    router.replace(claims.platform_admin && !claims.tenant_id ? '/admin/mfa' : '/dashboard')
  }

  return (
    <AuthShell title="Sign in" subtitle="Welcome back. Sign in to manage your shop.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field
          label="Password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        New here?{' '}
        <Link href="/signup" className="text-brand hover:underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  )
}
