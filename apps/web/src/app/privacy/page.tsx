import type { Metadata } from 'next'
import Link from 'next/link'
import LegalPage from '@/components/landing/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'How NafPOS collects, uses and protects information for Kenyan motorcycle spare parts shops.',
  alternates: { canonical: '/privacy' },
}

const SUPPORT = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || ''

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="18 November 2026">
      <p>
        This policy explains how the operator of <b>NafPOS</b> (“we”, “us”) handles information when you visit the
        website, create an account or use the point-of-sale service. It is written so you can decide whether to sign
        up. It is <b>not legal advice</b> and does not mean we are registered with Kenya’s Office of the Data Protection
        Commissioner (ODPC). We will update this page when a legal entity is registered and if ODPC registration
        becomes required.
      </p>

      <h2 className="text-xl font-bold text-offwhite">1. Who we are</h2>
      <p>
        NafPOS is a web application for motorcycle spare parts shops in Kenya: stock, sales, credit (deni), M-Pesa and
        staff. Until a company is incorporated under this name, the service is operated by the person who publishes
        this site.
        {SUPPORT ? (
          <>
            {' '}
            Privacy questions: <a href={`mailto:${SUPPORT}`} className="text-brand hover:underline">{SUPPORT}</a>.
          </>
        ) : (
          ' Contact details will appear here once a support email is published.'
        )}
      </p>

      <h2 className="text-xl font-bold text-offwhite">2. Information we collect</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <b>Account.</b> Name, email, password (stored hashed by our authentication provider), optional phone, language
          preference.
        </li>
        <li>
          <b>Shop records you enter.</b> Business name, branches, staff, products, sales, payments, customers, suppliers
          and related ledgers. That operational data belongs to the shop that created it.
        </li>
        <li>
          <b>Billing.</b> Plan, trial dates, subscription invoices and M-Pesa references needed to collect the NafPOS
          fee.
        </li>
        <li>
          <b>Device and security.</b> Sign-in IP address, user-agent (browser or phone), timestamps. Used to protect
          accounts and, for the platform operator, to review login activity.
        </li>
        <li>
          <b>Support notes.</b> If you contact us, we keep the message and any notes we add while helping you. Shop
          owners cannot see operator-only notes.
        </li>
      </ul>

      <h2 className="text-xl font-bold text-offwhite">3. Why we use it</h2>
      <p>
        To provide the service you asked for; to bill the subscription; to keep the system secure; to fix faults; and
        to meet Kenyan legal duties that apply to electronic records (including, when you enable it, KRA eTIMS
        transmission). We do not sell your information and we do not use it for advertising.
      </p>

      <h2 className="text-xl font-bold text-offwhite">4. Shop customer data (deni, receipts, phones)</h2>
      <p>
        When a shop records a rider, mechanic or other customer, <b>that shop is responsible</b> for that personal
        data (they decide what to store and why). NafPOS hosts it so the shop can run the till. We only access shop
        records as needed to operate, secure or support the service, or if Kenyan law requires it. We do not use one
        shop’s customers to market to another shop.
      </p>

      <h2 className="text-xl font-bold text-offwhite">5. Who we share with</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <b>Hosting and authentication.</b> Infrastructure providers that run the database, login and file storage
          (currently Supabase).
        </li>
        <li>
          <b>Safaricom / M-Pesa (Daraja)</b> when you send an STK Push or receive a till/paybill payment — phone and
          amount as required to complete the payment.
        </li>
        <li>
          <b>Kenya Revenue Authority eTIMS</b> only if you configure eTIMS and a receipt is transmitted.
        </li>
        <li>We do not share data with advertisers.</li>
      </ul>

      <h2 className="text-xl font-bold text-offwhite">6. Retention</h2>
      <p>
        Account and shop records are kept while the shop is active and for a reasonable period after closure so that
        sales and tax history can still be retrieved if you return or if the law requires it. Login IP logs are kept
        for security. You may ask us to delete an account; some records may need to be retained where Kenyan tax or
        accounting rules apply.
      </p>

      <h2 className="text-xl font-bold text-offwhite">7. Security</h2>
      <p>
        Access is limited by shop (tenant) and by role (owner, manager, cashier, storekeeper). Passwords are not stored
        in plain text. Connections use HTTPS. No system is perfectly secure; you must also choose a strong password and
        not share staff logins.
      </p>

      <h2 className="text-xl font-bold text-offwhite">8. Your rights (Kenya Data Protection Act, 2019)</h2>
      <p>
        You may ask to access, correct or delete personal data we hold about you as a NafPOS user, or to restrict
        processing, subject to the Act. Shop customers should contact the shop that served them first. We will respond
        within a reasonable time.
        {SUPPORT ? (
          <>
            {' '}
            Write to <a href={`mailto:${SUPPORT}`} className="text-brand hover:underline">{SUPPORT}</a>.
          </>
        ) : null}
      </p>

      <h2 className="text-xl font-bold text-offwhite">9. Children</h2>
      <p>NafPOS is a business tool. It is not directed at children under 18.</p>

      <h2 className="text-xl font-bold text-offwhite">10. Cookies</h2>
      <p>
        We use essential cookies and similar storage to keep you signed in and remember language. Details:{' '}
        <Link href="/cookies" className="text-brand hover:underline">
          Cookie policy
        </Link>
        .
      </p>

      <h2 className="text-xl font-bold text-offwhite">11. Changes</h2>
      <p>
        We may update this policy. The date at the top will change. Continued use after an update means you accept the
        revised policy.
      </p>
    </LegalPage>
  )
}
