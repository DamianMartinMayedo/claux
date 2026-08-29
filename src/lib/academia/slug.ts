/**
 * Anclas de la Academia. Vive aparte porque lo usan el renderizador (que pinta
 * los `id`) y el índice de búsqueda (que apunta a ellos): si cada uno tuviera su
 * copia, un cambio en uno dejaría al buscador saltando a anclas que no existen.
 *
 * Los encabezados se prefijan con la ficha (`contabilidad--que-hace`) porque el
 * manual entero es UNA página: sin prefijo, «1. En una frase» repetiría el mismo
 * `id` en las doce fichas y el navegador siempre saltaría a la primera.
 */

export function slugify(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function anclaEncabezado(texto: string, slug?: string): string {
  const base = slugify(texto)
  return slug ? `${slug}--${base}` : base
}
