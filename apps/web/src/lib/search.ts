// Offline-first part search: name, SKU, part number, barcode, brand,
// Kenyan slang aliases (kenda, coil, piston ring...) and bike fit.
// Runs entirely on the device copy so it is instant and works offline.

export type SearchableProduct = {
  id: string
  name: string
  sku: string
  part_number?: string | null
  brand_name?: string | null
  barcodes?: string[]
  aliases?: string[]
  bike_model_ids?: string[]
  bike_names?: string[] // optional: "Bajaj Boxer BM100" strings for text search
  is_active: boolean
  deleted_at?: string | null
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

export function productHaystack(p: SearchableProduct): string {
  const parts = [p.name, p.sku, p.part_number ?? '', p.brand_name ?? '', ...(p.aliases ?? []), ...(p.bike_names ?? [])]
  return norm(parts.join(' '))
}

function runQuery<T extends SearchableProduct>(products: T[], q: string, limit: number): T[] {
  const query = norm(q)
  const words = query.split(' ').filter(Boolean)
  if (words.length === 0) return []
  const scored: { p: T; score: number }[] = []
  for (const p of products) {
    if (!p.is_active || p.deleted_at) continue
    const hay = productHaystack(p)
    if (!words.every((w) => hay.includes(w))) continue
    // Rank: name start > name contains > alias > sku/part
    let score = 0
    const name = norm(p.name)
    if (name.startsWith(query)) score += 50
    else if (name.includes(query)) score += 30
    if ((p.aliases ?? []).some((a) => norm(a).includes(query))) score += 20
    if (norm(p.sku).includes(query) || norm(p.part_number ?? '').includes(query)) score += 10
    scored.push({ p, score })
  }
  scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
  return scored.slice(0, limit).map((x) => x.p)
}

// Slang fallback: each searched word expands to alternatives, and a product
// matches when EVERY word has at least one alternative present (OR within a
// word, AND across words). "kenda" matches anything with tyre or tire.
function runSlangQuery<T extends SearchableProduct>(products: T[], q: string, limit: number): T[] {
  const groups = norm(q).split(' ').filter(Boolean).map((w) => (SLANG[w] ? SLANG[w].split(' ') : [w]))
  if (groups.length === 0) return []
  const scored: { p: T; score: number }[] = []
  for (const p of products) {
    if (!p.is_active || p.deleted_at) continue
    const hay = productHaystack(p)
    if (!groups.every((g) => g.some((alt) => hay.includes(alt)))) continue
    let score = 0
    const name = norm(p.name)
    if (name.startsWith(norm(q))) score += 50
    if ((p.aliases ?? []).some((a) => norm(a).includes(norm(q)))) score += 20
    scored.push({ p, score })
  }
  scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
  return scored.slice(0, limit).map((x) => x.p)
}

export function searchProducts<T extends SearchableProduct>(products: T[], raw: string, limit = 12): T[] {
  const q = raw.trim()
  if (q.length < 2) return []
  // Exact barcode wins immediately
  const exact = products.find((p) => p.is_active && !p.deleted_at && p.barcodes?.includes(q))
  if (exact) return [exact]

  const direct = runQuery(products, q, limit)
  if (direct.length) return direct
  // Fall back to Kenyan mechanic slang (kenda -> tyre/tire, coil -> ignition coil, ...)
  return runSlangQuery(products, q, limit)
}

export function binLabel(p: { aisle?: string | null; rack?: string | null; bin?: string | null; shelf_location?: string | null }): string {
  const parts = [p.aisle ? `Aisle ${p.aisle}` : '', p.rack ? `Rack ${p.rack}` : '', p.bin ? `Box ${p.bin}` : '']
    .filter(Boolean)
  if (parts.length) return parts.join(' · ')
  return p.shelf_location ?? ''
}

// Common Kenyan mechanic slang -> canonical terms (used to expand queries)
export const SLANG: Record<string, string> = {
  kenda: 'tyre tire',
  coil: 'ignition coil',
  piston: 'piston kit',
  ring: 'piston ring',
  sprocket: 'chain sprocket',
  kickstarter: 'kick starter',
  kick: 'kick starter',
  plug: 'spark plug',
  battery: 'battery',
  brake: 'brake pad',
  pad: 'brake pad',
  shoe: 'brake shoe',
  cable: 'cable',
  clutch: 'clutch plate',
  plate: 'clutch plate',
  mirror: 'mirror',
  headlight: 'headlamp',
  tail: 'tail light',
  shock: 'shock absorber',
  fork: 'front fork',
  bearing: 'bearing',
  seal: 'oil seal',
  gasket: 'gasket',
  filter: 'oil filter air filter',
  chain: 'chain kit',
  tyre: 'tyre',
  tube: 'inner tube',
}

export function expandSlang(q: string): string {
  const words = norm(q).split(' ')
  const out: string[] = []
  for (const w of words) out.push(SLANG[w] ?? w)
  return out.join(' ')
}
