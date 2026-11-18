import type { MetadataRoute } from 'next'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // App screens are behind auth; /join links carry personal invite tokens
      disallow: [
        '/admin', '/dashboard', '/sell', '/sales', '/inventory', '/purchases', '/suppliers',
        '/customers', '/reports', '/branches', '/staff', '/till', '/expenses',
        '/transfers', '/billing', '/onboarding', '/join', '/api',
      ],
    },
    sitemap: `${SITE}/sitemap.xml`,
  }
}
