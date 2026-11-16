import './globals.css'
import type { Metadata, Viewport } from 'next'
import { SessionProvider } from '@/lib/session'
import RegisterSW from '@/components/RegisterSW'

export const metadata: Metadata = {
  title: "Naf's Motor Spares",
  description: 'Shop management for motorcycle spare parts shops',
  manifest: '/manifest.webmanifest',
  icons: { apple: '/icon-192.png' },
}

export const viewport: Viewport = {
  themeColor: '#111214',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <SessionProvider>{children}</SessionProvider>
        <RegisterSW />
      </body>
    </html>
  )
}
