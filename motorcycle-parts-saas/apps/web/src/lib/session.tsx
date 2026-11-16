'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

// What the login hook (migration 09) puts inside the user's token
export type Claims = {
  tenant_id?: string
  tenant_role?: 'owner' | 'manager' | 'cashier' | 'storekeeper'
  all_branches?: boolean
  branch_ids?: string[]
  max_discount_pct?: number
  platform_admin?: boolean
}

export function decodeClaims(token?: string | null): Claims {
  if (!token) return {}
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(b64))
  } catch {
    return {}
  }
}

type Ctx = {
  loading: boolean
  session: Session | null
  claims: Claims
  refresh: () => Promise<Session | null>
  signOut: () => Promise<void>
}

const SessionCtx = createContext<Ctx | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setLoading(false)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Call after anything that changes the user's business/role so the token is re-issued
  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.refreshSession()
    setSession(data.session)
    return data.session
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
  }, [])

  const claims = useMemo(() => decodeClaims(session?.access_token), [session?.access_token])

  return (
    <SessionCtx.Provider value={{ loading, session, claims, refresh, signOut }}>
      {children}
    </SessionCtx.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionCtx)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}

export const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  cashier: 'Cashier',
  storekeeper: 'Storekeeper',
}
