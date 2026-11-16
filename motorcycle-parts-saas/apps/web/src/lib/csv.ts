// Small CSV reader (handles quotes, commas / semicolons / tabs, Excel's BOM)

export function parseCSV(input: string): string[][] {
  let text = input
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delim = [',', ';', '\t']
    .map((d) => [d, firstLine.split(d).length] as [string, number])
    .sort((a, b) => b[1] - a[1])[0][0]

  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  const endRow = () => {
    row.push(cell)
    cell = ''
    if (row.some((x) => x.trim() !== '')) rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else inQuotes = false
      } else cell += c
    } else if (c === '"') inQuotes = true
    else if (c === delim) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      endRow()
    } else cell += c
  }
  if (cell !== '' || row.length > 0) endRow()
  return rows
}

// The columns we understand, and other names people use for them
export const FIELDS: { key: string; label: string; names: string[] }[] = [
  { key: 'sku', label: 'Code (SKU)', names: ['sku', 'code', 'product code', 'item code'] },
  { key: 'name', label: 'Name', names: ['name', 'product', 'product name', 'item', 'item name', 'description'] },
  { key: 'category', label: 'Category', names: ['category', 'group'] },
  { key: 'brand', label: 'Brand', names: ['brand'] },
  { key: 'quality', label: 'Quality', names: ['quality', 'grade', 'type'] },
  { key: 'part_number', label: 'Part number', names: ['part number', 'part no', 'part no.', 'partnumber', 'oem number', 'oem no'] },
  { key: 'unit', label: 'Unit', names: ['unit', 'uom'] },
  { key: 'selling_price', label: 'Selling price', names: ['selling price', 'price', 'retail price', 'retail', 'sell price'] },
  { key: 'wholesale_price', label: 'Wholesale price', names: ['wholesale price', 'wholesale'] },
  { key: 'cost_price', label: 'Buying price', names: ['buying price', 'cost price', 'cost', 'buy price'] },
  { key: 'min_price', label: 'Lowest price', names: ['lowest price', 'min price', 'minimum price', 'floor price'] },
  { key: 'reorder_level', label: 'Reorder level', names: ['reorder level', 'reorder', 'min stock', 'low stock'] },
  { key: 'opening_stock', label: 'Stock', names: ['stock', 'opening stock', 'quantity', 'qty', 'in stock'] },
  { key: 'barcode', label: 'Barcode', names: ['barcode', 'barcodes'] },
  { key: 'fits', label: 'Fits bikes', names: ['fits', 'bikes', 'bike models', 'compatible bikes', 'compatibility'] },
]

const norm = (h: string) => h.toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim()

export function mapHeaders(header: string[]) {
  const map: Record<number, string> = {}
  const unknown: string[] = []
  const used = new Set<string>()
  header.forEach((h, i) => {
    const n = norm(h)
    const f = FIELDS.find((x) => x.key.replace(/_/g, ' ') === n || x.names.includes(n))
    if (f && !used.has(f.key)) {
      map[i] = f.key
      used.add(f.key)
    } else if (h.trim() !== '') unknown.push(h.trim())
  })
  return { map, unknown, found: Array.from(used) }
}

const NUMERIC = ['selling_price', 'wholesale_price', 'cost_price', 'min_price', 'reorder_level', 'opening_stock']

// "KES 1,250" -> "1250"; returns null if it is not a valid non-negative number
export function cleanNumber(s: string): string | null {
  const t = s.replace(/kes|ksh\.?|sh\.?/gi, '').replace(/[\s,]/g, '')
  if (t === '') return ''
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? String(n) : null
}

export type ImportRow = Record<string, string> & { _row: number }

export function buildRows(table: string[][]) {
  const header = table[0] ?? []
  const { map, unknown, found } = mapHeaders(header)
  const rows: ImportRow[] = []
  const problems: { row: number; message: string }[] = []

  for (let i = 1; i < table.length; i++) {
    const rowNo = i + 1
    const obj: any = { _row: rowNo }
    let bad = ''
    Object.entries(map).forEach(([idx, key]) => {
      const raw = (table[i][Number(idx)] ?? '').trim()
      if (NUMERIC.includes(key)) {
        const c = cleanNumber(raw)
        if (c === null) bad = `"${raw}" is not a valid number for ${FIELDS.find((f) => f.key === key)?.label}`
        else obj[key] = c
      } else obj[key] = raw
    })
    if (!bad && !(obj.name ?? '').trim()) bad = 'The product name is missing'
    if (bad) problems.push({ row: rowNo, message: bad })
    else rows.push(obj)
  }
  return { rows, problems, unknown, found }
}

export const TEMPLATE_CSV =
  'sku,name,category,brand,quality,part_number,unit,selling_price,wholesale_price,cost_price,min_price,reorder_level,opening_stock,barcode,fits\n' +
  'BP-001,Brake pad set - Boxer BM100,Brakes,Bajaj,genuine,,set,650,600,420,550,5,12,,Bajaj Boxer BM100\n' +
  'SP-002,Spark plug,Electricals & Lighting,NGK,aftermarket,CR7HSA,pc,300,260,150,250,10,40,,Bajaj Boxer BM100; TVS HLX 125\n'
