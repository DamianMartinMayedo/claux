// ── Contexto ACOTADO del agente por tenant ──
// FUNDAMENTAL (CONTEXTO §7 / coste): el agente solo recibe un resumen compacto y
// ya agregado de SU negocio (no se vuelca la BD). Reutilizamos obtenerDashboard(),
// que ya está scoped por client_id y gateado por módulos contratados: un cliente
// con solo Reservas no aporta números financieros. Esto mantiene los tokens bajos
// y el aislamiento entre tenants estricto.

import { createAdminClient } from '@/lib/supabase/admin'
import { obtenerDashboard, type DashboardData } from '@/app/actions/portal/dashboard'
import { normalizarModulos } from '@/lib/modulos'
import { INSTRUCCIONES_DEFAULT } from './documentos'

// Resumen compacto del catálogo público (solo si el módulo catalogo_qr está
// activo). Diseñado como base "pública-segura": ni cifras financieras ni datos de
// clientes, así que sirve tal cual para un futuro chat embebido de clientes finales.
export interface CatalogoResumen {
  total: number
  categorias: number
  sin_foto: number
  sin_descripcion: number
  sin_precio: number
  no_disponibles: number
  ejemplos: string[]
}

export interface ContextoNegocio {
  clientId: string
  nombreEmpresa: string
  nombreUsuario: string | null
  nombreAgente: string
  tono: string
  instrucciones: string
  modulos: string[]
  data: DashboardData | null
  catalogo: CatalogoResumen | null
}

export const NOMBRE_AGENTE_DEFAULT = 'Claux'
const TONO_DEFAULT = 'cercano y directo, como un asesor de confianza'

// Nombre, tono e instrucciones del agente son GLOBALES (los fija el equipo CLAUX
// en el admin), no por cliente. Se leen de settings.
export async function configAgente(): Promise<{ nombreAgente: string; tono: string; instrucciones: string }> {
  const db = createAdminClient()
  const { data } = await db.from('settings').select('key, value').in('key', ['ia_nombre_agente', 'ia_tono', 'ia_instrucciones'])
  const S = Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
  return {
    nombreAgente:  (S.ia_nombre_agente || '').trim() || NOMBRE_AGENTE_DEFAULT,
    tono:          (S.ia_tono || '').trim() || TONO_DEFAULT,
    instrucciones: (S.ia_instrucciones || '').trim() || INSTRUCCIONES_DEFAULT,
  }
}

export async function construirContexto(clientId: string, nombreUsuario?: string | null): Promise<ContextoNegocio> {
  const db = createAdminClient()
  const [{ data: cliente }, data, agente] = await Promise.all([
    db.from('clients').select('nombre_empresa, modulos_activos').eq('client_id', clientId).single(),
    obtenerDashboard(),
    configAgente(),
  ])
  const { nombreAgente, tono, instrucciones } = agente
  const modulos = normalizarModulos(cliente?.modulos_activos)
  return {
    clientId,
    nombreEmpresa: cliente?.nombre_empresa ?? data?.nombreEmpresa ?? 'el negocio',
    nombreUsuario: nombreUsuario?.trim() || null,
    nombreAgente,
    tono,
    instrucciones,
    modulos,
    data,
    catalogo: modulos.includes('catalogo_qr') ? await resumenCatalogo(db, clientId) : null,
  }
}

// Cuenta agregada del catálogo del tenant (sin volcar filas): totales y huecos a
// completar. Scoped por client_id.
async function resumenCatalogo(db: ReturnType<typeof createAdminClient>, clientId: string): Promise<CatalogoResumen> {
  const [{ data: items }, { count: categorias }] = await Promise.all([
    db.from('catalogo_items').select('nombre, foto_url, descripcion, precio, disponible').eq('client_id', clientId).eq('activo', true),
    db.from('catalogo_categorias').select('categoria_id', { count: 'exact', head: true }).eq('client_id', clientId).eq('activa', true),
  ])
  const rows = (items ?? []) as { nombre: string; foto_url: string | null; descripcion: string | null; precio: number | null; disponible: boolean }[]
  return {
    total: rows.length,
    categorias: categorias ?? 0,
    sin_foto: rows.filter(r => !r.foto_url).length,
    sin_descripcion: rows.filter(r => !r.descripcion).length,
    sin_precio: rows.filter(r => r.precio == null).length,
    no_disponibles: rows.filter(r => !r.disponible).length,
    ejemplos: rows.slice(0, 8).map(r => r.nombre),
  }
}

// Snapshot compacto en JSON para el prompt. `foco` recorta a la sección relevante
// (ahorra tokens en insights puntuales); sin foco, incluye todo lo disponible.
export function contextoComoTexto(
  ctx: ContextoNegocio,
  foco?: 'ventas' | 'gastos' | 'general' | 'catalogo',
): string {
  // Foco catálogo: solo el resumen del catálogo (ahorra tokens en su insight).
  if (foco === 'catalogo') {
    return JSON.stringify({ fecha: ctx.data?.fecha ?? null, catalogo: ctx.catalogo ?? null })
  }
  const d = ctx.data
  if (!d) return ctx.catalogo ? JSON.stringify({ catalogo: ctx.catalogo }) : '{}'
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
    if (ctx.catalogo) snap.catalogo = ctx.catalogo
  }
  return JSON.stringify(snap)
}
