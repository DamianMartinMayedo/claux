import type { Metadata } from 'next'
import '@/app/globals.css'
import BrandFonts from '@/components/BrandFonts'

/**
 * El centro de ayuda de CLAUX: el manual, leído en la capa `cliente`.
 *
 * **Está fuera del grupo `(academia)` a propósito, y no debe moverse dentro.**
 * Aquel layout marca `robots: { index: false }` —el manual interno no se indexa
 * porque lleva márgenes, costes y roadmap— y esta es la única superficie del
 * manual que SÍ tiene que salir en Google: es la respuesta pública a «cómo se
 * hace X en CLAUX», y quien la busca todavía no es cliente. Meterla en el grupo
 * la heredaría el `noindex` y la haría invisible sin que nada fallara.
 *
 * Tampoco lleva sesión: no hay guard, no hay cookie de capa y no hay selector.
 * La capa es fija (`CAPA_PUBLICA`) y el filtro corre en el servidor, así que lo
 * que no es `usar` no llega al HTML — no está oculto, no está.
 *
 * Marketing propio de CLAUX, como la landing y los legales: design system
 * completo y fuentes de marca (`globals.css` no va en el root layout).
 */

export const metadata: Metadata = {
  // `default` para el layout, `template` para las piezas: cada guía se titula
  // con su nombre y el sitio, que es como se lee en un resultado de búsqueda.
  title: { default: 'Centro de ayuda', template: '%s · Ayuda de CLAUX' },
}

export default function AyudaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BrandFonts />
      {children}
    </>
  )
}
