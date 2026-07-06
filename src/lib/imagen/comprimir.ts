// ── Pre-compresión de imágenes en el navegador (antes de subir) ──
// CONTEXTO §3/§7: la conexión móvil cubana es lenta y cara. Reducir el peso
// ANTES de subir ahorra datos del dueño y acelera la subida. El servidor vuelve
// a optimizar con sharp (garantía uniforme), así que aquí basta un redimensionado
// razonable con canvas — sin dependencias externas ni bundle extra.
//
// Devuelve un Blob (WebP si el navegador lo soporta, si no JPEG). Si algo falla,
// devuelve el archivo original: la subida nunca se bloquea por la compresión.

const LADO_MAX = 1600   // px del lado mayor tras el pre-redimensionado
const CALIDAD  = 0.82

export async function comprimirImagen(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * escala)
    const h = Math.round(bitmap.height * escala)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    const tipo = 'image/webp'
    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, tipo, CALIDAD),
    )
    // Si el navegador no soporta WebP en canvas (raro), cae al original.
    if (!blob || blob.size === 0) return file
    // Si por lo que sea el resultado es más pesado que el original, usa el original.
    return blob.size < file.size ? blob : file
  } catch {
    return file
  }
}
