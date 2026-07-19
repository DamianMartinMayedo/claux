import type { Metadata } from 'next'
import PuntoVentaApp from '../PuntoVentaApp'
import { nombrePunto, cajaIdDe } from '../nombre-punto'
import { metadataPunto } from '../metadata-punto'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

// Misma app que /punto-de-venta, con el nombre del punto en la URL:
//   /punto-de-venta/mostrador?c=<caja_id>#t=<token>
// El segmento es DECORATIVO y la app no lo lee: sirve para que quien recibe el enlace
// por WhatsApp vea de qué punto es. Identificar por el nombre sería un error —se
// repiten entre empresas y se cambian—, así que quien manda es el token del fragmento.
// El nombre REAL de la app instalada sale de `?c=`, que sí identifica.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const cajaId = cajaIdDe(await searchParams)
  return metadataPunto(cajaId, await nombrePunto(cajaId))
}

export default function PuntoVentaConNombrePage() {
  return <PuntoVentaApp />
}
