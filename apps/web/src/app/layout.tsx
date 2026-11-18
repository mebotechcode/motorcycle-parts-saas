import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import './globals.css'
import type { Metadata, Viewport } from 'next'
import { SessionProvider } from '@/lib/session'
import RegisterSW from '@/components/RegisterSW'
import CookieNotice from '@/components/CookieNotice'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: 'NafPOS — Motor Spares POS for Kenya | Sell Fast, Even Offline',
    template: '%s | NafPOS',
  },
  description:
    'Offline-first point of sale, inventory, credit (deni) and M-Pesa for Kenyan motorcycle spare parts shops. Parts search by slang, boda boda debtors, KRA eTIMS receipts, EN/Kiswahili. 14-day free trial.',
  applicationName: 'NafPOS',
  manifest: '/manifest.webmanifest',
  icons: { apple: '/icon-192.png' },
  keywords: [
    'POS Kenya', 'motorcycle spare parts software', 'boda boda shop POS', 'spare parts inventory Kenya',
    'M-Pesa POS', 'eTIMS software Kenya', 'deni management', 'duka POS Nairobi', 'sehemu za pikipiki',
  ],
  openGraph: {
    type: 'website',
    siteName: 'NafPOS',
    locale: 'en_KE',
    alternateLocale: 'sw_KE',
    url: SITE,
    title: 'NafPOS — Motor Spares POS for Kenya',
    description:
      'Stock, sales, credit (deni), M-Pesa and staff in one simple system, built for Kenyan motorcycle parts shops. Works offline. 14-day free trial.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'NafPOS — run your spare parts shop with confidence' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NafPOS — Motor Spares POS for Kenya',
    description: 'Offline-first POS, inventory, credit and M-Pesa for Kenyan motorcycle spare parts shops.',
    images: ['/og.png'],
  },
  robots: { index: true, follow: true },
  // Set NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION in Vercel to verify Search Console
  ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { verification: { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION } }
    : {}),
}

export const viewport: Viewport = {
  themeColor: '#111214',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          {children}
          <CookieNotice />
        </SessionProvider>
        <RegisterSW />
      </body>
    </html>
  )
}
