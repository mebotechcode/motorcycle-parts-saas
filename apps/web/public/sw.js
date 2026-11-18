// Service worker: lets the app open without internet.
//  - app files (/_next/static, icons): saved the first time, then served from the device
//  - pages: network first, saved copy when offline
// Data (Supabase) is never touched here: the app keeps its own offline copy.
const VERSION = 'v2'
const STATIC = 'static-' + VERSION
const PAGES = 'pages-' + VERSION
const PRECACHE = ['/', '/login', '/dashboard', '/sell', '/sales', '/sales/queue', '/sales/pending', '/till', '/inventory', '/offline.html']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGES)
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            const res = await fetch(url, { credentials: 'same-origin' })
            if (res.ok) await cache.put(url, res)
          } catch (e) {}
        })
      )
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = [STATIC, PAGES]
      for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k)
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // Supabase, fonts: leave alone

  // JS/CSS from a new deploy must win over an old saved copy (that is why
  // the grouped navbar can look "stuck" after a merge). Network first,
  // keep a copy for offline.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC)
        try {
          const res = await fetch(req)
          if (res.ok) cache.put(req, res.clone())
          return res
        } catch (e) {
          return (await cache.match(req)) || Response.error()
        }
      })()
    )
    return
  }

  // images and fonts: saved copy first
  if (/\.(png|ico|svg|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) cache.put(req, res.clone())
        return res
      })
    )
    return
  }

  // page visits: internet first, saved copy if it fails
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGES)
        try {
          const res = await fetch(req)
          if (res.ok) cache.put(req, res.clone())
          return res
        } catch (e) {
          return (
            (await cache.match(req, { ignoreSearch: true })) ||
            (await cache.match(url.pathname, { ignoreSearch: true })) ||
            (await cache.match('/offline.html'))
          )
        }
      })()
    )
  }
})
