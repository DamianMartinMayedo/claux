// Permisos por usuario a nivel de módulo/funcionalidad (ver / editar).
// Capa de autorización ENCIMA del gating por tenant (clients.modulos_activos):
// un usuario nunca ve un módulo que el tenant no tiene contratado (intersección).
//
// Semántica (retrocompatible, ver migración 082):
//   admin_empresa      → todos los módulos contratados.
//   usuario SIN filas  → todos los contratados (no rompe operadores existentes).
//   usuario CON filas  → solo esas claves ∩ contratados; puede_editar por fila.
//   'solo_lectura' (client_users.solo_lectura) es el interruptor maestro: si está
//   activo, no edita nada aunque puede_editar sea TRUE.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PortalSession } from '@/lib/portal-auth'

export interface ModuloPerm {
  clave:        string
  puede_editar: boolean
}

export interface AccesoModulos {
  /** Claves de módulos/funcionalidades que el usuario puede ver. */
  visibles: string[]
  /** Subconjunto de `visibles` en el que además puede editar. */
  editable: Set<string>
}

/** Lee las filas de permisos por módulo de un usuario. Sin filas = "todos" (retrocompat). */
export async function modulosDeUsuario(
  db: SupabaseClient,
  user_id: string,
): Promise<ModuloPerm[]> {
  const { data } = await db
    .from('usuario_modulo')
    .select('modulo_clave, puede_editar')
    .eq('user_id', user_id)

  return (data ?? []).map(r => ({
    clave:        r.modulo_clave as string,
    puede_editar: !!r.puede_editar,
  }))
}

/**
 * Calcula el acceso efectivo a módulos de un usuario. Siempre intersecta con los
 * módulos contratados por el tenant. Ver semántica arriba.
 */
export function calcularAcceso(
  session: Pick<PortalSession, 'rol' | 'solo_lectura'>,
  tenantModulos: string[],
  filas: ModuloPerm[],
): AccesoModulos {
  const contratados = new Set(tenantModulos)

  // admin_empresa, o usuario sin restricciones explícitas → ve todo lo contratado.
  const sinRestriccion = session.rol === 'admin_empresa' || filas.length === 0

  const visibles = sinRestriccion
    ? [...tenantModulos]
    : filas.map(f => f.clave).filter(c => contratados.has(c))

  // 'Solo lectura' apaga toda edición, sea cual sea el detalle por módulo.
  if (session.solo_lectura) {
    return { visibles, editable: new Set<string>() }
  }

  const editable = sinRestriccion
    ? new Set(visibles)
    : new Set(
        filas.filter(f => f.puede_editar).map(f => f.clave).filter(c => contratados.has(c)),
      )

  return { visibles, editable }
}
