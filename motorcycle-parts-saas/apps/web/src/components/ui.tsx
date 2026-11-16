'use client'

import React from 'react'
import Link from 'next/link'

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const base =
    'inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50'
  const styles = {
    primary: 'bg-brand text-charcoal hover:bg-brand-hover',
    ghost: 'border border-charcoal-3 text-offwhite hover:bg-charcoal-3',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  }
  return <button className={`${base} ${styles[variant]} ${className}`} {...props} />
}

export function Field({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-muted">{label}</span>
      <input
        className="w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2.5 text-offwhite placeholder:text-muted/60 focus:border-brand focus:outline-none"
        {...props}
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function Select({
  label,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  const select = (
    <select
      className="w-full rounded-lg border border-charcoal-3 bg-charcoal px-3 py-2.5 text-offwhite focus:border-brand focus:outline-none"
      {...props}
    >
      {children}
    </select>
  )
  if (!label) return select
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-muted">{label}</span>
      {select}
    </label>
  )
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-charcoal-3 bg-charcoal-2 p-5 ${className}`}>{children}</div>
  )
}

export function Alert({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'success' | 'info'
  children: React.ReactNode
}) {
  const styles = {
    error: 'border-red-500/40 bg-red-500/10 text-red-200',
    success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    info: 'border-brand/40 bg-brand/10 text-offwhite',
  }
  return <div className={`rounded-lg border px-3 py-2.5 text-sm ${styles[kind]}`}>{children}</div>
}

export function Spinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-muted">
      <span className="mr-3 inline-block h-5 w-5 animate-spin rounded-full border-2 border-charcoal-3 border-t-brand" />
      {label}
    </div>
  )
}

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <Link href="/" aria-label="Back to home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/naf-logo.png" alt="Naf's Motor Spares" className="mx-auto mb-2 h-40 w-auto sm:h-44" />
        </Link>
        <div className="rounded-2xl border border-charcoal-3 bg-charcoal-2 p-6">
          <h1 className="text-3xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </main>
  )
}
