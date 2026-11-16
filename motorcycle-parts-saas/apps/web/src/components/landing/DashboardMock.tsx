// A picture of what the dashboard will look like. All numbers are SAMPLE data.
export default function DashboardMock() {
  const bars = [38, 55, 42, 70, 62, 88, 74]
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-charcoal-3 bg-charcoal-2 p-4 shadow-2xl shadow-black/50">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-display text-lg font-bold uppercase">Today</div>
        <span className="rounded-md bg-brand/15 px-2 py-0.5 text-xs font-semibold text-brand">NRB branch</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-charcoal p-3">
          <div className="text-xs text-muted">Sales</div>
          <div className="font-display text-2xl font-bold">KES 48,250</div>
        </div>
        <div className="rounded-xl bg-charcoal p-3">
          <div className="text-xs text-muted">Profit</div>
          <div className="font-display text-2xl font-bold text-brand">KES 11,900</div>
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-charcoal p-3">
        <div className="mb-2 text-xs text-muted">Last 7 days</div>
        <div className="flex h-24 items-end gap-2">
          {bars.map((h, i) => (
            <div key={i} className="flex-1 rounded-t bg-brand/80" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>

      <div className="mt-3 space-y-2 rounded-xl bg-charcoal p-3 text-sm">
        <div className="text-xs text-muted">Running low</div>
        {[
          ['Brake pads - Boxer BM100', '3 left'],
          ['Chain set - TVS HLX 125', '2 left'],
          ['Spark plug', '6 left'],
        ].map(([n, q]) => (
          <div key={n} className="flex justify-between">
            <span className="truncate pr-2">{n}</span>
            <span className="shrink-0 font-semibold text-brand">{q}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 text-center text-[11px] text-muted">Illustration with sample data</div>
    </div>
  )
}
