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
    default: 'Naf Motor Spares | NafPOS — Motorcycle spare parts, Kenya',
    template: '%s | Naf Motor Spares',
  },
  description:
    'Naf Motor Spares (NafPOS) — motorcycle spare parts shop in Kenya, and the POS we built for stock, sales, credit (deni) and M-Pesa. Works offline. 14-day free trial.',
  applicationName: 'NafPOS',
  manifest: '/manifest.webmanifest',
  icons: { apple: '/icon-192.png' },
  keywords: [
    'Naf Motor Spares', 'Naf motors', 'Naf motor spares Nairobi', 'NafPOS',
    'POS Kenya', 'motorcycle spare parts software', 'boda boda shop POS', 'spare parts inventory Kenya',
    'M-Pesa POS', 'eTIMS software Kenya', 'deni management', 'duka POS Nairobi', 'sehemu za pikipiki',
  ],
  openGraph: {
    type: 'website',
    siteName: 'Naf Motor Spares',
    locale: 'en_KE',
    alternateLocale: 'sw_KE',
    url: SITE,
    title: 'Naf Motor Spares | NafPOS — Motorcycle spare parts, Kenya',
    description:
      'Naf Motor Spares in Kenya. Stock, sales, credit (deni) and M-Pesa with NafPOS. Works offline.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Naf Motor Spares — NafPOS' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Naf Motor Spares | NafPOS',
    description: 'Motorcycle spare parts shop in Kenya, and NafPOS for stock, sales, credit and M-Pesa.',
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
