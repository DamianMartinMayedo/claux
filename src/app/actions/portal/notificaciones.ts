'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession } from './auth'
import {
  CATALOGO, tiposImplementados, definicion,
  type Categoria, type Severidad, type TipoClave,
} from '@/lib/notificaciones/catalogo'

// La bandeja es COMPARTIDA del negocio y solo la ven los admin_empresa: el
// candado de todas estas acciones es el rol, no un módulo (las notificaciones
// son plataforma, no algo que se contrate). Cada notificación ya nació filtrada
// por módulo en crearNotificacion(), así que un tenant nunca ve avisos de algo
// que no pagó.

export interface NotificacionFila {
  id:         number
  tipo:       string
  categoria:  string
  severidad:  Severidad
  titulo:     string
  cuerpo:     string
  enlace:     string | null
  estado:     'nueva' | 'leida' | 'archivada'
  popup_mostrado: boolean
  created_at: string
}

const COLS = 'id, tipo, categoria, severidad, titulo, cuerpo, enlace, estado, popup_mostrado, created_at'

/** Sesión válida solo si es admin del negocio. */
async function sesionAdmin() {
  const session = await getPortalSession()
  if (!session || session.rol !== 'admin_empresa') return null
  return session
}

export type FiltroBandeja = 'todas' | 'no_leidas' | Categoria

export async function listarNotificaciones(
  filtro: FiltroBandeja = 'todas',
  limite = 50,
): Promise<NotificacionFila[]> {
  const session = await sesionAdmin()
  if (!session) return []

  let q = createAdminClient()
    .from('notificaciones')
    .select(COLS)
    .eq('client_id', session.client_id)
    .order('created_at', { ascending: false })
    .limit(limite)

  if (filtro === 'no_leidas')     q = q.eq('estado', 'nueva')
  else if (filtro === 'todas')    q = q.neq('estado', 'archivada')
  else                            q = q.eq('categoria', filtro).neq('estado', 'archivada')

  const { data } = await q
  return (data ?? []) as NotificacionFila[]
}

export async function contarNoLeidas(): Promise<number> {
  const session = await sesionAdmin()
  if (!session) return 0

  const { count } = await createAdminClient()
    .from('notificaciones')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', session.client_id)
    .eq('estado', 'nueva')

  return count ?? 0
}

/**
 * Notificaciones que deben salir como popup ahora mismo:
 *  · `aviso`   — solo si aún no se mostró (una vez y ya).
 *  · `urgente` — cada sesión mientras siga sin leer: es el punto de ser urgente.
 */
export async function popupsPendientes(): Promise<NotificacionFila[]> {
  const session = await sesionAdmin()
  if (!session) return []

  const { data } = await createAdminClient()
    .from('notificaciones')
    .select(COLS)
    .eq('client_id', session.client_id)
    .eq('estado', 'nueva')
    .in('severidad', ['aviso', 'urgente'])
    .order('created_at', { ascending: false })
    .limit(5)

  return ((data ?? []) as NotificacionFila[])
    .filter(n => n.severidad === 'urgente' || !n.popup_mostrado)
}

export async function marcarPopupMostrado(ids: number[]): Promise<void> {
  const session = await sesionAdmin()
  if (!session || ids.length === 0) return

  await createAdminClient()
    .from('notificaciones')
    .update({ popup_mostrado: true })
    .eq('client_id', session.client_id)
    .in('id', ids)
}

export async function marcarLeida(id: number): Promise<{ ok: boolean }> {
  const session = await sesionAdmin()
  if (!session) return { ok: false }

  const { error } = await createAdminClient()
    .from('notificaciones')
    .update({ estado: 'leida', leida_por: session.email, leida_at: new Date().toISOString() })
    .eq('client_id', session.client_id)
    .eq('id', id)
    .eq('estado', 'nueva')

  revalidatePath('/portal/notificaciones')
  return { ok: !error }
}

export async function marcarTodasLeidas(): Promise<{ ok: boolean }> {
  const session = await sesionAdmin()
  if (!session) return { ok: false }

  const { error } = await createAdminClient()
    .from('notificaciones')
    .update({ estado: 'leida', leida_por: session.email, leida_at: new Date().toISOString() })
    .eq('client_id', session.client_id)
    .eq('estado', 'nueva')

  revalidatePath('/portal/notificaciones')
  return { ok: !error }
}

// ── Acciones en lote ──────────────────────────────────────────────────────────
// Mismo candado que el resto (rol admin + filtro por client_id): los ids llegan
// del navegador, así que el `.eq('client_id')` es lo que impide tocar la bandeja
// de otro tenant aunque alguien mande ids ajenos.

