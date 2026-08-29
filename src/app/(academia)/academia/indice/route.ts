import { NextResponse } from 'next/server'
import { obtenerContextoAdmin } from '@/lib/roles-server'
import { leerManual } from '@/lib/academia/manual'
import { construirIndice } from '@/lib/academia/indice'
import { capaActual } from '@/lib/academia/capas-server'

/**
 * El índice de búsqueda del manual ENTERO, aparte de las páginas.
 *
 * Podría viajar dentro del HTML, pero pesa más que cualquier pieza: yendo
 * incrustado, abrir una ficha por un enlace costaba cuatro veces lo que ocupa la
 * ficha, y otra vez en la siguiente visita. Servido aquí, el navegador lo guarda
 * y lo reutiliza mientras se lee el manual.
 *
 * `Cache-Control` corto pero real: el contenido solo cambia al desplegar, así
 * que quince minutos no desfasan nada y se ahorra la descarga en cada entrada.
 * `private` porque el manual es interno: no lo puede guardar ningún intermedio.
 *
 * La capa la manda la sesión —el rol primero, la cookie después—, nunca el
 * `?capa=` de la URL: el parámetro está solo para que cada capa tenga su propia
 * entrada en la caché del navegador (si no, al cambiar de capa el buscador
 * seguiría encontrando lo que ya no se ve). Leerlo de la query sería regalar el
 * índice completo a quien escribiera `?capa=interna` a mano.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await obtenerContextoAdmin()
  if (!ctx) return NextResponse.json({ error: 'Sin sesión de admin.' }, { status: 401 })

  const capa = await capaActual(ctx.rol)
  const piezas = await leerManual(capa.clave)
  const indice = construirIndice(
    piezas.flatMap(p => p.cuerpo ? [{ md: p.cuerpo, seccion: p.nombre, slug: p.slug }] : []),
  )

  return NextResponse.json(indice, {
    headers: { 'Cache-Control': 'private, max-age=900' },
  })
}
