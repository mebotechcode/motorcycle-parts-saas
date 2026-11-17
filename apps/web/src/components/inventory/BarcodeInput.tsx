'use client'

import { useState } from 'react'
import { Button } from '@/components/ui'
import CameraScanner from '@/components/CameraScanner'

// Type or scan a barcode, press Enter. (USB scanners type the number and press Enter for you.)
export default function BarcodeInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('')
  const [scanning, setScanning] = useState(false)

  function add(code?: string) {
    const v = (code ?? text).trim()
    if (!v) return
    if (!value.includes(v)) onChange([...value, v])
    setText('')
  }

  return (
    <div>
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {value.map((b) => (
            <span key={b} className="inline-flex items-center gap-1 rounded-lg bg-charcoal-3 px-2.5 py-1 text-sm">
              {b}
              <button type="button" aria-label={`Remove ${b}`} onClick={() => onChange(value.filter((x) => x !== b))} className="text-muted hover:text-offwhite">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add()
            }
          }}
          inputMode="text"
          placeholder="Scan or type a barcode, then press Enter"
          className="w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2.5 text-offwhite placeholder:text-muted/60 focus:border-brand focus:outline-none"
        />
        <Button type="button" variant="ghost" onClick={() => add()}>
          Add
        </Button>
        <Button type="button" variant="ghost" onClick={() => setScanning(true)} aria-label="Scan with camera">
          📷 Scan
        </Button>
      </div>
      {scanning && (
        <CameraScanner
          onDetect={(code) => {
            add(code)
            setScanning(false)
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  )
}
