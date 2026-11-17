// KRA eTIMS helpers: QR payload, queue status, receipt lines.
// The QR encodes the KRA verification string (PIN|CU|receipt|total|date).
// The QR is generated locally (no network call), so eTIMS receipts keep a
// scannable QR even when the shop is offline.
import qrcode from 'qrcode-generator'

// Returns a data: URL for the QR image, or null if the payload cannot be
// encoded (e.g. it is too long for the maximum QR size).
export function etimsQrDataUrl(payload: string | null | undefined, cellSize = 4, margin = 2): string | null {
  if (!payload) return null
  try {
    const qr = qrcode(0, 'M') // 0 = smallest fitting version, error correction M
    qr.addData(payload, 'Byte')
    qr.make()
    return qr.createDataURL(cellSize, margin)
  } catch {
    return null
  }
}

export function etimsQrPayload(sale: any, tenant: any): string {
  if (sale?.etims_qr_payload) return sale.etims_qr_payload
  const pin = tenant?.kra_pin ?? 'PIN'
  const cu = sale?.etims_cu_number ?? sale?.etims_invoice_no ?? sale?.receipt_no ?? ''
  return `${pin}|${cu}|${sale?.receipt_no ?? ''}|${sale?.total ?? ''}|${sale?.sold_at ?? ''}`
}

export const ETIMS_STATUS_LABEL: Record<string, string> = {
  not_required: 'Not required',
  pending: 'Queued for eTIMS',
  submitted: 'eTIMS submitted',
  failed: 'eTIMS failed — will retry',
}

export function receiptEtimsLines(sale: any): string[] {
  const lines: string[] = []
  if (sale?.etims_cu_number) lines.push(`CU Invoice No: ${sale.etims_cu_number}`)
  if (sale?.etims_receipt_signature) lines.push(`Signature: ${sale.etims_receipt_signature}`)
  if (sale?.etims_internal_data) lines.push(`Internal Data: ${sale.etims_internal_data}`)
  if (sale?.etims_status === 'pending') lines.push('eTIMS: queued (will transmit when online)')
  if (sale?.etims_status === 'failed') lines.push(`eTIMS: failed (${sale.etims_error ?? 'will retry'})`)
  return lines
}
