// Service worker de la Caja offline (PWA). Se registra desde /caja con scope
// acotado a /caja/. Objetivo: que la caja INSTALADA abra sin conexión (cortes de
// luz/datos en Cuba). Estrategia: la navegación (shell) va network-first con
// fallback a caché; los assets (JS/CSS) stale-while-revalidate. Las llamadas a
// /caja/api/* (seed/sync) NUNCA se cachean: siempre a red (o fallan y la app
// guarda local para reintentar).

const CACHE = 'claux-caja-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

async function cachePut(request, response) {
  if (response && response.ok) {
    const cache = await caches.open(CACHE)
    cache.put(request, response.clone())
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.pathname.startsWith('/caja/api/')) return // seed/sync: siempre a red

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((r) => cachePut(request, r))
        .catch(() => caches.match(request).then((c) => c || caches.match('/caja'))),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((r) => cachePut(request, r)).catch(() => cached)
      return cached || network
    }),
  )
})
