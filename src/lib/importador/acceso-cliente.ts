// Regla ÚNICA de acceso del importador de AUTOSERVICIO (el cliente se importa
// solo, sin impersonación). Es la barandilla comercial de esta «copia»: el motor
// y los adaptadores se comparten con el importador del equipo, pero el candado es
// otro. Se consume desde:
//   - el guard de la página (`/portal/importar-datos`) y el menú de cuenta,
//   - CADA acción de escritura de `importar-cliente.ts` (candado de AGENTS.md).
//
// Se llama `requireImportarEntidad(...)` en cada acción de escritura A PROPÓSITO,
// no un helper escondido: así `scripts/audit-gating.mjs` ve el portero en el
// cuerpo de la acción (como el importador del equipo hace con `puedeEditarAlgunModulo`).

import { createAdminClient } from '@/lib/supabase/admin'
import { puedeImportar } from '@/lib/permisos'
import { esMigracionEstado, type MigracionEstado } from '@/lib/migracion'
import type { EtiquetasSector } from '@/lib/sector'
import { ADAPTADORES } from './adaptadores'
import type { PortalSession } from '@/lib/portal-auth'

export interface EntidadImportable {
  entidad:  string   // clave del adaptador (== `ADAPTADORES[entidad]`)
  etiqueta: string
}

export interface AccesoImportCliente {
  /**
   * Regla única de visibilidad (plan §6): el autoservicio está encendido para
   * este cliente, la migración NO la lleva el equipo, el usuario puede importar
   * y hay al menos una entidad con módulo contratado. Todo lo demás (la página,
   * el menú, el aviso, el candado por acción) se cuelga de este booleano.
   */
  disponible:        boolean
  /** Entidades que ESTE usuario puede importar (módulo contratado ∩ puede importar). */
  entidades:         EntidadImportable[]
  autoimport_activo: boolean
  migracion_estado:  MigracionEstado
}

// Orden de construcción recomendado: maestros primero, estado financiero después
// (lo de abajo se apoya en lo de arriba). Mismo criterio que el wizard del equipo.
// Las entidades no contratadas por el tenant caen solas; una futura sin orden va al final.
const ORDEN: string[] = [
  'terceros', 'productos', 'servicios', 'catalogo', 'profesionales', 'suscripciones', 'personal',
  'stock_inicial', 'tesoreria_saldo', 'gastos', 'cobros',
]

function porOrden(a: string, b: string): number {
  const ia = ORDEN.indexOf(a)
  const ib = ORDEN.indexOf(b)
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
}

/**
 * Estado de acceso del importador de autoservicio para una sesión. Lee la ficha
 * del cliente UNA vez (módulos contratados + interruptor de emergencia + estado de
 * migración) y cruza con el permiso del usuario. No consulta `solo_lectura`: el
 * «operador solo-importar» es solo_lectura en la edición a mano y aun así importa
 * (excepción estrecha, paralela a las tasas de cambio — plan §4).
 */
export async function accesoImportCliente(session: PortalSession): Promise<AccesoImportCliente> {
  const db = createAdminClient()
  const { data: cli } = await db
    .from('clients')
    .select('modulos_activos, autoimport_activo, migracion_estado')
    .eq('client_id', session.client_id)
    .maybeSingle()

  const modulos: string[] = Array.isArray(cli?.modulos_activos) ? (cli.modulos_activos as string[]) : []
  // Interruptor de emergencia: DEFAULT true, solo un `false` explícito lo apaga.
  const autoimport_activo = cli?.autoimport_activo !== false
  const migracion_estado: MigracionEstado = esMigracionEstado(cli?.migracion_estado)
    ? cli.migracion_estado
    : 'sin_datos_previos'

  // La lista de entidades ES el reflejo del permiso: sin `puede_importar`, vacía.
  const puede = puedeImportar(session)
  const entidades: EntidadImportable[] = puede
    ? Object.entries(ADAPTADORES)
        // `soloEquipo` es la puerta que NO se abre aquí: hay entidades que solo
        // ofrece el importador del equipo (§`Adaptador.soloEquipo`). Se filtra en
        // la lista y no en la página porque de esta lista cuelga también el
        // candado por acción (`requireImportarEntidad`).
        .filter(([, a]) => !a.soloEquipo && a.modulos.some(m => modulos.includes(m)))
        .map(([entidad, a]) => ({ entidad, etiqueta: a.etiqueta }))
        .sort((x, y) => porOrden(x.entidad, y.entidad))
    : []

  const disponible =
    autoimport_activo &&
    migracion_estado !== 'a_cargo_equipo' &&
    puede &&
    entidades.length > 0

  return { disponible, entidades, autoimport_activo, migracion_estado }
}

/**
 * Portero por ACCIÓN del importador de cliente: ¿puede esta sesión escribir en
 * `entidad`? Misma regla que la visibilidad, restringida a UNA entidad (su módulo
 * contratado). Es el candado comercial de AGENTS.md para el importador de
 * autoservicio; se invoca literalmente en cada acción de escritura de
 * `importar-cliente.ts` para que `audit:gating` lo reconozca.
 */
export async function requireImportarEntidad(
  session: PortalSession,
  entidad: string,
): Promise<boolean> {
  const acceso = await accesoImportCliente(session)
  return acceso.disponible && acceso.entidades.some(e => e.entidad === entidad)
}

/**
 * Nombre VISIBLE de una entidad importable, para no hornear «Carta» ni el vertical en
 * el código. Solo dos entidades se apartan de la etiqueta del adaptador:
 *  - `catalogo`: en restauración toma la palabra del cliente (Carta/Menú); fuera de
 *    ella se queda en «Catálogo digital» (no en «Servicios», que chocaría con la
 *    entidad de servicios del ERP).
 *  - `profesionales`: fijo «Personal de citas». Su recurso de reservas por sector NO
 *    vale aquí (para un restaurante sería «Mesas», y esto es de citas, no de mesas).
 * Es solo presentación: no toca el candado, por eso vive fuera de la regla de acceso.
 */
export function etiquetaEntidadImport(entidad: string, fallback: string, et: EtiquetasSector): string {
  if (entidad === 'catalogo')
    return et.catalogoIcono === 'comida' ? (et.catalogo || fallback) : 'Catálogo digital'
  if (entidad === 'profesionales') return 'Personal de citas'
  return fallback
}
