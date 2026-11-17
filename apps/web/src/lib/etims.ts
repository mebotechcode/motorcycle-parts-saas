// KRA eTIMS helpers: QR payload, queue status, receipt lines.
// The QR encodes the KRA verification string (PIN|CU|receipt|total|date).
// We render it with the public QR image service when online; offline
// receipts show the payload as text so the sale is never blocked.

export function etimsQrUrl(payload: string | null | undefined, size = 140): string | null {
  if (!payload) return null
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=4&data=${encodeURIComponent(payload)}`
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
