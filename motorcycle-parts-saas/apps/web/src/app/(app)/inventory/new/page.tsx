'use client'

import Link from 'next/link'
import { useSession } from '@/lib/session'
import { Alert } from '@/components/ui'
import { canEditInventory } from '@/lib/inventory'
import ProductForm from '@/components/inventory/ProductForm'

export default function NewProductPage() {
  const { claims } = useSession()
  if (!canEditInventory(claims.tenant_role)) {
    return <Alert kind="info">Only the owner, managers and storekeepers can add products.</Alert>
  }
  return (
    <div className="space-y-4">
      <Link href="/inventory" className="text-sm text-muted hover:text-offwhite">
        ← Back to inventory
      </Link>
      <h1 className="text-4xl font-bold">Add product</h1>
      <ProductForm />
    </div>
  )
}
