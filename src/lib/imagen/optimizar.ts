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

// ── Capturas de producto (biblioteca de la propuesta comercial) ──────────────

const CAPTURA_ANCHO = 1200        // px de ancho; una captura de UI no se recorta
const CAPTURA_TOPE  = 180 * 1024  // el techo del §10.4 del plan: 180 KB
const CAPTURA_ESCALERA = [82, 72, 62, 52]

export interface CapturaOptimizada {
  webp:  Buffer
  ancho: number
  alto:  number
}

/**
 * Una captura de pantalla lista para la propuesta: WebP a 1200 px de ancho y
 * **por debajo de 180 KB**, con sus medidas reales.
 *
 * Quien abre la propuesta suele estar en Cuba con 3G y son ocho imágenes: el
 * peso no se pide, se garantiza. Por eso hay escalera de calidad en vez de un
 * número fijo —una captura con foto dentro pesa el triple que una de tablas— y
 * por eso, si ni al 52 baja del tope, se rechaza aquí: el sitio donde eso se
 * arregla es el admin, no la casa del cliente.
 *
 * Las medidas salen del fichero YA redimensionado, no del original: van al
 * `<img>` como `width`/`height` para reservar el hueco, y con las del original
 * reservarían uno del tamaño equivocado.
 */
export async function optimizarCaptura(entrada: Buffer): Promise<CapturaOptimizada> {
  const sharpMod = (await import('sharp')).default
  const base = sharpMod(entrada)
    .rotate()
    .resize({ width: CAPTURA_ANCHO, withoutEnlargement: true })

  let ultima: { data: Buffer; info: { width: number; height: number; size: number } } | null = null
  for (const quality of CAPTURA_ESCALERA) {
    const { data, info } = await base.clone().webp({ quality }).toBuffer({ resolveWithObject: true })
    ultima = { data, info }
    if (info.size <= CAPTURA_TOPE) break
  }
  if (!ultima) throw new Error('No se pudo procesar la imagen.')
  if (ultima.info.size > CAPTURA_TOPE) {
    throw new Error(
      `La imagen no baja de 180 KB (${Math.round(ultima.info.size / 1024)} KB). ` +
      'Recorta la captura a la parte que se quiere enseñar.',
    )
  }

  return { webp: ultima.data, ancho: ultima.info.width, alto: ultima.info.height }
}
