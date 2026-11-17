'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui'

// Camera barcode scanner for the POS and the product form.
// Uses the native BarcodeDetector API where available (Chrome/Android);
// falls back to ZXing (e.g. iOS Safari), loaded on demand.
// Calls onDetect(code) exactly once per scan session.
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar', 'qr_code'] as const

export default function CameraScanner({ onDetect, onClose }: { onDetect: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const doneRef = useRef(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let stopped = false
    let raf = 0
    let stream: MediaStream | null = null
    let zxing: { reset: () => void } | null = null

    const finish = (code: string) => {
      if (doneRef.current || !code) return
      doneRef.current = true
      onDetect(code)
    }

    async function start() {
      const BD = (window as any).BarcodeDetector as undefined | (new (opts: any) => any)
      if (BD) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
          if (stopped) return
          video!.srcObject = stream
          await video!.play()
          const det = new BD({ formats: [...FORMATS] })
          const tick = async () => {
            if (stopped || doneRef.current) return
            try {
              const codes = await det.detect(video!)
              if (codes && codes.length > 0) {
                finish(String(codes[0].rawValue ?? '').trim())
                return
              }
            } catch {
              // keep looking
            }
            raf = requestAnimationFrame(tick)
          }
          raf = requestAnimationFrame(tick)
          return
        } catch {
          // fall through to ZXing with a clear message if the camera is blocked
          setError('Camera blocked or not found. Allow camera access, or use a USB scanner / type the code.')
          return
        }
      }
      // Fallback: ZXing (works everywhere getUserMedia does, incl. iOS Safari)
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        if (stopped) return
        const reader = new BrowserMultiFormatReader() as any
        zxing = reader
        await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video!, (result: any) => {
          if (result) finish(String(result.getText?.() ?? '').trim())
        })
      } catch {
        setError('Camera scanning is not supported on this phone/browser. Use a USB scanner or type the code.')
      }
    }

    start()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      try {
        zxing?.reset()
      } catch {}
      try {
        stream?.getTracks().forEach((t) => t.stop())
      } catch {}
      try {
        video.srcObject = null
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-charcoal p-4" role="dialog" aria-modal="true" aria-label="Scan a barcode">
      <div className="mx-auto flex w-full max-w-lg items-center justify-between py-2">
        <h2 className="font-display text-xl font-bold uppercase">Scan a barcode</h2>
        <button type="button" onClick={onClose} aria-label="Close scanner" className="rounded-lg p-2 text-muted hover:bg-charcoal-3 hover:text-offwhite">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {error ? (
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-4 text-center">
          <p className="text-red-300">{error}</p>
          <Button onClick={onClose}>Close</Button>
        </div>
      ) : (
        <>
          <div className="relative mx-auto w-full max-w-lg flex-1 overflow-hidden rounded-2xl border border-charcoal-3 bg-black">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-40 w-72 rounded-xl border-2 border-brand/80" />
            </div>
          </div>
          <p className="mx-auto w-full max-w-lg py-3 text-center text-sm text-muted">Point the camera at the barcode — it reads automatically.</p>
        </>
      )}
    </div>
  )
}
