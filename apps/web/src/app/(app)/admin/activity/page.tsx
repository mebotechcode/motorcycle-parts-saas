'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Card, Spinner } from '@/components/ui'
import { deviceFromUa, keWhen } from '@/lib/admin'
import { friendlyError } from '@/lib/errors'

const PAGE_SIZE = 25

function Shops({ shops }: { shops: { id: string; name: string }[] }) {
  if (!shops?.length) return <span className="text-muted">—</span>
  return (
    <>
      {shops.map((s, i) => (
        <span key={s.id}>
          {i > 0 ? ', ' : ''}
          <Link href={`/admin/shops/${s.id}`} className="text-brand hover:underline">
            {s.name}
          </Link>
        </span>
      ))}
    </>
  )
}

export default function AdminActivityPage() {
  const { loading, claims } = useSession()
  const isAdmin = !!claims.platform_admin

  const [tab, setTab] = useState<'logins' | 'sessions'>('logins')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [rows, setRows] = useState<any[] | null>(null)
  const [sessions, setSessions] = useState<any[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to = Math.min(page * PAGE_SIZE, total)

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [qInput])

  const loadLogins = useCallback(async () => {
    if (!isAdmin) return
    setBusy(true)
    const { data, error } = await supabase.rpc('admin_login_activity', {
      p_q: q,
      p_page: page,
      p_page_size: PAGE_SIZE,
    })
    setBusy(false)
    if (error) return setError(friendlyError(error))
    setError('')
    setRows((data as any)?.rows ?? [])
    setTotal(Number((data as any)?.total ?? 0))
  }, [isAdmin, q, page])

  const loadSessions = useCallback(async () => {
    if (!isAdmin) return
    const { data, error } = await supabase.rpc('admin_active_sessions')
    if (error) return setError(friendlyError(error))
    setSessions((data as any[]) ?? [])
  }, [isAdmin])

  useEffect(() => {
    loadLogins()
  }, [loadLogins])
  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  if (loading) return <Spinner />
  if (!isAdmin) return <Alert kind="info">This page is for the NafPOS platform owner only.</Alert>

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-4xl font-bold">Activity</h1>
        <p className="text-sm text-muted">
          Logins with IP and device. IPs come from Auth (the phone/computer that signed in), not from the browser
          guessing. History starts when this was turned on; current sessions were backfilled.
        </p>
      </div>
      {error && <Alert>{error}</Alert>}

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setTab('logins')}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${tab === 'logins' ? 'bg-brand text-charcoal' : 'border border-charcoal-3 text-muted hover:bg-charcoal-3 hover:text-offwhite'}`}
        >
          Login history
        </button>
        <button
          type="button"
          onClick={() => setTab('sessions')}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${tab === 'sessions' ? 'bg-brand text-charcoal' : 'border border-charcoal-3 text-muted hover:bg-charcoal-3 hover:text-offwhite'}`}
        >
          Signed in now ({sessions?.length ?? 0})
        </button>
      </div>

      {tab === 'logins' && (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">
              Logins <span className="text-sm font-normal text-muted">({total})</span>
            </h2>
            <input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Search email, IP, shop..."
              className="w-full max-w-xs rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2 text-sm placeholder:text-muted/60 focus:border-brand focus:outline-none"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1.5 pr-2 font-medium">When</th>
                  <th className="px-2 py-1.5 font-medium">Who</th>
                  <th className="px-2 py-1.5 font-medium">Shop</th>
                  <th className="px-2 py-1.5 font-medium">IP</th>
                  <th className="px-2 py-1.5 font-medium">Device</th>
                  <th className="py-1.5 pl-2 font-medium">User agent</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-charcoal-3 align-top">
                    <td className="py-2 pr-2 whitespace-nowrap text-muted">{keWhen(r.created_at)}</td>
                    <td className="px-2 py-2">
                      <div>{r.full_name || r.email || r.user_id.slice(0, 8)}</div>
                      <div className="text-xs text-muted">
                        {r.email}
                        {r.is_platform_admin ? ' · operator' : ''}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <Shops shops={r.shops ?? []} />
                    </td>
                    <td className="px-2 py-2 font-mono text-xs">{r.ip_address || '—'}</td>
                    <td className="px-2 py-2">{deviceFromUa(r.user_agent)}</td>
                    <td className="py-2 pl-2 text-xs text-muted max-w-xs truncate" title={r.user_agent ?? ''}>
                      {r.user_agent || '—'}
                    </td>
                  </tr>
                ))}
                {rows && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-muted">
                      {q ? 'No logins match this search.' : 'No logins recorded yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
            <span>{busy ? 'Loading…' : total === 0 ? '0 logins' : `Showing ${from}–${to} of ${total}`}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1 || busy}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-charcoal-3 px-3 py-1.5 text-xs font-semibold hover:bg-charcoal-3 disabled:opacity-40"
              >
                Prev
              </button>
              <span>
                Page {Math.min(page, pages)} of {pages}
              </span>
              <button
                type="button"
                disabled={page >= pages || busy}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-charcoal-3 px-3 py-1.5 text-xs font-semibold hover:bg-charcoal-3 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </Card>
      )}

      {tab === 'sessions' && (
        <Card className="space-y-3">
          <h2 className="text-lg font-bold">Signed in now</h2>
          <p className="text-xs text-muted">Live Auth sessions. Disappears when they sign out or the token expires.</p>
          {!sessions ? (
            <Spinner />
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted">Nobody is signed in.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1.5 pr-2 font-medium">Since</th>
                    <th className="px-2 py-1.5 font-medium">Who</th>
                    <th className="px-2 py-1.5 font-medium">Shop</th>
                    <th className="px-2 py-1.5 font-medium">IP</th>
                    <th className="px-2 py-1.5 font-medium">Device</th>
                    <th className="py-1.5 pl-2 font-medium">User agent</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((r) => (
                    <tr key={r.id} className="border-t border-charcoal-3 align-top">
                      <td className="py-2 pr-2 whitespace-nowrap text-muted">{keWhen(r.created_at)}</td>
                      <td className="px-2 py-2">
                        <div>{r.full_name || r.email || r.user_id.slice(0, 8)}</div>
                        <div className="text-xs text-muted">
                          {r.email}
                          {r.is_platform_admin ? ' · operator' : ''}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <Shops shops={r.shops ?? []} />
                      </td>
                      <td className="px-2 py-2 font-mono text-xs">{r.ip_address || '—'}</td>
                      <td className="px-2 py-2">{deviceFromUa(r.user_agent)}</td>
                      <td className="py-2 pl-2 text-xs text-muted max-w-xs truncate" title={r.user_agent ?? ''}>
                        {r.user_agent || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
