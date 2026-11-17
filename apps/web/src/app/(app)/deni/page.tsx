import { redirect } from 'next/navigation'

// The deni ledger is the customers list pre-filtered to whoever owes you.
// A real route so the sidebar can highlight it correctly.
export default function DeniPage() {
  redirect('/customers?filter=owing')
}
