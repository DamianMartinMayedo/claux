// Service worker del Punto de venta offline (PWA). Se registra desde
// /punto-de-venta con scope acotado a /punto-de-venta/. Objetivo: que el punto de
// venta INSTALADO abra sin conexión (cortes de luz/datos en Cuba).
// Estrategia: la navegación (shell) va network-first con
// fallback a caché; los assets (JS/CSS) stale-while-revalidate. Las llamadas a
// /punto-de-venta/api/* (seed/sync) NUNCA se cachean: siempre a red (o fallan y la app
// guarda local para reintentar).

// v4: el registro pasa a scope `/punto-de-venta` SIN barra final. Con la barra, la
// `start_url` de la app instalada (`/punto-de-venta?c=CAJ-…`) quedaba FUERA del ámbito —el
// ámbito es un prefijo de cadena— y este service worker no llegaba a ejecutarse para ella:
// el icono de la pantalla de inicio, que es el único camino real de uso, se quedaba sin la
// caché que hace de esto una caja offline. Se sube la versión para tirar la caché anterior,
// que se llenó bajo el ámbito equivocado.
const CACHE = 'claux-punto-venta-v4'

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
  if (url.pathname.startsWith('/punto-de-venta/api/')) return // seed/sync: siempre a red

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((r) => cachePut(request, r))
        .catch(() => caches.match(request).then((c) => c || caches.match('/punto-de-venta'))),
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
