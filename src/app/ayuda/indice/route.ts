import { NextResponse } from 'next/server'
import { leerAyuda } from '@/lib/academia/publico'
import { construirIndice } from '@/lib/academia/indice'

/**
 * El índice de búsqueda del centro de ayuda, aparte de las páginas.
 *
 * Gemelo del de `/academia`, con dos diferencias que son justo el motivo de que
 * exista uno propio: **no lleva sesión** —esto es público— y **solo contiene lo
 * que /ayuda publica**, porque lo construye sobre `leerAyuda()`, que ya filtra
 * por la capa `cliente` y aplica el habla pública. Buscar aquí no puede
 * encontrar nada que no se pueda abrir: el buscador se queda en su contexto.
 *
 * Va aparte del HTML porque pesa más que cualquier guía: incrustado, abrir una
 * por un enlace costaba cuatro veces lo que ocupa la guía, y otra vez en la
 * siguiente visita. Servido aquí, el navegador lo guarda y lo reutiliza.
 *
 * `Cache-Control` público —al revés que el del manual, que es `private` por ser
 * interno—: esto es la misma información que ya sirven las páginas, así que
 * cualquier intermedio puede guardarla. Quince minutos no desfasan nada: el
 * contenido solo cambia al desplegar.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const piezas = await leerAyuda()
  const indice = construirIndice(
    piezas.flatMap(p => (p.cuerpo ? [{ md: p.cuerpo, seccion: p.nombre, slug: p.slug }] : [])),
  )

  return NextResponse.json(indice, {
    headers: { 'Cache-Control': 'public, max-age=900' },
  })
}
