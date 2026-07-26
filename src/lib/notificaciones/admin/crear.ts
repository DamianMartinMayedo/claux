// Alta de avisos del admin. TODAS las fuentes (eventos y cron) pasan por aquí:
// es el único sitio donde se aplican la preferencia del equipo y la idempotencia.
//
// Espejo de src/lib/notificaciones/crear.ts. La diferencia es que aquí no hay
// candado de módulo (el filtro por permiso de sección se aplica al LEER, en las
// acciones: quién puede ver el aviso depende de quién esté en sesión, no de quién
// lo creó).

import { createAdminClient } from '@/lib/supabase/admin'
import type { Severidad, Umbral } from '@/lib/notificaciones/catalogo'
import {
  definicionAdmin, severidadAdminDe,
  type TipoAvisoClave,
} from './catalogo'

type Db = ReturnType<typeof createAdminClient>

export interface PreferenciaAdmin {
  activa:             boolean
  severidad_override: Severidad | null
}

/**
 * Preferencias del equipo, cargadas UNA vez. El cron recorre cientos de filas:
 * sin esto haría una query por aviso.
 */
export async function cargarPrefsAdmin(db: Db): Promise<Map<string, PreferenciaAdmin>> {
  const { data } = await db
    .from('admin_notificacion_config')
    .select('tipo, activa, severidad_override')

  return new Map((data ?? []).map(p => [p.tipo as string, {
    activa:             p.activa as boolean,
    severidad_override: (p.severidad_override ?? null) as Severidad | null,
  }]))
}

export interface CrearAvisoInput {
  tipo:         TipoAvisoClave
  titulo:       string
  cuerpo?:      string
  /** Deep-link al panel, p. ej. `/admin/clientes/CLI-0014`. */
  enlace?:      string | null
  /** Cliente al que se refiere, si aplica. */
  clientId?:    string | null
  /** Entidad de origen: da idempotencia al cron y permite resolver después. */
  entidadTipo?: string | null
  entidadId?:   string | null
  umbral?:      Umbral | null
  meta?:        Record<string, unknown>
  /**
   * Tipos cuyos avisos previos sobre ESTA MISMA entidad quedan obsoletos al crear
   * este. Para el escalado: al llegar «vence en 1 día» se archiva «vence en 15»,
   * en vez de acumular tres filas del mismo cliente en la bandeja.
   */
  sustituyeA?:  TipoAvisoClave[]
}

/**
 * Crea el aviso si procede. Devuelve true solo si insertó una fila nueva.
 *
 * No crea cuando: el equipo desactivó ese tipo, o ya existe ese mismo aviso
 * (mismo tipo + entidad + umbral).
 *
 * Nunca lanza: un aviso es un efecto secundario y no puede tumbar la acción de
 * negocio que lo dispara (dar de alta un cliente, registrar un pago).
 */
export async function crearAvisoAdmin(
  input: CrearAvisoInput,
  prefs?: Map<string, PreferenciaAdmin>,
): Promise<boolean> {
  try {
    const db  = createAdminClient()
    const def = definicionAdmin(input.tipo)

    const preferencias = prefs ?? await cargarPrefsAdmin(db)
    const pref = preferencias.get(input.tipo)
    if (pref && !pref.activa) return false

    const severidad = pref?.severidad_override ?? severidadAdminDe(input.tipo, input.umbral)

    // Insert idempotente. No usamos upsert/onConflict: idx_admin_notif_idem es un
    // índice PARCIAL y con expresión (coalesce), y PostgREST no puede inferirlo en
    // un ON CONFLICT. Insertamos y tratamos la violación de único (23505) como "ya
    // avisado" — la garantía la sigue dando la BD, no el código.
    const { data, error } = await db
      .from('admin_notificaciones')
      .insert({
        tipo:         input.tipo,
        categoria:    def.categoria,
        seccion:      def.seccion,
        severidad,
        titulo:       input.titulo,
        cuerpo:       input.cuerpo ?? '',
        enlace:       input.enlace ?? null,
        client_id:    input.clientId ?? null,
        entidad_tipo: input.entidadTipo ?? null,
        entidad_id:   input.entidadId ?? null,
        umbral:       input.umbral ?? null,
        meta:         input.meta ?? {},
      })
      .select('id')

    if (error) {
      if (error.code === '23505') return false  // ya avisado de esto
      console.error('[avisos-admin] no se pudo crear', input.tipo, error.message)
      return false
    }
    if ((data?.length ?? 0) === 0) return false

    if (input.sustituyeA?.length && input.entidadId) {
      const nuevaId = data![0].id as number
      await db
        .from('admin_notificaciones')
        .update({ resuelta: true, estado: 'archivada' })
        .eq('entidad_tipo', input.entidadTipo ?? '')
        .eq('entidad_id', input.entidadId)
        .in('tipo', input.sustituyeA)
        .neq('id', nuevaId)
        .neq('estado', 'archivada')
    }
    return true
  } catch (e) {
    console.error('[avisos-admin] error inesperado', input.tipo, e)
    return false
  }
}

/**
 * Archiva los avisos vivos de unos tipos para UN cliente. Lo usan los eventos que
 * cierran una condición desde el panel (registrar un pago resuelve «por vencer» y
 * «vencido»), donde el `sustituyeA` de crearAvisoAdmin no sirve: el aviso nuevo
 * cuelga de otra entidad (el pago) que la del aviso que hay que callar.
 */
export async function resolverAvisosCliente(
  clientId: string,
  tipos: TipoAvisoClave[],
): Promise<void> {
  const { error } = await createAdminClient()
    .from('admin_notificaciones')
    .update({ resuelta: true, estado: 'archivada' })
    .eq('client_id', clientId)
    .in('tipo', tipos)
    .eq('resuelta', false)

  if (error) console.error('[avisos-admin] no se pudo resolver por cliente', clientId, error.message)
}

/**
 * Marca resueltos (y archivados) los avisos de unos tipos cuya condición ya no
 * aplica — lead contactado, mensaje respondido, cliente que renovó. Sin esto la
 * bandeja miente: sigue pidiendo atender algo ya atendido.
 *
 * `entidadesVivas` son las entidades que HOY siguen cumpliendo la condición; todo
 * lo demás de esos tipos se da por resuelto.
 */
export async function resolverAvisosAdmin(
  db: Db,
  tipos: TipoAvisoClave[],
  entidadTipo: string,
  entidadesVivas: string[],
): Promise<void> {
  let q = db
    .from('admin_notificaciones')
    .update({ resuelta: true, estado: 'archivada' })
    .eq('entidad_tipo', entidadTipo)
    .in('tipo', tipos)
    .eq('resuelta', false)

  if (entidadesVivas.length > 0) {
    // `not in` con lista vacía genera SQL inválido en PostgREST: por eso el if.
    q = q.not('entidad_id', 'in', `(${entidadesVivas.map(id => `"${id}"`).join(',')})`)
  }

  const { error } = await q
  if (error) console.error('[avisos-admin] no se pudo resolver', entidadTipo, error.message)
}
