'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Select } from '@/components/ui'
import { FIELDS, TEMPLATE_CSV, buildRows, parseCSV, type ImportRow } from '@/lib/csv'
import { canEditInventory } from '@/lib/inventory'
import { friendlyError } from '@/lib/errors'

const BATCH = 100

type Result = { created: number; updated: number; skipped: number; failed: number; errors: any[]; warnings: any[] }

export default function ImportPage() {
  const { claims } = useSession()
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [branchId, setBranchId] = useState('')
  const [update, setUpdate] = useState(false)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ReturnType<typeof buildRows> | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('branches')
      .select('id,name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        const mine = ((data as any[]) ?? []).filter((b) => claims.all_branches || (claims.branch_ids ?? []).includes(b.id))
        setBranches(mine)
        if (mine.length === 1) setBranchId(mine[0].id)
      })
  }, [claims.all_branches, claims.branch_ids])

  if (!canEditInventory(claims.tenant_role)) {
    return <Alert kind="info">Only the owner, managers and storekeepers can import products.</Alert>
  }

  function downloadTemplate() {
    const blob = new Blob(['\ufeff' + TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'products-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setResult(null)
    setError('')
    setParsed(null)
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    if (/\.xlsx?$/i.test(file.name)) {
      setError('This is an Excel file. In Excel choose File → Save As → "CSV UTF-8 (Comma delimited)", then choose that file here.')
      return
    }
    const text = await file.text()
    const table = parseCSV(text)
    if (table.length < 2) {
      setError('The file has no data rows. The first row must be the column names.')
      return
    }
    const p = buildRows(table)
    if (!p.found.includes('name')) {
      setError('I could not find a "name" column. Download the template to see the column names.')
      return
    }
    setParsed(p)
  }

  async function run() {
    if (!parsed) return
    setBusy(true)
    setError('')
    setResult(null)
    setProgress(0)
    const total: Result = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [], warnings: [] }
    const hasStock = parsed.found.includes('opening_stock')

    for (let i = 0; i < parsed.rows.length; i += BATCH) {
      const chunk: ImportRow[] = parsed.rows.slice(i, i + BATCH)
      const { data, error } = await supabase.rpc('import_products', {
        p_rows: chunk,
        p_branch_id: hasStock && branchId ? branchId : null,
        p_update_existing: update,
      })
      if (error) {
        setError(friendlyError(error))
        setBusy(false)
        setResult(total)
        return
      }
      const r = data as Result
      total.created += r.created
      total.updated += r.updated
      total.skipped += r.skipped
      total.failed += r.failed
      total.errors.push(...r.errors)
      total.warnings.push(...r.warnings)
      setProgress(Math.min(parsed.rows.length, i + BATCH))
    }
    setResult(total)
    setBusy(false)
  }

  const needsBranch = parsed?.found.includes('opening_stock') && !branchId

  return (
    <div className="space-y-5">
      <Link href="/inventory" className="text-sm text-muted hover:text-offwhite">
        ← Back to inventory
      </Link>
      <h1 className="text-4xl font-bold">Import from Excel</h1>

      <Card className="space-y-3">
        <h2 className="text-xl font-bold">1. Get your file ready</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Download the template and open it in Excel.</li>
          <li>Paste or type your parts under the column names. Only <b className="text-offwhite">name</b> and <b className="text-offwhite">selling_price</b> are required.</li>
          <li>Save it as <b className="text-offwhite">CSV UTF-8 (Comma delimited)</b>.</li>
        </ol>
        <p className="text-xs text-muted">
          Tip: keep a unique <b>code (sku)</b> for each part. Importing again with the same codes can then update prices without making duplicates.
          In the <b>fits</b> column write bikes as &quot;Bajaj Boxer BM100; TVS HLX 125&quot;. You can also import
          <b>aisle</b>, <b>rack</b>, <b>bin</b>, <b>aliases</b> (slang, separated by &quot;;&quot; — used by the POS search) and the KRA <b>hs_code</b>.
        </p>
        <Button variant="ghost" onClick={downloadTemplate}>
          Download template
        </Button>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-xl font-bold">2. Choose your file</h2>
        <input type="file" accept=".csv,text/csv,.txt" onChange={onFile} className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2.5 file:font-semibold file:text-charcoal" />
        {fileName && !error && <p className="text-xs text-muted">{fileName}</p>}
        {error && <Alert>{error}</Alert>}
      </Card>

      {parsed && !result && (
        <Card className="space-y-4">
          <h2 className="text-xl font-bold">3. Check and import</h2>
          <div className="text-sm">
            <b className="text-brand">{parsed.rows.length}</b> row{parsed.rows.length === 1 ? '' : 's'} ready
            {parsed.problems.length > 0 && <> · <b className="text-red-300">{parsed.problems.length}</b> with problems (they will be skipped)</>}
          </div>
          <div className="text-xs text-muted">
            Columns found: {parsed.found.map((k) => FIELDS.find((f) => f.key === k)?.label).join(', ')}
            {parsed.unknown.length > 0 && <> · Ignored: {parsed.unknown.join(', ')}</>}
          </div>

          {parsed.problems.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg bg-charcoal p-3 text-xs text-red-200">
              {parsed.problems.slice(0, 50).map((p, i) => (
                <div key={i}>Row {p.row}: {p.message}</div>
              ))}
            </div>
          )}

          {parsed.found.includes('opening_stock') && (
            <Select label="Which branch holds this stock?" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Choose branch...</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#FF5B14]" />
            <span>
              Update products that already exist (matched by code). Empty cells keep the current value.
              <span className="block text-xs text-muted">If unticked, existing codes are skipped.</span>
            </span>
          </label>

          <div className="overflow-x-auto rounded-lg border border-charcoal-3">
            <table className="w-full min-w-[32rem] text-left text-xs">
              <thead className="bg-charcoal text-muted">
                <tr>
                  {parsed.found.map((k) => (
                    <th key={k} className="px-2 py-1.5 font-medium">{FIELDS.find((f) => f.key === k)?.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 5).map((r) => (
                  <tr key={r._row} className="border-t border-charcoal-3">
                    {parsed.found.map((k) => (
                      <td key={k} className="max-w-[10rem] truncate px-2 py-1.5">{(r as any)[k]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Showing the first 5 rows.</p>

          {busy && (
            <div>
              <div className="h-2 overflow-hidden rounded bg-charcoal-3">
                <div className="h-full bg-brand transition-all" style={{ width: `${(progress / Math.max(1, parsed.rows.length)) * 100}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">Importing... {progress} of {parsed.rows.length}</p>
            </div>
          )}

          <Button onClick={run} disabled={busy || parsed.rows.length === 0 || !!needsBranch}>
            {busy ? 'Importing...' : `Import ${parsed.rows.length} product${parsed.rows.length === 1 ? '' : 's'}`}
          </Button>
          {needsBranch && <p className="text-xs text-muted">Choose the branch for the stock numbers first.</p>}
        </Card>
      )}

      {result && (
        <Card className="space-y-3">
          <h2 className="text-xl font-bold">Done</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Created" value={result.created} />
            <Stat label="Updated" value={result.updated} />
            <Stat label="Skipped" value={result.skipped} />
            <Stat label="Failed" value={result.failed + (parsed?.problems.length ?? 0)} bad />
          </div>
          {(result.errors.length > 0 || (parsed?.problems.length ?? 0) > 0) && (
            <div>
              <div className="mb-1 text-sm font-semibold text-red-200">Problems</div>
              <div className="max-h-48 overflow-y-auto rounded-lg bg-charcoal p-3 text-xs text-red-200">
                {parsed?.problems.map((p, i) => <div key={'p' + i}>Row {p.row}: {p.message}</div>)}
                {result.errors.map((p: any, i: number) => <div key={'e' + i}>Row {p.row}: {p.message}</div>)}
              </div>
            </div>
          )}
          {result.warnings.length > 0 && (
            <div>
              <div className="mb-1 text-sm font-semibold">Notes</div>
              <div className="max-h-48 overflow-y-auto rounded-lg bg-charcoal p-3 text-xs text-muted">
                {result.warnings.map((p: any, i: number) => <div key={i}>Row {p.row}: {p.message}</div>)}
              </div>
            </div>
          )}
          <Link href="/inventory" className="inline-block rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-charcoal">
            View inventory
          </Link>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="rounded-xl bg-charcoal p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`font-display text-3xl font-bold ${bad && value > 0 ? 'text-red-300' : ''}`}>{value}</div>
    </div>
  )
}
