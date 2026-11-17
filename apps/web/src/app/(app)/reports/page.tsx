'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/lib/session'
import { Alert, Button, Card, Field, Select, Spinner } from '@/components/ui'
import { money } from '@/lib/pos'
import { qty as fmtQty } from '@/lib/inventory'
import { PRESET_LABEL, downloadCSV, periodRange, type Preset } from '@/lib/reports'
import { t as tr, useLang } from '@/lib/i18n'
import { VBars, HBars } from '@/components/Charts'

type Tab = 'overview' | 'products' | 'stock' | 'team'

export default function ReportsPage() {
  const { claims } = useSession()
  const manager = claims.tenant_role === 'owner' || claims.tenant_role === 'manager'
  const lang = useLang()
  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: tr('tabOverview', lang) },
    { key: 'products', label: tr('tabProducts', lang) },
    { key: 'stock', label: tr('tabStock', lang) },
    { key: 'team', label: tr('tabTeam', lang) },
  ]

  const [tab, setTab] = useState<Tab>('overview')
  const [preset, setPreset] = useState<Preset>('month')
  const [cFrom, setCFrom] = useState('')
  const [cTo, setCTo] = useState('')
  const [branch, setBranch] = useState('')
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [profit, setProfit] = useState<any>(null)
  const [daily, setDaily] = useState<any[]>([])
  const [order, setOrder] = useState('revenue')
  const [top, setTop] = useState<any[]>([])
  const [slowDays, setSlowDays] = useState('60')
  const [slow, setSlow] = useState<any[]>([])
  const [stockRows, setStockRows] = useState<any[]>([])
  const [staff, setStaff] = useState<any[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [branchRows, setBranchRows] = useState<any[]>([])

  const { from, to } = periodRange(preset, cFrom, cTo)
  const b = branch || null

  useEffect(() => {
    supabase.from('branches').select('id,name').eq('is_active', true).order('name').then(({ data }) => setBranches((data as any[]) ?? []))
  }, [])

  const load = useCallback(async () => {
    if (!manager) return
    setError('')
    setLoading(true)
    try {
      if (tab === 'overview') {
        const [p, d] = await Promise.all([supabase.rpc('report_profit', { p_from: from, p_to: to, p_branch: b }), supabase.rpc('report_daily', { p_from: from, p_to: to, p_branch: b })])
        if (p.error) throw p.error
        if (d.error) throw d.error
        setProfit(p.data)
        setDaily((d.data as any[]) ?? [])
      } else if (tab === 'products') {
        const [t, s] = await Promise.all([
          supabase.rpc('report_top_products', { p_from: from, p_to: to, p_branch: b, p_limit: 20, p_order: order }),
          supabase.rpc('report_slow_stock', { p_days: Number(slowDays), p_branch: b }),
        ])
        if (t.error) throw t.error
        if (s.error) throw s.error
        setTop((t.data as any[]) ?? [])
        setSlow((s.data as any[]) ?? [])
      } else if (tab === 'stock') {
        const s = await supabase.rpc('report_stock_value', { p_branch: b })
        if (s.error) throw s.error
        setStockRows((s.data as any[]) ?? [])
      } else {
        const st = await supabase.rpc('report_staff', { p_from: from, p_to: to, p_branch: b })
        if (st.error) throw st.error
        const rows = (st.data as any[]) ?? []
        setStaff(rows)
        const ids = rows.map((r) => r.user_id)
        if (ids.length) {
          const { data } = await supabase.from('profiles').select('id,full_name').in('id', ids)
          const m: Record<string, string> = {}
          ;((data as any[]) ?? []).forEach((p) => (m[p.id] = p.full_name || 'Staff'))
          setNames(m)
        }
        const per = await Promise.all(branches.map((br) => supabase.rpc('report_profit', { p_from: from, p_to: to, p_branch: br.id })))
        setBranchRows(per.map((r, i) => ({ id: branches[i].id, name: branches[i].name, ...(r.data as any) })))
      }
    } catch (e: any) {
      setError(e.message ?? 'Could not load the report')
    }
    setLoading(false)
  }, [manager, tab, from, to, b, order, slowDays, branches])

  useEffect(() => {
    if (preset === 'custom' && (!cFrom || !cTo)) return
    load()
  }, [load, preset, cFrom, cTo])

  if (!manager) return <Alert kind="info">Only the owner and managers can open reports.</Alert>

  const margin = profit && Number(profit.net_sales) > 0 ? (Number(profit.gross_profit) / Number(profit.net_sales)) * 100 : null
  const stockTotals = stockRows.reduce((a, r) => ({ cost: a.cost + Number(r.cost_value), retail: a.retail + Number(r.retail_value), units: a.units + Number(r.units) }), { cost: 0, retail: 0, units: 0 })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-4xl font-bold">{tr('reportsTitle', lang)}</h1>
        <p className="text-sm text-muted">{tr('reportsSub', lang)}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === t.key ? 'bg-brand text-charcoal' : 'border border-charcoal-3 text-muted hover:bg-charcoal-3'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <Card className="grid gap-3 sm:grid-cols-3">
        {tab !== 'stock' && (
          <Select label="Period" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
            {(Object.keys(PRESET_LABEL) as Preset[]).map((p) => (
              <option key={p} value={p}>
                {PRESET_LABEL[p]}
              </option>
            ))}
          </Select>
        )}
        {tab !== 'stock' && preset === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="From" type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} />
            <Field label="To" type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} />
          </div>
        )}
        {branches.length > 1 && (
          <Select label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">All branches</option>
            {branches.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        )}
      </Card>

      {tab !== 'stock' && (
        <p className="text-xs text-muted">
          {from === to ? from : `${from} to ${to}`}
        </p>
      )}

      {error && <Alert>{error}</Alert>}
      {loading && <Spinner />}

      {/* ===================== OVERVIEW ===================== */}
      {tab === 'overview' && profit && !loading && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card>
              <div className="text-xs text-muted">Sales (after returns)</div>
              <div className="font-display text-2xl font-bold sm:text-3xl">KES {money(profit.net_sales)}</div>
              <div className="text-xs text-muted">{profit.sales_count} sale{profit.sales_count === 1 ? '' : 's'}</div>
            </Card>
            <Card>
              <div className="text-xs text-muted">Gross profit</div>
              <div className="font-display text-2xl font-bold sm:text-3xl">KES {money(profit.gross_profit)}</div>
              <div className="text-xs text-muted">{margin === null ? '' : `${margin.toFixed(0)}% of sales`}</div>
            </Card>
            <Card>
              <div className="text-xs text-muted">Expenses</div>
              <div className="font-display text-2xl font-bold sm:text-3xl">KES {money(profit.expenses)}</div>
            </Card>
            <Card className={Number(profit.net_profit) >= 0 ? 'border-emerald-500/40' : 'border-red-400/50'}>
              <div className="text-xs text-muted">Net profit</div>
              <div className={`font-display text-2xl font-bold sm:text-3xl ${Number(profit.net_profit) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>KES {money(profit.net_profit)}</div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-1">
              <h2 className="text-xl font-bold">Money received</h2>
              {[['Cash', profit.collected?.cash], ['M-Pesa', profit.collected?.mpesa], ['Bank', profit.collected?.bank], ['Other', profit.collected?.other]].map(([l, v]) => (
                <div key={l as string} className="flex justify-between text-sm">
                  <span className="text-muted">{l}</span>
                  <b>KES {money(v as number)}</b>
                </div>
              ))}
              <div className="border-t border-charcoal-3 pt-2 text-sm">
                <div className="flex justify-between"><span className="text-muted">Given on credit (unpaid)</span><b>KES {money(profit.credit_given)}</b></div>
                <div className="flex justify-between"><span className="text-muted">Discounts on bills</span><b>KES {money(profit.discounts)}</b></div>
                <div className="flex justify-between"><span className="text-muted">Returns refunded</span><b>KES {money(profit.returns)}</b></div>
                <div className="flex justify-between"><span className="text-muted">Paid to suppliers</span><b>KES {money(profit.supplier_payments)}</b></div>
                <div className="flex justify-between"><span className="text-muted">VAT inside sales</span><b>KES {money(profit.vat_in_sales)}</b></div>
              </div>
            </Card>
            <Card className="space-y-1">
              <h2 className="text-xl font-bold">Where the expenses went</h2>
              {(profit.expenses_by_category ?? []).length === 0 ? (
                <p className="text-sm text-muted">No expenses in this period.</p>
              ) : (
                (profit.expenses_by_category as any[]).map((c) => (
                  <div key={c.category} className="flex items-center gap-3 text-sm">
                    <div className="w-36 truncate">{c.category}</div>
                    <div className="h-2 flex-1 overflow-hidden rounded bg-charcoal-3">
                      <div className="h-full bg-brand" style={{ width: `${Number(profit.expenses) > 0 ? (Number(c.total) / Number(profit.expenses)) * 100 : 0}%` }} />
                    </div>
                    <div className="w-24 text-right">KES {money(c.total)}</div>
                  </div>
                ))
              )}
            </Card>
          </div>

          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold">Day by day</h2>
              <Button variant="ghost" onClick={() => downloadCSV(`daily-${from}-to-${to}.csv`, [['Date', 'Sales', 'Net sales', 'Cost of goods', 'Gross profit', 'Expenses', 'Net profit'], ...daily.map((d) => [d.day, d.sales_count, d.net_sales, d.cogs, d.gross_profit, d.expenses, Number(d.gross_profit) - Number(d.expenses)])])}>
                {tr('downloadCsv', lang)}
              </Button>
            </div>
            <VBars
              points={daily.map((d) => ({
                label: new Date(d.day).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }),
                value: Number(d.net_sales),
                color: Number(d.gross_profit) - Number(d.expenses) >= 0 ? undefined : '#F87171',
              }))}
              format={(v) => `KES ${money(v)}`}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1.5 pr-2 font-medium">Date</th>
                    <th className="px-2 py-1.5 text-right font-medium">Sales</th>
                    <th className="px-2 py-1.5 text-right font-medium">Net sales</th>
                    <th className="px-2 py-1.5 text-right font-medium">Gross profit</th>
                    <th className="px-2 py-1.5 text-right font-medium">Expenses</th>
                    <th className="py-1.5 pl-2 text-right font-medium">Net profit</th>
                  </tr>
                </thead>
                <tbody>
                  {[...daily].reverse().map((d) => {
                    const np = Number(d.gross_profit) - Number(d.expenses)
                    return (
                      <tr key={d.day} className="border-t border-charcoal-3">
                        <td className="py-1.5 pr-2">{new Date(d.day).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                        <td className="px-2 text-right">{d.sales_count}</td>
                        <td className="px-2 text-right">{money(d.net_sales)}</td>
                        <td className="px-2 text-right">{money(d.gross_profit)}</td>
                        <td className="px-2 text-right">{money(d.expenses)}</td>
                        <td className={`py-1.5 pl-2 text-right font-semibold ${np >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{money(np)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* ===================== PRODUCTS ===================== */}
      {tab === 'products' && !loading && (
        <>
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold">Best sellers</h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-44">
                  <Select value={order} onChange={(e) => setOrder(e.target.value)}>
                    <option value="revenue">By money (sales)</option>
                    <option value="qty">By number sold</option>
                    <option value="profit">By profit</option>
                  </Select>
                </div>
                <Button variant="ghost" onClick={() => downloadCSV(`best-sellers-${from}-to-${to}.csv`, [['Product', 'Code', 'Sold', 'Sales', 'Profit'], ...top.map((r) => [r.name, r.sku, r.qty, r.revenue, r.profit])])}>
                  {tr('downloadCsv', lang)}
                </Button>
              </div>
            </div>
            {top.length > 0 && <HBars items={top.slice(0, 10).map((r) => ({ label: r.name, value: Number(r.revenue) }))} format={(v) => `KES ${money(v)}`} />}
            {top.length === 0 ? (
              <p className="text-sm text-muted">No sales in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[30rem] text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">#</th>
                      <th className="px-2 py-1.5 font-medium">Product</th>
                      <th className="px-2 py-1.5 text-right font-medium">Sold</th>
                      <th className="px-2 py-1.5 text-right font-medium">Sales</th>
                      <th className="py-1.5 pl-2 text-right font-medium">Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((r, i) => (
                      <tr key={r.product_id} className="border-t border-charcoal-3">
                        <td className="py-1.5 pr-2 text-muted">{i + 1}</td>
                        <td className="px-2"><div>{r.name}</div><div className="text-xs text-muted">{r.sku}</div></td>
                        <td className="px-2 text-right">{fmtQty(r.qty)}</td>
                        <td className="px-2 text-right">{money(r.revenue)}</td>
                        <td className={`py-1.5 pl-2 text-right ${Number(r.profit) >= 0 ? '' : 'text-red-300'}`}>{money(r.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold">Slow-moving stock</h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-52">
                  <Select value={slowDays} onChange={(e) => setSlowDays(e.target.value)}>
                    <option value="30">Not sold in 30 days</option>
                    <option value="60">Not sold in 60 days</option>
                    <option value="90">Not sold in 90 days</option>
                    <option value="180">Not sold in 180 days</option>
                  </Select>
                </div>
                <Button variant="ghost" onClick={() => downloadCSV(`slow-stock-${slowDays}days.csv`, [['Product', 'Code', 'In stock', 'Cost each', 'Money tied up', 'Last sold'], ...slow.map((r) => [r.name, r.sku, r.stock_qty, r.cost_price, r.stock_value, r.last_sold_at ?? 'never'])])}>
                  {tr('downloadCsv', lang)}
                </Button>
              </div>
            </div>
            {slow.length === 0 ? (
              <p className="text-sm text-muted">Nothing is sitting still. 🎉</p>
            ) : (
              <>
                <p className="text-sm text-muted">
                  Money tied up in these items: <b className="text-brand">KES {money(slow.reduce((s, r) => s + Number(r.stock_value), 0))}</b>
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[30rem] text-left text-sm">
                    <thead className="text-xs text-muted">
                      <tr>
                        <th className="py-1.5 pr-2 font-medium">Product</th>
                        <th className="px-2 py-1.5 text-right font-medium">In stock</th>
                        <th className="px-2 py-1.5 text-right font-medium">Money tied up</th>
                        <th className="py-1.5 pl-2 text-right font-medium">Last sold</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slow.map((r) => (
                        <tr key={r.product_id} className="border-t border-charcoal-3">
                          <td className="py-1.5 pr-2"><div>{r.name}</div><div className="text-xs text-muted">{r.sku}</div></td>
                          <td className="px-2 text-right">{fmtQty(r.stock_qty)}</td>
                          <td className="px-2 text-right">{money(r.stock_value)}</td>
                          <td className="py-1.5 pl-2 text-right text-muted">{r.last_sold_at ? new Date(r.last_sold_at).toLocaleDateString('en-KE') : 'Never'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </>
      )}

      {/* ===================== STOCK ===================== */}
      {tab === 'stock' && !loading && (
        <Card className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-muted">Stock at cost</div>
              <div className="font-display text-2xl font-bold sm:text-3xl">KES {money(stockTotals.cost)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Stock at selling prices</div>
              <div className="font-display text-2xl font-bold sm:text-3xl">KES {money(stockTotals.retail)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Possible profit</div>
              <div className="font-display text-2xl font-bold text-emerald-300 sm:text-3xl">KES {money(stockTotals.retail - stockTotals.cost)}</div>
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => downloadCSV('stock-value.csv', [['Category', 'Products', 'Units', 'At cost', 'At selling prices'], ...stockRows.map((r) => [r.category, r.items, r.units, r.cost_value, r.retail_value])])}>
              {tr('downloadCsv', lang)}
            </Button>
          </div>
          {stockRows.length > 0 && (
            <HBars items={[...stockRows].sort((a, b) => Number(b.cost_value) - Number(a.cost_value)).map((r) => ({ label: r.category, value: Number(r.cost_value) }))} format={(v) => `KES ${money(v)}`} />
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1.5 pr-2 font-medium">Category</th>
                  <th className="px-2 py-1.5 text-right font-medium">Products</th>
                  <th className="px-2 py-1.5 text-right font-medium">Units</th>
                  <th className="px-2 py-1.5 text-right font-medium">At cost</th>
                  <th className="py-1.5 pl-2 text-right font-medium">At selling prices</th>
                </tr>
              </thead>
              <tbody>
                {stockRows.map((r) => (
                  <tr key={r.category} className="border-t border-charcoal-3">
                    <td className="py-1.5 pr-2">{r.category}</td>
                    <td className="px-2 text-right">{r.items}</td>
                    <td className="px-2 text-right">{fmtQty(r.units)}</td>
                    <td className="px-2 text-right">{money(r.cost_value)}</td>
                    <td className="py-1.5 pl-2 text-right">{money(r.retail_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Items with no buying price count as KES 0 at cost. Add buying prices on the products to make this accurate.</p>
        </Card>
      )}

      {/* ===================== TEAM ===================== */}
      {tab === 'team' && !loading && (
        <>
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold">Sales by staff</h2>
              <Button variant="ghost" onClick={() => downloadCSV(`staff-${from}-to-${to}.csv`, [['Staff', 'Sales', 'Total', 'Discounts given', 'Cancelled', 'Offline needing a check'], ...staff.map((r) => [names[r.user_id] ?? 'Staff', r.sales_count, r.revenue, r.discounts, r.voided, r.flagged])])}>
                {tr('downloadCsv', lang)}
              </Button>
            </div>
            {staff.length === 0 ? (
              <p className="text-sm text-muted">No sales in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">Staff</th>
                      <th className="px-2 py-1.5 text-right font-medium">Sales</th>
                      <th className="px-2 py-1.5 text-right font-medium">Total</th>
                      <th className="px-2 py-1.5 text-right font-medium">Discounts given</th>
                      <th className="px-2 py-1.5 text-right font-medium">Cancelled</th>
                      <th className="py-1.5 pl-2 text-right font-medium">To check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((r) => (
                      <tr key={r.user_id} className="border-t border-charcoal-3">
                        <td className="py-1.5 pr-2">{names[r.user_id] ?? 'Staff'}</td>
                        <td className="px-2 text-right">{r.sales_count}</td>
                        <td className="px-2 text-right">{money(r.revenue)}</td>
                        <td className="px-2 text-right">{money(r.discounts)}</td>
                        <td className={`px-2 text-right ${Number(r.voided) > 0 ? 'text-brand' : ''}`}>{r.voided}</td>
                        <td className={`py-1.5 pl-2 text-right ${Number(r.flagged) > 0 ? 'text-red-300' : ''}`}>{r.flagged}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted">Unusually many discounts or cancelled sales for one person are worth a look.</p>
          </Card>

          {branches.length > 1 && (
            <Card className="space-y-3">
              <h2 className="text-xl font-bold">Branches compared</h2>
              <HBars items={branchRows.map((r) => ({ label: r.name, value: Number(r.net_sales ?? 0) }))} format={(v) => `KES ${money(v)}`} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">Branch</th>
                      <th className="px-2 py-1.5 text-right font-medium">Sales</th>
                      <th className="px-2 py-1.5 text-right font-medium">Net sales</th>
                      <th className="px-2 py-1.5 text-right font-medium">Gross profit</th>
                      <th className="px-2 py-1.5 text-right font-medium">Expenses</th>
                      <th className="py-1.5 pl-2 text-right font-medium">Net profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branchRows.map((r) => (
                      <tr key={r.id} className="border-t border-charcoal-3">
                        <td className="py-1.5 pr-2">{r.name}</td>
                        <td className="px-2 text-right">{r.sales_count ?? 0}</td>
                        <td className="px-2 text-right">{money(r.net_sales)}</td>
                        <td className="px-2 text-right">{money(r.gross_profit)}</td>
                        <td className="px-2 text-right">{money(r.expenses)}</td>
                        <td className={`py-1.5 pl-2 text-right font-semibold ${Number(r.net_profit) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{money(r.net_profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
