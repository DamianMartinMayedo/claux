/**
 * Los datos estructurados de `/ayuda`, para que un buscador entienda qué es esto.
 *
 * Es una web de ayuda de un producto, no un blog ni una tienda: cada guía se
 * declara `TechArticle` dentro de una `CollectionPage`, con su miga de pan. Sin
 * esto, un resultado de búsqueda a «cómo se hace la nómina en CLAUX» compite
 * como una página suelta más.
 *
 * Se escapa el `<` al serializar: el nombre de un módulo lo edita el equipo desde
 * el admin y acaba dentro de un `<script>`; sin escapar, un `</script>` en ese
 * campo cerraría la etiqueta y lo que siguiera se ejecutaría como HTML.
 */
export function jsonLd(datos: object): string {
  return JSON.stringify(datos).replace(/</g, '\\u003c')
}
