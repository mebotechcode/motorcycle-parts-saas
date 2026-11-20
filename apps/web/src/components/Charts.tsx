'use client'

import { useState } from 'react'

// Lightweight zero-dependency SVG charts for the reports pages.
// They render on the client only, work offline, and use fixed brand
// colours so print and dark mode both look right.
const BRAND = '#FF5B14'
const MUTED = '#9A9A99'
const GRID = '#26292D'
const GOOD = '#34D399'
const BAD = '#F87171'

export type VPoint = { label: string; value: number; color?: string; hint?: string }

/** Vertical bar chart with day labels, hover values, and a max-value gridline. */
export function VBars({ points, format }: { points: VPoint[]; format?: (v: number) => string }) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  if (points.length === 0) return <p className="text-sm text-muted">No data in this period.</p>
  const max = Math.max(...points.map((p) => Math.max(p.value, 0)), 1)
  const fmt = format ?? ((v: number) => String(v))
  const step = points.length > 20 ? Math.ceil(points.length / 20) : 1
  const width = Math.max(points.length * 34, 320)

  const show = (i: number, x: number, y: number) => setHover({ i, x, y })

  return (
    <div className="relative w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} 170`}
        className="h-44 w-full min-w-max"
        role="img"
        aria-label="Bar chart"
        onPointerLeave={() => setHover(null)}
      >
        <line x1="0" y1="24" x2="100%" y2="24" stroke={GRID} strokeDasharray="4 4" />
        <text x="0" y="16" fill={MUTED} fontSize="10">
          {fmt(max)}
        </text>
        {points.map((p, i) => {
          const h = Math.max(2, (Math.max(p.value, 0) / max) * 108)
          const x = i * 34 + 4
          const y = 132 - h
          const active = hover?.i === i
          return (
            <g
              key={i}
              className="cursor-pointer"
              onPointerEnter={(e) => show(i, e.clientX, e.clientY)}
              onPointerMove={(e) => show(i, e.clientX, e.clientY)}
            >
              {/* Tall hit area so short bars are easy to hover or tap. */}
              <rect x={x} y={24} width="26" height="108" fill="transparent" />
              <rect
                x={x}
                y={y}
                width="26"
                height={h}
                rx="3"
                fill={p.color ?? BRAND}
                opacity={hover === null || active ? 1 : 0.4}
              />
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
      {hover && points[hover.i] && (
        <ChartTip
          x={hover.x}
          y={hover.y}
          label={points[hover.i].label}
          value={fmt(points[hover.i].value)}
          hint={points[hover.i].hint}
        />
      )}
    </div>
  )
}

function ChartTip({
  x,
  y,
  label,
  value,
  hint,
}: {
  x: number
  y: number
  label: string
  value: string
  hint?: string
}) {
  const maxLeft = typeof window !== 'undefined' ? window.innerWidth - 12 : 400
  return (
    <div
      className="pointer-events-none fixed z-[60] max-w-[16rem] rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2 text-left shadow-lg"
      style={{
        left: Math.min(x + 14, maxLeft - 168),
        top: Math.max(8, y - 64),
      }}
    >
      <div className="text-xs font-medium text-offwhite">{label}</div>
      <div className="font-display text-sm font-bold text-brand">{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  )
}

export type HItem = { label: string; value: number; hint?: string }

/** Horizontal bar list — good for top products / branch comparison. */
export function HBars({ items, format, maxItems = 10 }: { items: HItem[]; format?: (v: number) => string; maxItems?: number }) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const shown = items.filter((i) => Number.isFinite(i.value)).slice(0, maxItems)
  if (shown.length === 0) return <p className="text-sm text-muted">No data in this period.</p>
  const max = Math.max(...shown.map((i) => Math.max(i.value, 0)), 1)
  const fmt = format ?? ((v: number) => String(v))
  const active = hover ? shown[hover.i] : null
  return (
    <div className="space-y-1.5" onPointerLeave={() => setHover(null)}>
      {shown.map((item, i) => (
        <div
          key={item.label}
          className="flex cursor-pointer items-center gap-3 text-sm"
          onPointerEnter={(e) => setHover({ i, x: e.clientX, y: e.clientY })}
          onPointerMove={(e) => setHover({ i, x: e.clientX, y: e.clientY })}
        >
          <div className="w-40 shrink-0 truncate">{item.label}</div>
          <div className="h-4 flex-1 overflow-hidden rounded bg-charcoal-3">
            <div
              className="h-full rounded bg-brand"
              style={{
                width: `${(Math.max(item.value, 0) / max) * 100}%`,
                opacity: hover === null || hover.i === i ? 1 : 0.4,
              }}
            />
          </div>
          <div className={`w-28 shrink-0 text-right tabular-nums ${hover?.i === i ? 'text-brand' : ''}`}>{fmt(item.value)}</div>
        </div>
      ))}
      {hover && active && <ChartTip x={hover.x} y={hover.y} label={active.label} value={fmt(active.value)} hint={active.hint} />}
    </div>
  )
}

/** Break-even colour helper: profit vs loss bar colour. */
export function pnlColor(v: number) {
  return v >= 0 ? GOOD : BAD
}
