// Service worker del Catálogo QR público. Se registra SOLO desde la página
// pública del catálogo con scope acotado a `/<slug>/catalogo/` (ver
// PwaCatalogoRegister.tsx): nunca controla el portal ni el admin, aunque el
// archivo se sirva desde la raíz del sitio.
//
// Objetivo (CONTEXTO §3): un catálogo ya visitado debe abrir sin conexión
// (cortes de luz/datos). Estrategia: la navegación (HTML) va network-first con
// fallback a caché; las imágenes del bucket de Supabase van cache-first
// (no cambian tras subirlas, llevan cache-busting); el resto, stale-while-revalidate.

const CACHE = 'claux-catalogo-v1'

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
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

  const esImagen = request.destination === 'image'
  const esNavegacion = request.mode === 'navigate'

  if (esImagen) {
    // Cache-first: las fotos optimizadas no cambian de URL (cache-busting por query).
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((r) => cachePut(request, r))),
    )
    return
  }

  if (esNavegacion) {
    // Network-first: prioriza frescura; si no hay red, sirve la última versión cacheada.
    event.respondWith(
      fetch(request).then((r) => cachePut(request, r)).catch(() => caches.match(request)),
    )
    return
  }

  // Resto (JSON del manifest, JS/CSS de la página): stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((r) => cachePut(request, r)).catch(() => cached)
      return cached || network
    }),
  )
})
