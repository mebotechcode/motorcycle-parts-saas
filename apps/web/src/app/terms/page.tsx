import type { Metadata } from 'next'
import Link from 'next/link'
import LegalPage from '@/components/landing/LegalPage'

export const metadata: Metadata = {
  title: 'Terms of service',
  description: 'Terms for using NafPOS, the motorcycle spare parts point of sale for Kenya.',
  alternates: { canonical: '/terms' },
}

const SUPPORT = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || ''

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="18 November 2026">
      <p>
        These terms govern use of <b>NafPOS</b>, a point-of-sale and inventory service for motorcycle spare parts shops
        in Kenya. By creating an account or using the service you agree to them. They are a product agreement,{' '}
        <b>not legal advice</b>. NafPOS is a product name; until a company is registered under that name, the operator
        of this website is the contracting party.
      </p>

      <h2 className="text-xl font-bold text-offwhite">1. The service</h2>
      <p>
        NafPOS provides web-based tools for sales, stock, credit (deni), staff, M-Pesa requests and related reports. We
        may improve or change features. Some capabilities (live KRA eTIMS signing, live M-Pesa) depend on third parties
        (KRA, Safaricom) onboarding you and on you configuring them correctly.
      </p>

      <h2 className="text-xl font-bold text-offwhite">2. Accounts and shops</h2>
      <p>
        You must provide accurate details and keep your password confidential. Each shop (tenant) is responsible for
        its staff accounts and for what those staff do in the till. You must not attempt to access another shop’s data.
        The platform operator may use a separate operator account that cannot edit shop sales or stock.
      </p>

      <h2 className="text-xl font-bold text-offwhite">3. Trial and fees</h2>
      <p>
        New shops receive a 14-day trial unless we agree otherwise. After the trial, continued use requires an active
        paid plan in Kenya shillings (KES), billed monthly as shown on the pricing page. Payment is typically by
        M-Pesa. If an invoice is unpaid past any grace period we may set the shop to read-only or suspend access. Fees
        already paid are not refundable except where Kenyan law requires it.
      </p>

      <h2 className="text-xl font-bold text-offwhite">4. Your data</h2>
      <p>
        You own the business records you enter (products, sales, customers). You grant us a licence to host and process
        them solely to provide, secure and support NafPOS. You must have a lawful reason to store customer phone numbers
        and credit records. See the{' '}
        <Link href="/privacy" className="text-brand hover:underline">
          privacy policy
        </Link>
        .
      </p>

      <h2 className="text-xl font-bold text-offwhite">5. Acceptable use</h2>
      <p>
        Do not misuse the service: no probing other shops, no uploading malware, no using NafPOS for unlawful trade, and
        no reselling the service as if it were your own product without our written consent.
      </p>

      <h2 className="text-xl font-bold text-offwhite">6. Availability</h2>
      <p>
        We aim for the service to be available, and the till is designed to keep selling when the internet drops, then
        sync. We do not warrant uninterrupted access. You should keep your own backups of critical records if your
        business requires it.
      </p>

      <h2 className="text-xl font-bold text-offwhite">7. Liability</h2>
      <p>
        NafPOS is a tool. You remain responsible for prices charged, stock on the shelf, tax filings and M-Pesa
        reconciliation in the shop. To the extent allowed by Kenyan law, we are not liable for lost profits, lost stock,
        or indirect loss, and our total liability for a claim is limited to the subscription fees you paid us in the
        three months before the claim.
      </p>

      <h2 className="text-xl font-bold text-offwhite">8. Suspension and closure</h2>
      <p>
        We may suspend or close a shop for unpaid fees, abuse, or legal risk. You may stop using the service at any
        time. After closure we may retain records as described in the privacy policy.
      </p>

      <h2 className="text-xl font-bold text-offwhite">9. Law</h2>
      <p>
        These terms are governed by the laws of Kenya. Courts in Nairobi have jurisdiction, without limiting any
        mandatory consumer protections that apply.
      </p>

      <h2 className="text-xl font-bold text-offwhite">10. Contact</h2>
      <p>
        {SUPPORT ? (
          <>
            Questions:{' '}
            <a href={`mailto:${SUPPORT}`} className="text-brand hover:underline">
              {SUPPORT}
            </a>
            .
          </>
        ) : (
          'A contact email will be published on this site when available.'
        )}{' '}
        Related:{' '}
        <Link href="/privacy" className="text-brand hover:underline">
          Privacy
        </Link>
        {' · '}
        <Link href="/cookies" className="text-brand hover:underline">
          Cookies
        </Link>
        .
      </p>
    </LegalPage>
  )
}
