import { createAdminClient } from '@/lib/supabase/admin'
import { NIVELES, NOMBRE_NIVEL, normalizarNivel, type Nivel } from '@/lib/niveles'

/**
 * Los niveles TAL COMO EL DUEÑO LOS LLAMA HOY.
 *
 * `lib/niveles.ts` fija las claves (`inicial`/`empresa`/`pro`) y unos nombres de
 * respaldo; los nombres de verdad viven en la tabla `niveles` y se editan desde
 * /admin. Este módulo es el único sitio que los lee, para que renombrar «Empresa»
 * a «Negocio» sea un UPDATE y no un despliegue.
 *
 * Lectura interna con el cliente de servicio, como `leerSetting`: no es un server
 * action y el catálogo de niveles no es secreto (lo pinta la landing pública).
 *
 * Si la consulta falla se devuelven los nombres de respaldo en vez de nada: una
 * pantalla de precios sin nombres de nivel es peor que una con el nombre viejo.
 */

export interface NivelInfo {
  clave:       Nivel
  nombre:      string
  descripcion: string | null
  orden:       number
  activo:      boolean
}

const RESPALDO: NivelInfo[] = NIVELES.map((clave, i) => ({
  clave, nombre: NOMBRE_NIVEL[clave], descripcion: null, orden: i + 1, activo: true,
}))

export async function listarNiveles(): Promise<NivelInfo[]> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('niveles')
    .select('clave, nombre, descripcion, orden, activo')
    .order('orden')
  if (error || !data?.length) {
    if (error) console.error('[niveles] no se pudo leer la tabla:', error.message)
    return RESPALDO
  }
  return data.map(f => ({
    clave:       normalizarNivel(f.clave),
    nombre:      f.nombre,
    descripcion: f.descripcion,
    orden:       f.orden,
    activo:      f.activo,
  }))
}

/** Solo los que se venden hoy. Un nivel archivado sigue existiendo para quien ya lo tiene. */
export async function nivelesVendibles(): Promise<NivelInfo[]> {
  return (await listarNiveles()).filter(n => n.activo)
}

/** `{ inicial: 'Inicial', … }` para pintar el nombre de un nivel suelto. */
export async function nombresDeNiveles(): Promise<Record<Nivel, string>> {
  const filas = await listarNiveles()
  const mapa = { ...NOMBRE_NIVEL }
  for (const n of filas) mapa[n.clave] = n.nombre
  return mapa
}

/**
 * La matriz de topes: `{ inicial: { productos: 200, … }, … }`. `null` = sin tope.
 *
 * Para las pantallas que tienen que decidir *fuera del portal* si un volumen cabe
 * —la calculadora de presupuestos, sin `client_id` al que resolverle nada—. El
 * portal no usa esto: allí manda `cargarContextoLimites`, que además aplica las
 * excepciones del cliente.
 *
 * Si falla, devuelve `{}` y quien llama se queda sin sugerencia. Es lo correcto:
 * proponer un nivel con una matriz a medias es peor que no proponer ninguno.
 */
export async function limitesDeNiveles(): Promise<Record<string, Record<string, number | null>>> {
  const db = createAdminClient()
  const { data, error } = await db.from('nivel_limites').select('nivel, dimension, base')
  if (error || !data) {
    if (error) console.error('[niveles] no se pudieron leer los límites:', error.message)
    return {}
  }
  const matriz: Record<string, Record<string, number | null>> = {}
  for (const f of data as { nivel: string; dimension: string; base: number | null }[]) {
    (matriz[f.nivel] ??= {})[f.dimension] = f.base === null || f.base === undefined ? null : Number(f.base)
  }
  return matriz
}
