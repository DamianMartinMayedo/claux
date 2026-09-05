import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { cargarPropuestaPublica } from '@/lib/propuesta/cargar'
import Propuesta from './Propuesta'

// ── Propuesta comercial pública — /p/<token> ─────────────────────────────────
//
// RUTA `/p/`, un solo segmento como `/d/`: no colisiona con `(public)/[slug]/…`
// porque los slugs exigen ≥2 caracteres, y no filtra en la URL de quién es la
// propuesta. El token ES la credencial — no hay login detrás.
//
// El RENDER vive en `Propuesta.tsx`, compartido con `/p/preview/<id>`: el
// comercial previsualiza exactamente lo que abrirá el cliente.
//
// LA CACHÉ AQUÍ NO ES LA FUENTE DE VERDAD, y es lo contrario del dossier: aquel
// congela un snapshot, y esta propuesta no guarda ni un número —los lee del
// presupuesto y del catálogo vivos—. Así que la caché es algo que hay que TIRAR
// cuando cambia el origen, y va con dos redes:
//
//   1. `revalidatePath('/p/<token>')` desde las acciones del presupuesto y del
//      editor. Es la red rápida: el cambio se ve en la siguiente visita.
//   2. `revalidate = 3600`. Es la red de seguridad, y no sobra: el precio de
//      cada módulo sale del CATÁLOGO, y quien lo edita en `/admin/modulos` no
//      tiene forma de saber qué propuestas lo enseñan. Con `false`, un cambio de
//      precio del catálogo se quedaría congelado en esas páginas para siempre —
//      justo el defecto que esto vino a resolver.
export const revalidate = 3600

interface Props {
  params: Promise<{ token: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params
  const p = await cargarPropuestaPublica(token)
  if (!p) return { robots: { index: false, follow: false } }
  return {
    // `absolute` y con «Propuesta» delante a propósito: este título es el nombre
    // del fichero cuando el cliente pulsa PDF, y en su carpeta de descargas se
    // ordena junto al resto de propuestas en vez de por el nombre del negocio.
    // Sin `absolute` arrastraría el «| CLAUX» de la plantilla raíz al fichero.
    title: { absolute: `Propuesta CLAUX — ${p.nombreNegocio}` },
    description: `Propuesta de digitalización para ${p.nombreNegocio}.`,
    // Enlace privado (capability URL) y además con precios negociados dentro:
    // ni se indexa ni se deja el token en el Referer al pulsar un enlace.
    robots: { index: false, follow: false, nocache: true },
    referrer: 'no-referrer',
    icons: {
      icon: [
        { url: '/favicon.svg', type: 'image/svg+xml' },
        { url: '/favicon.png', type: 'image/png' },
      ],
    },
  }
}

export default async function PropuestaPage({ params }: Props) {
  const { token } = await params
  const p = await cargarPropuestaPublica(token)
  if (!p) notFound()   // en borrador, despublicada o token revocado → 404

  return <Propuesta p={p} />
}
