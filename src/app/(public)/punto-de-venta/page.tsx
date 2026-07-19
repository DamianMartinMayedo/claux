import type { Metadata } from 'next'
import PuntoVentaApp from './PuntoVentaApp'
import { nombrePunto, cajaIdDe } from './nombre-punto'
import { metadataPunto } from './metadata-punto'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

// Ruta a la que arranca la PWA ya instalada (start_url), que conserva el `?c=` para
// no perder su identidad al re-pedir el manifest. El enlace que se comparte lleva
// además el nombre del punto en la ruta — ver [slug]/page.tsx.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const cajaId = cajaIdDe(await searchParams)
  return metadataPunto(cajaId, await nombrePunto(cajaId))
}

// Shell estático; todos los datos viven en IndexedDB del dispositivo y la
// sincronización va por /punto-de-venta/api/*. El service worker lo cachea para offline.
export default function PuntoVentaPage() {
  return <PuntoVentaApp />
}
