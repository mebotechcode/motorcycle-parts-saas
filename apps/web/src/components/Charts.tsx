// Lightweight zero-dependency SVG charts for the reports pages.
// They render on the client only (pages are 'use client'), work offline,
// and use fixed brand colours so print and dark mode both look right.
const BRAND = '#FF5B14'
const MUTED = '#9A9A99'
const GRID = '#26292D'
const GOOD = '#34D399'
const BAD = '#F87171'

export type VPoint = { label: string; value: number; color?: string }

/** Vertical bar chart with day labels and a max-value gridline. */
export function VBars({ points, format }: { points: VPoint[]; format?: (v: number) => string }) {
  if (points.length === 0) return <p className="text-sm text-muted">No data in this period.</p>
  const max = Math.max(...points.map((p) => Math.max(p.value, 0)), 1)
  const fmt = format ?? ((v: number) => String(v))
  const step = points.length > 20 ? Math.ceil(points.length / 20) : 1
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${Math.max(points.length * 34, 320)} 170`} className="h-44 w-full min-w-max" role="img" aria-label="Bar chart">
        {/* gridline at max */}
        <line x1="0" y1="24" x2="100%" y2="24" stroke={GRID} strokeDasharray="4 4" />
        <text x="0" y="16" fill={MUTED} fontSize="10">{fmt(max)}</text>
        {points.map((p, i) => {
          const h = Math.max(2, (Math.max(p.value, 0) / max) * 108)
          const x = i * 34 + 4
          const y = 132 - h
          return (
            <g key={i}>
              <rect x={x} y={y} width="26" height={h} rx="3" fill={p.color ?? BRAND} opacity={0.9}>
                <title>{`${p.label}: ${fmt(p.value)}`}</title>
              </rect>
              {i % step === 0 && (
                <text x={x + 13} y="146" fill={MUTED} fontSize="8" textAnchor="middle">
                  {p.label.slice(0, 6)}
                </text>
              )}
            </g>
          )
        })}
        <line x1="0" y1="132" x2="100%" y2="132" stroke={GRID} />
      </svg>
    </div>
  )
}

export type HItem = { label: string; value: number; hint?: string }

/** Horizontal bar list — good for top products / branch comparison. */
export function HBars({ items, format, maxItems = 10 }: { items: HItem[]; format?: (v: number) => string; maxItems?: number }) {
  const shown = items.filter((i) => Number.isFinite(i.value)).slice(0, maxItems)
  if (shown.length === 0) return <p className="text-sm text-muted">No data in this period.</p>
  const max = Math.max(...shown.map((i) => Math.max(i.value, 0)), 1)
  const fmt = format ?? ((v: number) => String(v))
  return (
    <div className="space-y-1.5">
      {shown.map((item) => (
        <div key={item.label} className="flex items-center gap-3 text-sm">
          <div className="w-40 shrink-0 truncate" title={item.label}>
            {item.label}
          </div>
          <div className="h-4 flex-1 overflow-hidden rounded bg-charcoal-3">
            <div className="h-full rounded bg-brand" style={{ width: `${(Math.max(item.value, 0) / max) * 100}%` }} />
          </div>
          <div className="w-28 shrink-0 text-right tabular-nums">{fmt(item.value)}</div>
        </div>
      ))}
    </div>
  )
}

/** Break-even colour helper: profit vs loss bar colour. */
export function pnlColor(v: number) {
  return v >= 0 ? GOOD : BAD
}
