import type { MetadataRoute } from 'next'
import { PAGINAS_LEGALES } from '@/lib/publico/legal'
import { piezasPublicas } from '@/lib/academia/publico'
import { rutaDe, BASE_AYUDA } from '@/lib/academia/piezas'
import { SITIO } from '@/lib/publico/sitio'

/**
 * El mapa de lo que CLAUX publica: landing, diagnóstico, legales y las guías del
 * centro de ayuda.
 *
 * Las guías NO se enumeran a mano. Salen de `piezasPublicas()`, que lee los
 * mismos .md que la página y les aplica el mismo filtro de capa, así que una
 * guía nueva entra sola y una que deje de tener texto para un cliente
 * desaparece. Una lista escrita a mano habría empezado a anunciar 404s a la
 * primera pieza que cambiara — y un sitemap con URLs muertas hace más daño que
 * no tener sitemap.
 *
 * No se consulta la base de datos: esto se genera en el build, donde la clave de
 * servicio no está disponible.
 *
 * Las páginas de cada negocio (su menú o su catálogo) no están aquí: se
 * descubren por su QR y por el enlace que reparte el propio negocio, y
 * enumerarlas exigiría leer la BD.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const guias = await piezasPublicas()

  return [
    { url: `${SITIO}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITIO}/diagnostico`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITIO}${BASE_AYUDA}`, changeFrequency: 'weekly', priority: 0.9 },
    ...guias.map(slug => ({
      url: `${SITIO}${rutaDe(slug, BASE_AYUDA)}`,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    ...Object.keys(PAGINAS_LEGALES).map(slug => ({
      url: `${SITIO}/legal/${slug}`,
      changeFrequency: 'yearly' as const,
      priority: 0.3,
    })),
  ]
}
