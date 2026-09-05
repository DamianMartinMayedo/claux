import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { obtenerContextoAdmin } from '@/lib/roles-server'
import { puedeAcceder } from '@/lib/roles'
import { createAdminClient } from '@/lib/supabase/admin'
import { cargarPropuestaBorrador } from '@/lib/propuesta/cargar'
import Propuesta from '../../[token]/Propuesta'

// ── Vista previa en BORRADOR — /p/preview/<id> ───────────────────────────────
//
// La misma propuesta que `/p/<token>`, pero con candado de SESIÓN en vez de
// token y sin exigir PUBLICADA: el comercial ve el documento montado antes de
// mandarlo, en lugar de publicar a ciegas para verlo.
//
// Vive en el grupo `(public)` a propósito: usa el layout limpio de las páginas
// públicas, sin el cromo del admin, para que el entorno de render sea idéntico
// al del enlace real —y el PDF de la vista previa salga igual que el de verdad—.
// El candado no está en el layout, está aquí. No colisiona con `/p/<token>`:
// aquel es de un segmento, este de dos.
//
// Dinámico: depende de la sesión, no se prerenderiza ni se cachea.
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

/**
 * Nunca indexable: es un borrador interno.
 *
 * Y con TÍTULO propio, que no es un detalle: el navegador nombra el PDF con el
 * título del documento, y sin este la vista previa heredaba el respaldo del
 * grupo público —la propuesta de un lead se descargaba «Reservas — CLAUX.pdf»—.
 * El nombre sale sin la marca de borrador: en pantalla el distintivo se ve, pero
 * el fichero que se acabe mandando no tiene por qué llamarse «borrador».
 *
 * El nombre del negocio solo se pone si quien mira puede ver la propuesta: un
 * título es texto que se enseña, y en una ruta pública se comprueba antes.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const base: Metadata = {
    robots: { index: false, follow: false, nocache: true },
    referrer: 'no-referrer',
  }
  const { id } = await params
  const num = Number(id)
  if (!Number.isInteger(num) || num <= 0) return base

  const ctx = await obtenerContextoAdmin()
  if (!ctx || !puedeAcceder(ctx, 'propuestas')) return base

  const { data } = await createAdminClient()
    .from('propuestas').select('nombre_negocio').eq('id', num).maybeSingle()
  const negocio = (data as { nombre_negocio: string } | null)?.nombre_negocio
  return negocio
    ? { ...base, title: { absolute: `Propuesta CLAUX — ${negocio}` } }
    : base
}

export default async function PropuestaPreviewPage({ params }: Props) {
  const { id } = await params

  // Sin `requireAccesoPagina`: eso redirige a la primera sección permitida del
  // admin, y desde una ruta pública lo correcto es mandar al login o cerrar con
  // un 404 —no rebotar a un panel que quien mira quizá no tenga.
  const ctx = await obtenerContextoAdmin()
  if (!ctx) redirect('/admin/login')
  if (!puedeAcceder(ctx, 'propuestas')) notFound()

  const num = Number(id)
  if (!Number.isInteger(num) || num <= 0) notFound()

  const p = await cargarPropuestaBorrador(num)
  if (!p) notFound()

  return <Propuesta p={p} borrador />
}
