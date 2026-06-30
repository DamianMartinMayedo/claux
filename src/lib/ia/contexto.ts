// ── Contexto ACOTADO del agente por tenant ──
// FUNDAMENTAL (CONTEXTO §7 / coste): el agente solo recibe un resumen compacto y
// ya agregado de SU negocio (no se vuelca la BD). Reutilizamos obtenerDashboard(),
// que ya está scoped por client_id y gateado por módulos contratados: un cliente
// con solo Reservas no aporta números financieros. Esto mantiene los tokens bajos
// y el aislamiento entre tenants estricto.

import { createAdminClient } from '@/lib/supabase/admin'
import { obtenerDashboard, type DashboardData } from '@/app/actions/portal/dashboard'
import { normalizarModulos } from '@/lib/modulos'

export interface ContextoNegocio {
  clientId: string
  nombreEmpresa: string
  nombreAgente: string
  tono: string
  modulos: string[]
  data: DashboardData | null
}

const NOMBRE_AGENTE_DEFAULT = 'Asistente'

interface IaConfigRaw { nombre_agente?: unknown; tono?: unknown }

export function leerIaConfig(raw: unknown): { nombreAgente: string; tono: string } {
  const c = (raw && typeof raw === 'object' ? raw : {}) as IaConfigRaw
  const nombre = typeof c.nombre_agente === 'string' && c.nombre_agente.trim() ? c.nombre_agente.trim() : NOMBRE_AGENTE_DEFAULT
  const tono   = typeof c.tono === 'string' && c.tono.trim() ? c.tono.trim() : 'cercano y profesional'
  return { nombreAgente: nombre, tono }
}

export async function construirContexto(clientId: string): Promise<ContextoNegocio> {
  const db = createAdminClient()
  const [{ data: cliente }, data] = await Promise.all([
    db.from('clients').select('nombre_empresa, modulos_activos, ia_config').eq('client_id', clientId).single(),
    obtenerDashboard(),
  ])
  const { nombreAgente, tono } = leerIaConfig(cliente?.ia_config)
  return {
    clientId,
    nombreEmpresa: cliente?.nombre_empresa ?? data?.nombreEmpresa ?? 'el negocio',
    nombreAgente,
    tono,
    modulos: normalizarModulos(cliente?.modulos_activos),
    data,
  }
}

// Snapshot compacto en JSON para el prompt. `foco` recorta a la sección relevante
// (ahorra tokens en insights puntuales); sin foco, incluye todo lo disponible.
export function contextoComoTexto(
  ctx: ContextoNegocio,
  foco?: 'ventas' | 'gastos' | 'general',
): string {
  const d = ctx.data
  if (!d) return '{}'
  const cont = d.contabilidad
  const snap: Record<string, unknown> = { fecha: d.fecha, moneda_consolidacion: cont?.monedaConsolidacion || null }

  const incluyeContab = (foco === undefined || foco === 'general' || foco === 'ventas' || foco === 'gastos')
  if (incluyeContab && cont) {
    snap.contabilidad = {
      por_moneda: cont.porMoneda.map(m => ({
        moneda: m.moneda,
        ventas_mes: m.ventasMes,
        gastos_mes: m.gastosMes,
        neto_mes: m.netoMes,
        serie_6m: m.serie.map(s => ({ mes: s.etiqueta, ventas: s.ventas, gastos: s.gastos })),
      })),
      consolidado: cont.consolidado ? {
        moneda: cont.consolidado.moneda,
        ventas_mes: cont.consolidado.ventasMes,
        gastos_mes: cont.consolidado.gastosMes,
        serie_6m: cont.consolidado.serie.map(s => ({ mes: s.etiqueta, ventas: s.ventas, gastos: s.gastos })),
      } : null,
      caja: cont.caja,
    }
  }
  if (foco === undefined || foco === 'general') {
    if (d.inventario) snap.inventario = { total_productos: d.inventario.totalProductos, bajo_minimo: d.inventario.bajoMinimo }
    if (d.rrhh)       snap.rrhh = d.rrhh
    if (d.reservas)   snap.reservas = { hoy: d.reservas.hoyCount, proxima: d.reservas.proxima, carga_7d: d.reservas.serie7 }
    if (d.citas)      snap.citas = { hoy: d.citas.hoyCount, proxima: d.citas.proxima, carga_7d: d.citas.serie7 }
  }
  return JSON.stringify(snap)
}
