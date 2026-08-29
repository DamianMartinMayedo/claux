import type { MetadataRoute } from 'next'
import { SITIO } from '@/lib/publico/sitio'

/**
 * Qué puede rastrear un buscador de claux.es.
 *
 * Lo público de verdad son cuatro cosas: la landing, el diagnóstico, los legales
 * y el centro de ayuda. Todo lo demás se cierra aquí, y cada uno por su motivo:
 *
 *  · `/admin` y `/portal` son aplicación con sesión — indexarlas solo publicaría
 *    pantallas de login y rutas internas;
 *  · `/academia` y `/partners` son el manual completo y su puerta: llevan
 *    márgenes, costes y trabajo interno, y ya se cierran también con `noindex`
 *    en su layout (esto es el segundo candado, no el único);
 *  · `/d/` son los dossiers por token — el enlace ES la llave, así que rastrear
 *    uno lo publicaría;
 *  · `/api` no son páginas.
 *
 * Las páginas públicas de cada NEGOCIO (`/<negocio>/menu`, `/carta`,
 * `/servicios`, `/catalogo`) se quedan abiertas a propósito: son suyas, y que
 * las encuentre quien busque el restaurante es parte de lo que se vende.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/portal', '/academia', '/partners', '/d/', '/api'],
    },
    sitemap: `${SITIO}/sitemap.xml`,
  }
}
