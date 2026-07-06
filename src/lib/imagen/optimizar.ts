// ── Optimización de imágenes en el servidor (garantía del sistema) ──
// El cliente ya pre-comprime antes de subir (ahorra datos móviles, crítico en
// Cuba), pero NO nos fiamos del resultado: aquí sharp re-codifica a WebP con
// tamaño y calidad fijos, de modo que TODA foto del catálogo queda ligera y
// uniforme sea cual sea el dispositivo de origen. Server-only.
//
// sharp se importa de forma diferida (dynamic import) para no cargarlo salvo
// cuando de verdad se sube una imagen.

const ANCHO_MAX   = 1200   // px del lado mayor de la imagen principal
const ANCHO_THUMB = 400    // px del lado mayor de la miniatura (rejilla)
const CALIDAD     = 72     // calidad WebP (buen equilibrio peso/nitidez)
const CALIDAD_THUMB = 65

export interface ImagenOptimizada {
  full:  Buffer   // WebP ~1200px
  thumb: Buffer   // WebP ~400px
}

/**
 * Recibe los bytes de una imagen (cualquier formato que soporte sharp) y
 * devuelve dos WebP: la principal y una miniatura. Redimensiona sin agrandar
 * (`withoutEnlargement`) y aplana la transparencia sobre blanco.
 */
export async function optimizarImagen(entrada: Buffer): Promise<ImagenOptimizada> {
  const sharpMod = (await import('sharp')).default

  const base = sharpMod(entrada).rotate() // respeta la orientación EXIF

  const full = await base
    .clone()
    .resize({ width: ANCHO_MAX, height: ANCHO_MAX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: CALIDAD })
    .toBuffer()

  const thumb = await base
    .clone()
    .resize({ width: ANCHO_THUMB, height: ANCHO_THUMB, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: CALIDAD_THUMB })
    .toBuffer()

  return { full, thumb }
}
