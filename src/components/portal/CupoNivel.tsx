// ────────────────────────────────────────────────────────────────────────────
// «Cuánto te cabe en tu nivel»: el contador discreto de cada vista limitada.
//
// NO confundir con `AvisoTope`, que es otra cosa completamente: aquel avisa de
// que el LISTADO enseña 500 filas de 700 (un techo de consulta, no comercial).
// Este dice cuántos productos activos caben en el nivel contratado.
//
// Se pinta solo cuando hay tope. Sin límite no hay nada que contar, y una línea
// que dice «182 productos» sin un «de» al lado es ruido.
//
// No lleva variante para la vista de archivados: «archivados» es un filtro de
// cliente DENTRO de la misma vista, no una página aparte donde montar un server
// component. Que desarchivar cuenta como crear se dice donde importa —al
// intentarlo— con `mensajeLimiteDesarchivar`.
//
// Si el conteo falla NO se pinta nada. En `comprobarLimite` un fallo se propaga
// —leerlo como cero sería el límite desapareciendo en silencio—, pero esto es
// decoración: callarse es honesto, inventar un número no.
// ────────────────────────────────────────────────────────────────────────────

import { getPortalSession } from '@/app/actions/portal/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { cargarContextoLimites, contarActivos, DIMENSIONES, type Dimension } from '@/lib/limites'

type DimContable = Exclude<Dimension, 'ia_conversaciones'>

export default async function CupoNivel({ dim }: { dim: DimContable }) {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  let usado: number
  let limite: number | null
  let nivelNombre: string
  try {
    const ctx = await cargarContextoLimites(db, session.client_id)
    limite = ctx.limites[dim] ?? null
    if (limite === null) return null
    nivelNombre = ctx.nivelNombre
    usado = await contarActivos(db, session.client_id, dim)
  } catch {
    return null
  }

  const d = DIMENSIONES[dim]
  const quedan = limite - usado

  if (usado > limite) {
    return (
      <div className="alert alert-warning">
        <strong className="alert-titulo">Tienes más {d.varios} de los que incluye tu nivel</strong>
        {usado} {d.varios} y el nivel {nivelNombre} llega a {limite}. Sigues trabajando con {d.genero === 'f' ? 'todas' : 'todos'};
        para añadir más, archiva {d.genero === 'f' ? 'alguna' : 'alguno'} o pásate a un nivel mayor.
      </div>
    )
  }

  return (
    <p className={`cupo-nivel${quedan <= Math.max(1, Math.floor(limite * 0.1)) ? ' cupo-nivel-cerca' : ''}`}>
      {usado} de {limite} {d.varios}
      {quedan <= Math.max(1, Math.floor(limite * 0.1)) && (
        <> · te {quedan === 1 ? 'queda' : 'quedan'} {quedan}</>
      )}
    </p>
  )
}
