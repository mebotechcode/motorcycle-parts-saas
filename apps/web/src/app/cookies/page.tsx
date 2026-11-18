import type { Metadata } from 'next'
import Link from 'next/link'
import LegalPage from '@/components/landing/LegalPage'

export const metadata: Metadata = {
  title: 'Cookie policy',
  description: 'Essential cookies and local storage used by NafPOS. No advertising cookies.',
  alternates: { canonical: '/cookies' },
}

export default function CookiesPage() {
  return (
    <LegalPage title="Cookie policy" updated="18 November 2026">
      <p>
        NafPOS uses a small amount of storage on your device so the till can sign you in and remember your settings. We
        do <b>not</b> use advertising cookies and we do not run third-party marketing pixels. This page is a product
        disclosure, not legal advice.
      </p>

      <h2 className="text-xl font-bold text-offwhite">Essential cookies and similar storage</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-2 pr-3 font-medium">Name / place</th>
              <th className="px-3 py-2 font-medium">Purpose</th>
              <th className="py-2 pl-3 font-medium">Duration</th>
            </tr>
          </thead>
          <tbody className="text-muted">
            <tr className="border-t border-charcoal-3">
              <td className="py-2 pr-3 text-offwhite">Supabase auth cookies</td>
              <td className="px-3 py-2">Keep you signed in securely</td>
              <td className="py-2 pl-3">Session / refresh token lifetime</td>
            </tr>
            <tr className="border-t border-charcoal-3">
              <td className="py-2 pr-3 text-offwhite">Language (localStorage)</td>
              <td className="px-3 py-2">Remember English or Kiswahili on this device</td>
              <td className="py-2 pl-3">Until you clear site data</td>
            </tr>
            <tr className="border-t border-charcoal-3">
              <td className="py-2 pr-3 text-offwhite">Till cart / branch (localStorage)</td>
              <td className="px-3 py-2">Keep an unfinished sale if the page reloads</td>
              <td className="py-2 pl-3">Until you complete or clear the sale</td>
            </tr>
            <tr className="border-t border-charcoal-3">
              <td className="py-2 pr-3 text-offwhite">PWA / service worker cache</td>
              <td className="px-3 py-2">Let the till work when the internet drops</td>
              <td className="py-2 pl-3">Until you clear the app or cache</td>
            </tr>
            <tr className="border-t border-charcoal-3">
              <td className="py-2 pr-3 text-offwhite">Cookie notice (localStorage)</td>
              <td className="px-3 py-2">Remember that you dismissed this notice</td>
              <td className="py-2 pl-3">Until you clear site data</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="text-xl font-bold text-offwhite">Consent</h2>
      <p>
        These items are required for the service to function (sign-in, language, offline till). Kenyan law does not
        require a separate “accept marketing cookies” step for essential storage of this kind. If we later add optional
        analytics, we will ask before setting those cookies and update this page.
      </p>

      <h2 className="text-xl font-bold text-offwhite">How to clear</h2>
      <p>
        In your browser: clear cookies and site data for this domain, or use the browser’s site settings. On a phone
        where NafPOS was added to the home screen, you can also clear the app’s storage from system settings. Clearing
        will sign you out.
      </p>

      <p>
        See also{' '}
        <Link href="/privacy" className="text-brand hover:underline">
          Privacy
        </Link>
        {' and '}
        <Link href="/terms" className="text-brand hover:underline">
          Terms
        </Link>
        .
      </p>
    </LegalPage>
  )
}
