'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireContextoAdmin } from '@/lib/admin-guard'
import { obtenerContextoAdmin } from '@/lib/roles-server'
import type { ContextoAdmin } from '@/lib/roles'
import type { Severidad } from '@/lib/notificaciones/catalogo'
import {
  CATALOGO_ADMIN, tiposAdminImplementados, definicionAdmin,
  type CategoriaAdmin, type TipoAvisoClave,
} from '@/lib/notificaciones/admin/catalogo'
import { tiposVisibles } from '@/lib/notificaciones/admin/visibilidad'

// Bandeja del EQUIPO (estado de lectura compartido, igual que en el portal). El
// candado de cada acción es la sesión de admin; lo que además se filtra es QUÉ
// avisos ve cada uno: un vendedor solo los de sus secciones, y los de plataforma
// (seccion NULL) solo el super_admin. Ese filtro se aplica en la QUERY, no en la
// UI: ocultar en pantalla no es control de acceso.

export interface AvisoAdminFila {
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

/** Contexto + tipos visibles, o null si no hay sesión de admin autorizada. */
async function contexto(): Promise<{ ctx: ContextoAdmin; tipos: TipoAvisoClave[] } | null> {
  const ctx = await obtenerContextoAdmin()
  if (!ctx) return null
  return { ctx, tipos: tiposVisibles(ctx) }
}

export type FiltroBandejaAdmin = 'todas' | 'no_leidas' | CategoriaAdmin

export async function listarAvisos(
  filtro: FiltroBandejaAdmin = 'todas',
  limite = 50,
): Promise<AvisoAdminFila[]> {
  const c = await contexto()
  if (!c || c.tipos.length === 0) return []

  let q = createAdminClient()
    .from('admin_notificaciones')
    .select(COLS)
    .in('tipo', c.tipos)
    .order('created_at', { ascending: false })
    .limit(limite)

  if (filtro === 'no_leidas')   q = q.eq('estado', 'nueva')
  else if (filtro === 'todas')  q = q.neq('estado', 'archivada')
  else                          q = q.eq('categoria', filtro).neq('estado', 'archivada')

  const { data } = await q
  return (data ?? []) as AvisoAdminFila[]
}

/**
 * Carga inicial del proveedor (layout del admin). Va en UNA acción a propósito: si
 * el layout llamara a las tres por separado, cada una resolvería la sesión y los
 * permisos otra vez —tres idas a Supabase Auth en cada navegación del panel—.
 */
export async function cargarAvisosIniciales(): Promise<{
  noLeidas:  number
  recientes: AvisoAdminFila[]
  popups:    AvisoAdminFila[]
}> {
  const c = await contexto()
  if (!c || c.tipos.length === 0) return { noLeidas: 0, recientes: [], popups: [] }

  const db = createAdminClient()
  const [{ count }, { data: recientes }, { data: popups }] = await Promise.all([
    db.from('admin_notificaciones')
      .select('id', { count: 'exact', head: true })
      .in('tipo', c.tipos).eq('estado', 'nueva'),
    db.from('admin_notificaciones')
      .select(COLS)
      .in('tipo', c.tipos).neq('estado', 'archivada')
      .order('created_at', { ascending: false }).limit(8),
    db.from('admin_notificaciones')
      .select(COLS)
      .in('tipo', c.tipos).eq('estado', 'nueva')
      .in('severidad', ['aviso', 'urgente'])
      .order('created_at', { ascending: false }).limit(5),
  ])

  return {
    noLeidas:  count ?? 0,
    recientes: (recientes ?? []) as AvisoAdminFila[],
    // Mismo criterio que popupsAvisosPendientes: el `aviso` sale una vez, el
    // `urgente` cada sesión mientras siga sin leer.
    popups: ((popups ?? []) as AvisoAdminFila[])
      .filter(a => a.severidad === 'urgente' || !a.popup_mostrado),
  }
}

export async function contarAvisosNoLeidos(): Promise<number> {
  const c = await contexto()
  if (!c || c.tipos.length === 0) return 0

  const { count } = await createAdminClient()
    .from('admin_notificaciones')
    .select('id', { count: 'exact', head: true })
    .in('tipo', c.tipos)
    .eq('estado', 'nueva')

  return count ?? 0
}

/**
 * Avisos que deben salir como popup ahora mismo:
 *  · `aviso`   — solo si aún no se mostró (una vez y ya).
 *  · `urgente` — cada sesión mientras siga sin leer: es el punto de ser urgente.
 */
export async function popupsAvisosPendientes(): Promise<AvisoAdminFila[]> {
  const c = await contexto()
  if (!c || c.tipos.length === 0) return []

  const { data } = await createAdminClient()
    .from('admin_notificaciones')
    .select(COLS)
    .in('tipo', c.tipos)
    .eq('estado', 'nueva')
    .in('severidad', ['aviso', 'urgente'])
    .order('created_at', { ascending: false })
    .limit(5)

  return ((data ?? []) as AvisoAdminFila[])
    .filter(a => a.severidad === 'urgente' || !a.popup_mostrado)
}

export async function marcarPopupAvisoMostrado(ids: number[]): Promise<void> {
  const c = await contexto()
  if (!c || ids.length === 0) return

  await createAdminClient()
    .from('admin_notificaciones')
    .update({ popup_mostrado: true })
    .in('tipo', c.tipos)
    .in('id', ids)
}

// ── Marcar y archivar ─────────────────────────────────────────────────────────
// Los ids llegan del navegador, así que el `.in('tipo', tipos)` no es decorativo:
// es lo que impide que un vendedor toque un aviso de una sección que no lleva.

export async function marcarAvisoLeido(id: number): Promise<{ ok: boolean }> {
  const c = await contexto()
  if (!c) return { ok: false }

  const { error } = await createAdminClient()
    .from('admin_notificaciones')
    .update({ estado: 'leida', leida_por: c.ctx.email, leida_at: new Date().toISOString() })
    .in('tipo', c.tipos)
    .eq('id', id)
    .eq('estado', 'nueva')

  revalidatePath('/admin/notificaciones')
  return { ok: !error }
}

export async function marcarAvisosTodosLeidos(): Promise<{ ok: boolean }> {
  const c = await contexto()
  if (!c) return { ok: false }

  const { error } = await createAdminClient()
    .from('admin_notificaciones')
    .update({ estado: 'leida', leida_por: c.ctx.email, leida_at: new Date().toISOString() })
    .in('tipo', c.tipos)
    .eq('estado', 'nueva')

  revalidatePath('/admin/notificaciones')
  return { ok: !error }
}

export async function marcarAvisosLeidosLote(ids: number[]): Promise<{ ok: boolean }> {
  const c = await contexto()
  if (!c || ids.length === 0) return { ok: false }

  const { error } = await createAdminClient()
    .from('admin_notificaciones')
    .update({ estado: 'leida', leida_por: c.ctx.email, leida_at: new Date().toISOString() })
    .in('tipo', c.tipos)
    .in('id', ids)
    .eq('estado', 'nueva')

  revalidatePath('/admin/notificaciones')
  return { ok: !error }
}

export async function archivarAviso(id: number): Promise<{ ok: boolean }> {
  const c = await contexto()
  if (!c) return { ok: false }

  const { error } = await createAdminClient()
    .from('admin_notificaciones')
    .update({ estado: 'archivada' })
    .in('tipo', c.tipos)
    .eq('id', id)

  revalidatePath('/admin/notificaciones')
  return { ok: !error }
}

export async function archivarAvisosLote(ids: number[]): Promise<{ ok: boolean }> {
  const c = await contexto()
  if (!c || ids.length === 0) return { ok: false }

  const { error } = await createAdminClient()
    .from('admin_notificaciones')
    .update({ estado: 'archivada' })
    .in('tipo', c.tipos)
    .in('id', ids)

  revalidatePath('/admin/notificaciones')
  return { ok: !error }
}

// ── Preferencias del equipo ───────────────────────────────────────────────────
// Son del EQUIPO, no de cada persona (igual que el estado de lectura), así que
// cambiarlas afecta a todos: solo super_admin. Un vendedor ve la bandeja pero no
// decide de qué se avisa al resto.

export interface PreferenciaAvisoFila {
  tipo:              TipoAvisoClave
  etiqueta:          string
  descripcion:       string
  categoria:         CategoriaAdmin
  activa:            boolean
  severidad:         Severidad
  severidad_default: Severidad
}

export async function listarPreferenciasAvisos(): Promise<PreferenciaAvisoFila[]> {
  const ctx = await obtenerContextoAdmin()
  if (!ctx || ctx.rol !== 'super_admin') return []

  const { data } = await createAdminClient()
    .from('admin_notificacion_config')
    .select('tipo, activa, severidad_override')

  const guardadas = new Map(
    (data ?? []).map(p => [p.tipo as string, p as { activa: boolean; severidad_override: Severidad | null }]),
  )

  return tiposAdminImplementados().map(tipo => {
    const def  = CATALOGO_ADMIN[tipo]
    const fila = guardadas.get(tipo)
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

export async function guardarPreferenciaAviso(
  tipo: TipoAvisoClave,
  activa: boolean,
  severidadOverride: Severidad | null,
): Promise<{ ok: boolean }> {
  const ctx = await requireContextoAdmin()
  if (ctx.rol !== 'super_admin') return { ok: false }
  // Solo claves del catálogo: la clave viaja desde el navegador.
  if (!(tipo in CATALOGO_ADMIN)) return { ok: false }

  // Guardar la severidad del catálogo como override no aporta nada: se limpia para
  // que el tipo siga heredando si algún día cambiamos el default.
  const override = severidadOverride === definicionAdmin(tipo).severidad ? null : severidadOverride

  const { error } = await createAdminClient()
    .from('admin_notificacion_config')
    .upsert({ tipo, activa, severidad_override: override, updated_at: new Date().toISOString() },
            { onConflict: 'tipo' })

  revalidatePath('/admin/notificaciones')
  return { ok: !error }
}

/** Activa o desactiva de golpe todos los tipos de una categoría. */
export async function guardarPreferenciasAvisosLote(
  tipos: TipoAvisoClave[],
  activa: boolean,
): Promise<{ ok: boolean }> {
  const ctx = await requireContextoAdmin()
  if (ctx.rol !== 'super_admin') return { ok: false }

  const validos = tipos.filter(t => t in CATALOGO_ADMIN)
  if (validos.length === 0) return { ok: false }

  const db = createAdminClient()

  // Un upsert manda la fila ENTERA: sin leer antes el `severidad_override`, el
  // interruptor del grupo borraría en silencio el nivel elegido tipo a tipo.
  const { data: previas } = await db
    .from('admin_notificacion_config')
    .select('tipo, severidad_override')
    .in('tipo', validos)

  const overrideDe = new Map(
    (previas ?? []).map(p => [p.tipo as string, (p.severidad_override ?? null) as Severidad | null]),
  )

  const { error } = await db
    .from('admin_notificacion_config')
    .upsert(
      validos.map(tipo => ({
        tipo,
        activa,
        severidad_override: overrideDe.get(tipo) ?? null,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'tipo' },
    )

  revalidatePath('/admin/notificaciones')
  return { ok: !error }
}
