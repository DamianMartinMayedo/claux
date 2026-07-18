// Alta de notificaciones internas. TODAS las fuentes (eventos y cron) pasan por
// aquí: es el único sitio donde se aplica el candado de módulo, la preferencia
// del tenant y la idempotencia.

import { createAdminClient } from '@/lib/supabase/admin'
import {
  definicion, severidadDe,
  type Severidad, type TipoClave, type Umbral,
} from './catalogo'

type Db = ReturnType<typeof createAdminClient>

export interface Preferencia {
  activa:             boolean
  severidad_override: Severidad | null
}

/**
 * Módulos y preferencias de un tenant, cargados UNA vez. El cron itera cientos
 * de filas por tenant: sin esto haría dos queries por notificación.
 */
export interface ContextoTenant {
  clientId: string
  modulos:  string[]
  prefs:    Map<string, Preferencia>
}

export async function cargarContextoTenant(db: Db, clientId: string): Promise<ContextoTenant> {
  const [{ data: cliente }, { data: prefs }] = await Promise.all([
    db.from('clients').select('modulos_activos').eq('client_id', clientId).maybeSingle(),
    db.from('notificacion_config').select('tipo, activa, severidad_override').eq('client_id', clientId),
  ])
  return {
    clientId,
    modulos: Array.isArray(cliente?.modulos_activos) ? (cliente.modulos_activos as string[]) : [],
    prefs: new Map((prefs ?? []).map(p => [p.tipo as string, {
      activa:             p.activa as boolean,
      severidad_override: (p.severidad_override ?? null) as Severidad | null,
    }])),
  }
}

export interface CrearNotificacionInput {
  clientId:    string
  tipo:        TipoClave
  titulo:      string
  cuerpo?:     string
  /** Deep-link al portal, p. ej. `/portal/terceros/<id>`. */
  enlace?:     string | null
  empresaId?:  string | null
  /** Entidad de origen: da idempotencia al cron y permite resolver después. */
  entidadTipo?: string | null
  entidadId?:   string | null
  umbral?:      Umbral | null
  meta?:        Record<string, unknown>
  /**
   * Tipos cuyas notificaciones previas sobre ESTA MISMA entidad quedan obsoletas
   * al crear esta. Sirve para el escalado: al llegar el aviso de "vence en 1 día"
   * se archiva el de "vence en 30", en vez de acumular cinco filas del mismo
   * contrato en la bandeja.
   */
  sustituyeA?:  TipoClave[]
}

/**
 * Crea la notificación si procede. Devuelve true solo si insertó una fila nueva.
 *
 * No crea cuando: el tenant no tiene el módulo del tipo, el tenant desactivó ese
 * tipo, o ya existe esa misma notificación (mismo tipo + entidad + umbral).
 *
 * Nunca lanza: una notificación es un efecto secundario y no debe tumbar la
 * acción de negocio que la dispara.
 */
export async function crearNotificacion(
  input: CrearNotificacionInput,
  ctx?: ContextoTenant,
): Promise<boolean> {
  try {
    const db  = createAdminClient()
    const def = definicion(input.tipo)

    const contexto = ctx?.clientId === input.clientId
      ? ctx
      : await cargarContextoTenant(db, input.clientId)

    // 1. Candado comercial: sin el módulo contratado, el aviso no existe.
    if (def.modulo && !contexto.modulos.includes(def.modulo)) return false

    // 2. Preferencia del tenant (fila ausente = default del catálogo).
    const pref = contexto.prefs.get(input.tipo)
    if (pref && !pref.activa) return false

    const severidad = pref?.severidad_override ?? severidadDe(input.tipo, input.umbral)

    // 3. Insert idempotente. No usamos upsert/onConflict: idx_notif_idem es un
    //    índice PARCIAL y con expresión (coalesce), y PostgREST no puede inferirlo
    //    en un ON CONFLICT. Insertamos y tratamos la violación de único (23505)
    //    como "ya existía" — la garantía la sigue dando la BD, no el código.
    const { data, error } = await db
      .from('notificaciones')
      .insert({
        client_id:    input.clientId,
        empresa_id:   input.empresaId ?? null,
        tipo:         input.tipo,
        categoria:    def.categoria,
        severidad,
        titulo:       input.titulo,
        cuerpo:       input.cuerpo ?? '',
        enlace:       input.enlace ?? null,
        entidad_tipo: input.entidadTipo ?? null,
        entidad_id:   input.entidadId ?? null,
        umbral:       input.umbral ?? null,
        meta:         input.meta ?? {},
      })
      .select('id')

    if (error) {
      if (error.code === '23505') return false  // ya avisado de esto
      console.error('[notificaciones] no se pudo crear', input.tipo, error.message)
      return false
    }
    if ((data?.length ?? 0) === 0) return false

    // Escalado: la nueva deja obsoletas las anteriores sobre la misma entidad.
    if (input.sustituyeA?.length && input.entidadId) {
      const nuevaId = data![0].id as number
      await db
        .from('notificaciones')
        .update({ resuelta: true, estado: 'archivada' })
        .eq('client_id', input.clientId)
        .eq('entidad_tipo', input.entidadTipo ?? '')
        .eq('entidad_id', input.entidadId)
        .in('tipo', input.sustituyeA)
        .neq('id', nuevaId)
        .neq('estado', 'archivada')
    }
    return true
  } catch (e) {
    console.error('[notificaciones] error inesperado', input.tipo, e)
    return false
  }
}

/**
 * Marca resueltas (y archivadas) las notificaciones de unos tipos cuya condición
 * ya no aplica — contrato renovado, factura cobrada, stock repuesto. Sin esto la
 * bandeja miente: sigue pidiendo actuar sobre algo ya arreglado.
 *
 * `entidadesVivas` son las entidades que HOY siguen cumpliendo la condición;
 * todo lo demás de esos tipos se da por resuelto.
 */
export async function resolverNotificaciones(
  db: Db,
  clientId: string,
  tipos: TipoClave[],
  entidadTipo: string,
  entidadesVivas: string[],
): Promise<void> {
  let q = db
    .from('notificaciones')
    .update({ resuelta: true, estado: 'archivada' })
    .eq('client_id', clientId)
    .eq('entidad_tipo', entidadTipo)
    .in('tipo', tipos)
    .eq('resuelta', false)

  if (entidadesVivas.length > 0) {
    // `not in` con lista vacía genera SQL inválido en PostgREST: por eso el if.
    q = q.not('entidad_id', 'in', `(${entidadesVivas.map(id => `"${id}"`).join(',')})`)
  }

  const { error } = await q
  if (error) console.error('[notificaciones] no se pudo resolver', entidadTipo, error.message)
}
