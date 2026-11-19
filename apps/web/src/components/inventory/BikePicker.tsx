'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/errors'
import { Alert, Button, Field, Select } from '@/components/ui'

type Make = { id: string; name: string }
type Model = { id: string; make_id: string; name: string; engine_cc: number | null }

// Pick the bike models a part fits. Can't find a model? Add it right here.
export default function BikePicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [makes, setMakes] = useState<Make[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [makeId, setMakeId] = useState('')
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [newMake, setNewMake] = useState('')
  const [newModel, setNewModel] = useState('')
  const [newCc, setNewCc] = useState('')

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.from('bike_makes').select('id,name').order('name'),
      supabase.from('bike_models').select('id,make_id,name,engine_cc').order('name'),
    ])
    setMakes((a.data as Make[]) ?? [])
    setModels((b.data as Model[]) ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const byId = useMemo(() => Object.fromEntries(models.map((m) => [m.id, m])), [models])
  const makeName = (id: string) => makes.find((m) => m.id === id)?.name ?? ''
  const label = (id: string) => {
    const m = byId[id]
    return m ? `${makeName(m.make_id)} ${m.name}` : '...'
  }
  const shown = models.filter((m) => m.make_id === makeId)
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])

  async function addModel() {
    setError('')
    const typed = newMake.trim()
    let mk = ''
    if (typed) {
      const existing = makes.find((m) => m.name.toLowerCase() === typed.toLowerCase())
      if (existing) mk = existing.id
      else {
        const { data, error } = await supabase.from('bike_makes').insert({ name: typed }).select('id,name').single()
        if (error) return setError(friendlyError(error))
        mk = (data as Make).id
        setMakes((p) => [...p, data as Make])
      }
    } else mk = makeId
    if (!mk) return setError('Choose a make or type a new one')
    if (!newModel.trim()) return setError('Type the model name')
    const { data, error } = await supabase
      .from('bike_models')
      .insert({ make_id: mk, name: newModel.trim(), engine_cc: newCc ? Number(newCc) : null })
      .select('id,make_id,name,engine_cc')
      .single()
    if (error) return setError(friendlyError(error))
    setModels((p) => [...p, data as Model])
    setMakeId(mk)
    onChange([...value, (data as Model).id])
    setNewMake('')
    setNewModel('')
    setNewCc('')
    setAdding(false)
  }

  return (
    <div className="space-y-3">
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {value.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-lg bg-brand/15 px-2.5 py-1 text-sm text-brand">
              {label(id)}
              <button type="button" aria-label="Remove" onClick={() => toggle(id)} className="hover:text-offwhite">
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">No bikes selected yet. Leave empty if the part fits many bikes or is not bike-specific.</p>
      )}

      <Select label="Make" value={makeId} onChange={(e) => setMakeId(e.target.value)}>
        <option value="">Choose a make...</option>
        {makes.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>

      {makeId && (
        <div className="grid gap-2 sm:grid-cols-2">
          {shown.length === 0 && <p className="text-sm text-muted">No models saved for this make yet.</p>}
          {shown.map((m) => (
            <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2 text-sm">
              <input type="checkbox" checked={value.includes(m.id)} onChange={() => toggle(m.id)} className="h-4 w-4 accent-[#FF5B14]" />
              {m.name}
              {m.engine_cc ? <span className="text-muted">({m.engine_cc}cc)</span> : null}
            </label>
          ))}
        </div>
      )}

      {!adding ? (
        <button type="button" onClick={() => setAdding(true)} className="text-sm text-brand hover:underline">
          Can&apos;t find the bike? Add it
        </button>
      ) : (
        <div className="space-y-3 rounded-xl border border-charcoal-3 bg-charcoal p-3">
          <datalist id="make-suggestions">
            {makes.map((m) => (
              <option key={m.id} value={m.name} />
            ))}
          </datalist>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Make" list="make-suggestions" placeholder={makeName(makeId) || 'e.g. Bajaj'} value={newMake} onChange={(e) => setNewMake(e.target.value)} hint={makeId ? 'Empty = use the make chosen above' : ''} />
            <Field label="Model" placeholder="e.g. Boxer BM150" value={newModel} onChange={(e) => setNewModel(e.target.value)} />
            <Field label="Engine cc (optional)" type="number" inputMode="numeric" value={newCc} onChange={(e) => setNewCc(e.target.value)} />
          </div>
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <Button type="button" onClick={addModel}>
              Add bike
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
