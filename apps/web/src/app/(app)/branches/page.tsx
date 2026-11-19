'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Field, Spinner } from '@/components/ui'
import { t, useLang } from '@/lib/i18n'
import { friendlyError } from '@/lib/errors'

type Branch = { id: string; name: string; code: string; town: string | null; phone: string | null; is_active: boolean }

export default function BranchesPage() {
  const { claims } = useSession()
  const isOwner = claims.tenant_role === 'owner'
  const lang = useLang()
  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('branches').select('id,name,code,town,phone,is_active').order('name')
    if (error) setError(friendlyError(error))
    setBranches((data as Branch[]) ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.from('branches').insert({ name: name.trim(), code: code.trim().toUpperCase() })
    if (error) setError(friendlyError(error))
    else {
      setName('')
      setCode('')
      await load()
    }
    setBusy(false)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-4xl font-bold">{t('branches', lang)}</h1>

      {branches === null ? (
        <Spinner />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {branches.map((b) => (
            <Card key={b.id}>
              <div className="flex items-center justify-between">
                <div className="font-display text-2xl font-bold uppercase">{b.name}</div>
                <span className="rounded-md bg-brand/15 px-2 py-0.5 text-xs font-semibold text-brand">{b.code}</span>
              </div>
              <div className="mt-1 text-sm text-muted">{b.is_active ? t('active', lang) : t('closed', lang)}</div>
            </Card>
          ))}
        </div>
      )}

      {isOwner && (
        <Card>
          <h2 className="text-xl font-bold">{t('addBranch', lang)}</h2>
          <form onSubmit={add} className="mt-3 grid gap-3 sm:grid-cols-3 sm:items-end">
            <Field label="Branch name" required value={name} onChange={(e) => setName(e.target.value)} />
            <Field
              label="Code"
              required
              maxLength={6}
              placeholder="MSA"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <Button type="submit" disabled={busy}>
              {busy ? 'Adding...' : 'Add branch'}
            </Button>
          </form>
          {error && (
            <div className="mt-3">
              <Alert>{error}</Alert>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
