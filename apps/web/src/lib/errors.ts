// Turn browser / Supabase / edge-function failures into shop-floor English.
export function friendlyError(raw: unknown): string {
  const msg = extract(raw)
  const lower = msg.toLowerCase()
  if (!msg.trim()) return 'Something went wrong. Please try again.'

  if (
    /failed to fetch|networkerror|network request failed|load failed|err_internet|err_name_not_resolved|offline/.test(
      lower,
    )
  ) {
    return 'No internet connection. Check your data or Wi-Fi and try again.'
  }
  if (/edge function|non-2xx status|functions\/v1/.test(lower)) {
    return 'We could not complete that request. Please try again in a moment.'
  }
  if (/mpesa is not set up|missing daraja|daraja auth failed/.test(lower)) {
    return 'M-Pesa live payments are not switched on yet. You can still record the M-Pesa code on the sale.'
  }
  if (/invalid login credentials|invalid email or password/.test(lower)) {
    return 'Email or password is incorrect.'
  }
  if (/email not confirmed/.test(lower)) {
    return 'Please confirm your email, then sign in.'
  }
  if (/jwt expired|invalid jwt|session/.test(lower) && /expired|jwt/.test(lower)) {
    return 'Your session expired. Sign in again.'
  }
  if (msg.length > 180 || /pgrst|row-level security|22p02|42703/.test(lower)) {
    return 'Something went wrong. Please try again.'
  }
  return msg
}

function extract(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object') {
    const o = raw as { message?: unknown; error?: unknown }
    if (typeof o.message === 'string') return o.message
    if (typeof o.error === 'string') return o.error
  }
  return String(raw)
}