export async function marcarLeidasLote(ids: number[]): Promise<{ ok: boolean }> {
  const session = await sesionAdmin()
  if (!session || ids.length === 0) return { ok: false }

  const { error } = await createAdminClient()
    .from('notificaciones')
    .update({ estado: 'leida', leida_por: session.email, leida_at: new Date().toISOString() })
    .eq('client_id', session.client_id)
    .in('id', ids)
    .eq('estado', 'nueva')

  revalidatePath('/portal/notificaciones')
  return { ok: !error }
}

export async function archivarLote(ids: number[]): Promise<{ ok: boolean }> {
  const session = await sesionAdmin()
  if (!session || ids.length === 0) return { ok: false }

  const { error } = await createAdminClient()
    .from('notificaciones')
    .update({ estado: 'archivada' })
    .eq('client_id', session.client_id)
    .in('id', ids)

  revalidatePath('/portal/notificaciones')
  return { ok: !error }
}

export async function archivarNotificacion(id: number): Promise<{ ok: boolean }> {
  const session = await sesionAdmin()
  if (!session) return { ok: false }

  const { error } = await createAdminClient()
    .from('notificaciones')
    .update({ estado: 'archivada' })
    .eq('client_id', session.client_id)
    .eq('id', id)

  revalidatePath('/portal/notificaciones')
  return { ok: !error }
}

// ── Preferencias ──────────────────────────────────────────────────────────────

export interface PreferenciaFila {
  tipo:               TipoClave
  etiqueta:           string
  descripcion:        string
  categoria:          Categoria
  activa:             boolean
  /** Severidad efectiva elegida por el tenant (o la del catálogo si no tocó nada). */
  severidad:          Severidad
  /** Severidad que trae el catálogo, para poder mostrar "por defecto". */
  severidad_default:  Severidad
}

export async function listarPreferencias(): Promise<PreferenciaFila[]> {
  const session = await sesionAdmin()
  if (!session) return []

  const { data } = await createAdminClient()
    .from('notificacion_config')
    .select('tipo, activa, severidad_override')
    .eq('client_id', session.client_id)

  const guardadas = new Map(
    (data ?? []).map(p => [p.tipo as string, p as { activa: boolean; severidad_override: Severidad | null }]),
  )

  return tiposImplementados().map(tipo => {
    const def   = CATALOGO[tipo]
    const fila  = guardadas.get(tipo)
    return {
      tipo,
      etiqueta:          def.etiqueta,
      descripcion:       def.descripcion,
      categoria:         def.categoria,
      activa:            fila?.activa ?? true,
      severidad:         fila?.severidad_override ?? def.severidad,
      severidad_default: def.severidad,
    }
  })
}

/** Activa o desactiva de golpe todos los tipos de una categoría. */
export async function guardarPreferenciasLote(
  tipos: TipoClave[],
  activa: boolean,
): Promise<{ ok: boolean }> {
  const session = await sesionAdmin()
  if (!session) return { ok: false }

  // Solo claves del catálogo: la lista viaja desde el navegador.
  const validos = tipos.filter(t => t in CATALOGO)
  if (validos.length === 0) return { ok: false }

  const db = createAdminClient()

  // Un upsert manda la fila ENTERA: sin leer antes el `severidad_override`, el
  // interruptor del grupo borraría en silencio el nivel que el dueño hubiera
  // elegido tipo a tipo. Se conserva.
  const { data: previas } = await db
    .from('notificacion_config')
    .select('tipo, severidad_override')
    .eq('client_id', session.client_id)
    .in('tipo', validos)

  const overrideDe = new Map(
    (previas ?? []).map(p => [p.tipo as string, (p.severidad_override ?? null) as Severidad | null]),
  )

  const { error } = await db
    .from('notificacion_config')
    .upsert(
      validos.map(tipo => ({
        client_id: session.client_id,
        tipo,
        activa,
        severidad_override: overrideDe.get(tipo) ?? null,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'client_id,tipo' },
    )

  revalidatePath('/portal/notificaciones')
  return { ok: !error }
}

export async function guardarPreferencia(
  tipo: TipoClave,
  activa: boolean,
  severidadOverride: Severidad | null,
): Promise<{ ok: boolean }> {
  const session = await sesionAdmin()
  if (!session) return { ok: false }
  // Solo tipos del catálogo: la clave viaja desde el navegador.
  if (!(tipo in CATALOGO)) return { ok: false }

  // Guardar la severidad del catálogo como override no aporta nada: se limpia
  // para que el tipo siga heredando si algún día cambiamos el default.
  const override = severidadOverride === definicion(tipo).severidad ? null : severidadOverride

  const { error } = await createAdminClient()
    .from('notificacion_config')
    .upsert({
      client_id: session.client_id,
      tipo,
      activa,
      severidad_override: override,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'client_id,tipo' })

  revalidatePath('/portal/notificaciones')
  return { ok: !error }
}
