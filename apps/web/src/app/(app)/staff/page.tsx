'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ROLE_LABEL, useSession } from '@/lib/session'
import { Alert, Button, Card, Field, Select, Spinner } from '@/components/ui'

type Branch = { id: string; name: string; code: string }
type Member = { id: string; user_id: string; role: string; status: string; all_branches: boolean; max_discount_pct: number }
type Invite = { id: string; email: string; role: string; token: string; expires_at: string; branch_ids: string[] }
type Profile = { id: string; full_name: string | null; phone: string | null }
type MemberBranch = { member_id: string; branch_id: string }

export default function StaffPage() {
  const { claims, session } = useSession()
  const isOwner = claims.tenant_role === 'owner'
  const canView = isOwner || claims.tenant_role === 'manager'

  const [ready, setReady] = useState(false)
  const [branches, setBranches] = useState<Branch[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [memberBranches, setMemberBranches] = useState<MemberBranch[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [invites, setInvites] = useState<Invite[]>([])

  const [email, setEmail] = useState('')
  const [role, setRole] = useState('cashier')
  const [picked, setPicked] = useState<string[]>([])
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState('')

  const load = useCallback(async () => {
    const [b, m, mb, inv] = await Promise.all([
      supabase.from('branches').select('id,name,code').order('name'),
      supabase.from('tenant_members').select('id,user_id,role,status,all_branches,max_discount_pct').order('created_at'),
      supabase.from('member_branches').select('member_id,branch_id'),
      supabase.from('tenant_invites').select('id,email,role,token,expires_at,branch_ids').is('accepted_at', null),
    ])
    const memberList = (m.data as Member[]) ?? []
    setBranches((b.data as Branch[]) ?? [])
    setMembers(memberList)
    setMemberBranches((mb.data as MemberBranch[]) ?? [])
    setInvites((inv.data as Invite[]) ?? [])

    const ids = memberList.map((x) => x.user_id)
    if (ids.length > 0) {
      const { data } = await supabase.from('profiles').select('id,full_name,phone').in('id', ids)
      const map: Record<string, Profile> = {}
      ;((data as Profile[]) ?? []).forEach((p) => (map[p.id] = p))
      setProfiles(map)
    }
    setReady(true)
  }, [])

  useEffect(() => {
    if (canView) load()
  }, [canView, load])

  if (!canView) return <Alert kind="info">Only the owner and managers can see staff.</Alert>
  if (!ready) return <Spinner />

  const inviteUrl = (token: string) => `${window.location.origin}/join?token=${token}`
  const whatsapp = (token: string) =>
    `https://wa.me/?text=${encodeURIComponent(`You are invited to join our shop on NafPOS. Open this link: ${inviteUrl(token)}`)}`

  async function readFnError(err: any): Promise<string> {
    try {
      const j = await err.context.json()
      return j.error ?? err.message
    } catch {
      return err.message
    }
  }

  // Creates the invite and emails it (Edge Function). If email is not set up or the
  // function is not deployed yet, it still creates the link so you can share it yourself.
  async function sendInvitation(to: string, inviteRole: string, branchIds: string[]) {
    setError('')
    setInfo('')
    setLink('')
    const res = await supabase.functions.invoke('send-invite', {
      body: { email: to, role: inviteRole, branch_ids: branchIds },
    })

    if (res.error) {
      const status = (res.error as any).context?.status
      if (status === 404 || res.error.name !== 'FunctionsHttpError') {
        const { data, error } = await supabase.rpc('invite_staff', {
          p_email: to,
          p_role: inviteRole,
          p_branch_ids: branchIds,
        })
        if (error) {
          setError(error.message)
          return false
        }
        setLink(inviteUrl(data as string))
        setInfo('Invite created, but email sending is not set up yet. Share the link below yourself.')
        await load()
        return true
      }
      setError(await readFnError(res.error))
      return false
    }

    const out = res.data as { link: string; emailed: boolean; reason?: string }
    setLink(out.link)
    if (out.emailed) setInfo(`Invitation emailed to ${to}.`)
    else setInfo(`Invite created, but the email was not sent. ${out.reason ?? ''} Share the link below yourself.`)
    await load()
    return true
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const ok = await sendInvitation(email, role, picked)
    if (ok) {
      setEmail('')
      setPicked([])
    }
    setBusy(false)
  }

  async function resend(i: Invite) {
    setResending(i.id)
    await sendInvitation(i.email, i.role, i.branch_ids ?? [])
    setResending('')
  }

  async function updateStaff(memberId: string, changes: { p_role?: string; p_status?: string }) {
    setError('')
    setInfo('')
    const { error } = await supabase.rpc('update_staff', { p_member_id: memberId, ...changes })
    if (error) setError(error.message)
    else {
      setInfo('Saved. The change reaches that person the next time they sign in or their session refreshes (within about an hour).')
      await load()
    }
  }

  async function revoke(id: string) {
    await supabase.from('tenant_invites').delete().eq('id', id)
    await load()
  }

  const branchNames = (m: Member) =>
    m.all_branches
      ? 'All branches'
      : memberBranches
          .filter((x) => x.member_id === m.id)
          .map((x) => branches.find((b) => b.id === x.branch_id)?.code ?? '?')
          .join(', ') || 'No branch'

  return (
    <div className="space-y-6">
      <h1 className="text-4xl font-bold">Staff</h1>
      {error && <Alert>{error}</Alert>}
      {info && <Alert kind="success">{info}</Alert>}

      <Card className="space-y-3">
        <h2 className="text-xl font-bold">Team members</h2>
        {members.map((m) => {
          const p = profiles[m.user_id]
          const isMe = m.user_id === session?.user.id
          return (
            <div
              key={m.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-charcoal-3 bg-charcoal p-3"
            >
              <div className="min-w-[10rem] flex-1">
                <div className="font-semibold">
                  {p?.full_name || 'Unnamed'} {isMe && <span className="text-xs text-muted">(you)</span>}
                </div>
                <div className="text-xs text-muted">
                  {branchNames(m)} · max discount {m.max_discount_pct}%
                </div>
              </div>
              {isOwner ? (
                <>
                  <div className="w-full sm:w-40">
                    <Select value={m.role} onChange={(e) => updateStaff(m.id, { p_role: e.target.value })}>
                      {Object.entries(ROLE_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button
                    variant={m.status === 'active' ? 'ghost' : 'primary'}
                    onClick={() => updateStaff(m.id, { p_status: m.status === 'active' ? 'disabled' : 'active' })}
                  >
                    {m.status === 'active' ? 'Disable' : 'Enable'}
                  </Button>
                </>
              ) : (
                <span className="text-sm text-muted">
                  {ROLE_LABEL[m.role]} · {m.status}
                </span>
              )}
            </div>
          )
        })}
      </Card>

      {isOwner && (
        <Card className="space-y-4">
          <h2 className="text-xl font-bold">Invite someone</h2>
          <form onSubmit={sendInvite} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Their email"
                type="email"
                required
                hint="We email them a link. They must sign up with this same email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="manager">Manager</option>
                <option value="cashier">Cashier</option>
                <option value="storekeeper">Storekeeper</option>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-sm text-muted">Branches they can work in (none ticked = all branches)</div>
              <div className="flex flex-wrap gap-2">
                {branches.map((b) => {
                  const on = picked.includes(b.id)
                  return (
                    <button
                      type="button"
                      key={b.id}
                      onClick={() => setPicked(on ? picked.filter((x) => x !== b.id) : [...picked, b.id])}
                      className={`rounded-lg border px-3 py-1.5 text-sm ${
                        on ? 'border-brand bg-brand/15 text-brand' : 'border-charcoal-3 text-muted'
                      }`}
                    >
                      {b.name}
                    </button>
                  )
                })}
              </div>
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? 'Sending...' : 'Send invitation'}
            </Button>
          </form>

          {link && (
            <Alert kind="success">
              <div className="mb-2">Invite link (you can also share it yourself):</div>
              <input readOnly value={link} className="w-full rounded-lg bg-charcoal px-2 py-1.5 text-xs" />
              <div className="mt-2 flex gap-2">
                <Button variant="ghost" onClick={() => navigator.clipboard.writeText(link)}>
                  Copy link
                </Button>
                <a
                  className="inline-flex items-center rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-charcoal"
                  href={`https://wa.me/?text=${encodeURIComponent(`You are invited to join our shop on NafPOS. Open this link: ${link}`)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Share on WhatsApp
                </a>
              </div>
            </Alert>
          )}
        </Card>
      )}

      {isOwner && invites.length > 0 && (
        <Card className="space-y-3">
          <h2 className="text-xl font-bold">Waiting to join</h2>
          {invites.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-charcoal-3 bg-charcoal p-3">
              <div className="min-w-[10rem] flex-1">
                <div className="font-semibold">{i.email}</div>
                <div className="text-xs text-muted">
                  {ROLE_LABEL[i.role]} · expires {new Date(i.expires_at).toLocaleDateString()}
                </div>
              </div>
              <Button variant="primary" disabled={resending === i.id} onClick={() => resend(i)}>
                {resending === i.id ? 'Sending...' : 'Email again'}
              </Button>
              <Button variant="ghost" onClick={() => navigator.clipboard.writeText(inviteUrl(i.token))}>
                Copy link
              </Button>
              <a
                className="rounded-lg border border-charcoal-3 px-4 py-2.5 text-sm font-semibold hover:bg-charcoal-3"
                href={whatsapp(i.token)}
                target="_blank"
                rel="noreferrer"
              >
                WhatsApp
              </a>
              <Button variant="danger" onClick={() => revoke(i.id)}>
                Cancel
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
