'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Alert, AuthShell, Button, Field } from '@/components/ui'

export default function SignupPage() {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() } },
    })
    if (error) {
      setError(error.message)
      setBusy(false)
      return
    }
    if (!data.session) {
      // Supabase is set to "Confirm email": the user must click the link first
      setNotice('Account created. Check your email and click the confirmation link, then sign in.')
      setBusy(false)
      return
    }
    const invite = new URLSearchParams(window.location.search).get('invite')
    router.replace(invite ? `/join?token=${invite}` : '/onboarding')
  }

  return (
    <AuthShell title="Create account" subtitle="Start your 14-day free trial. No card needed.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Your full name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <Field label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field
          label="Password"
          type="password"
          required
          minLength={8}
          hint="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <Alert>{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Creating...' : 'Create account'}
        </Button>
      </form>
      <p className="mt-4 text-center text-xs text-muted">
        By creating an account you agree to our{' '}
        <Link href="/terms" className="text-brand hover:underline">
          Terms
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="text-brand hover:underline">
          Privacy policy
        </Link>
        .
      </p>
      <p className="mt-3 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link href="/login" className="text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  )
}
