// Permisos por usuario a nivel de módulo/funcionalidad (ver / editar).
// Capa de autorización ENCIMA del gating por tenant (clients.modulos_activos):
// un usuario nunca ve un módulo que el tenant no tiene contratado (intersección).
//
// Modelo «Por defecto + matriz» (ver docs/planes/permisos-por-defecto-y-matriz.md):
//   client_users.permiso_defecto ∈ {sin_acceso, ver, editar}  → aplica a TODOS los
//     módulos contratados, incluidos los futuros.
//   usuario_modulo.permiso       ∈ {sin_acceso, ver, editar}  → excepción por módulo
//     (sobreescribe el defecto). Solo hay fila cuando difiere del defecto.
//   Efectivo por módulo = override ?? defecto. visible = ≠ sin_acceso; editable = editar.
//   admin_empresa: ve SIEMPRE todo lo contratado (matriz ignorada); su `permiso_defecto`
//     gobierna la escritura global (editar = admin normal, ver = admin de solo lectura).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PortalSession } from '@/lib/portal-auth'

export type Permiso = 'sin_acceso' | 'ver' | 'editar'

export interface ModuloPerm {
  clave:   string
  permiso: Permiso
}

export interface AccesoModulos {
  /** Claves de módulos/funcionalidades que el usuario puede ver. */
  visibles: string[]
  /** Subconjunto de `visibles` en el que además puede editar. */
  editable: Set<string>
}

function esPermiso(v: unknown): v is Permiso {
  return v === 'sin_acceso' || v === 'ver' || v === 'editar'
}

/** Lee las excepciones por módulo de un usuario (las que difieren del defecto). */
export async function modulosDeUsuario(
  db: SupabaseClient,
  user_id: string,
): Promise<ModuloPerm[]> {
  const { data } = await db
    .from('usuario_modulo')
    .select('modulo_clave, permiso')
    .eq('user_id', user_id)

  return (data ?? []).map(r => ({
    clave:   r.modulo_clave as string,
    permiso: esPermiso(r.permiso) ? r.permiso : 'ver',
  }))
}

/**
 * Calcula el acceso efectivo a módulos de un usuario. Siempre intersecta con los
 * módulos contratados por el tenant. Ver semántica arriba.
 */
export function calcularAcceso(
  session: Pick<PortalSession, 'rol'>,
  tenantModulos: string[],
  defecto: Permiso,
  overrides: ModuloPerm[],
): AccesoModulos {
  // admin_empresa: ve todo lo contratado; su escritura la fija el defecto (overrides no aplican).
  if (session.rol === 'admin_empresa') {
    return {
      visibles: [...tenantModulos],
      editable: defecto === 'editar' ? new Set(tenantModulos) : new Set<string>(),
    }
  }

  const porModulo = new Map<string, Permiso>()
  for (const o of overrides) porModulo.set(o.clave, o.permiso)

  const visibles: string[] = []
  const editable = new Set<string>()
  for (const clave of tenantModulos) {
    const p = porModulo.get(clave) ?? defecto
    if (p === 'sin_acceso') continue
    visibles.push(clave)
    if (p === 'editar') editable.add(clave)
  }
  return { visibles, editable }
}
