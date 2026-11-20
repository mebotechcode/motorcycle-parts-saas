import Link from 'next/link'

const CONTACT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || ''

export default function SiteFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="border-t border-charcoal-3">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:flex-row">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/naf-icon.png" alt="" className="h-8 w-8 rounded-full" />
          <span>© {year} Naf Motor Spares · NafPOS</span>
        </div>
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-2">
          <Link href="/#features" className="hover:text-offwhite">
            Features
          </Link>
          <Link href="/#pricing" className="hover:text-offwhite">
            Pricing
          </Link>
          <Link href="/privacy" className="hover:text-offwhite">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-offwhite">
            Terms
          </Link>
          <Link href="/cookies" className="hover:text-offwhite">
            Cookies
          </Link>
          <Link href="/login" className="hover:text-offwhite">
            Sign in
          </Link>
          {CONTACT_EMAIL && (
            <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-offwhite">
              Contact
            </a>
          )}
        </div>
      </div>
    </footer>
  )
}
