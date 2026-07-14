import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

// Módulo server-only: lecturas agregadas para las métricas del admin. Lo
// consumen páginas ya protegidas (requireAccesoPagina('metricas') /
// requireAccesoPagina('clientes')); usa service_role (createAdminClient).

// Tablas de "creación" por módulo (lo que el cliente CREA). Solo se cuentan las
// de los módulos que el tenant tiene contratados. Fuente: esquema real en BD.
const TABLAS_CREACION: { modulo: string; label: string; tabla: string }[] = [
  { modulo: 'base',           label: 'Facturas',                 tabla: 'facturas' },
  { modulo: 'base',           label: 'Ofertas / presupuestos',   tabla: 'ofertas' },
  { modulo: 'base',           label: 'Gastos y cobros',          tabla: 'gastos_cobros' },
  { modulo: 'base',           label: 'Movimientos de tesorería', tabla: 'movimientos_tesoreria' },
  { modulo: 'inventario',     label: 'Productos',                tabla: 'products' },
  { modulo: 'inventario',     label: 'Compras',                  tabla: 'compras' },
  { modulo: 'inventario',     label: 'Movimientos de inventario', tabla: 'movimientos_inventario' },
  { modulo: 'rrhh',           label: 'Empleados',                tabla: 'empleados' },
  { modulo: 'rrhh',           label: 'Nóminas',                  tabla: 'nominas' },
  { modulo: 'catalogo_qr',    label: 'Ítems de catálogo',        tabla: 'catalogo_items' },
  { modulo: 'reservas_citas', label: 'Reservas y citas',         tabla: 'reservas' },
  { modulo: 'caja',           label: 'Tickets de caja',          tabla: 'caja_tickets' },
]

function diaHace(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

function periodoActual(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Havana', year: 'numeric', month: '2-digit' })
    .format(new Date()).slice(0, 7)
}

function precioModulo(
  m: { precio_fundador_usd: number | null; precio_estandar_usd: number | null },
  tarifa: string | null,
): number {
  return Number((tarifa === 'fundador' ? m.precio_fundador_usd : m.precio_estandar_usd) ?? 0)
}

export type AdopcionModulo = {
  clave: string
  nombre: string
  tipo: string
  contratados: number
  ingresoMensual: number
}
export type UsoModulo = { modulo: string; hits: number }
export type SectorDist = { sector: string; total: number }

export type MetricasGenerales = {
  totalTenants: number
  tenantsActivos7: number
  tenantsActivos30: number
  usuariosActivos7: number
  usuariosActivos30: number
  adopcion: AdopcionModulo[]
  modulosMasUsados: UsoModulo[]
  iaConversaciones: number
  iaTokens: number
  porSector: SectorDist[]
}

/** Métricas agregadas de toda la plataforma. */
export async function obtenerMetricasGenerales(): Promise<MetricasGenerales> {
  const db = createAdminClient()
  const s30 = diaHace(30)
  const s7  = diaHace(7)

  const [{ data: clientes }, { data: catalogo }, { data: uso }, { data: ia }] = await Promise.all([
    db.from('clients').select('client_id, estado, sector, modulos_activos, tarifa'),
    db.from('modulos_catalogo').select('clave, nombre, tipo, precio_fundador_usd, precio_estandar_usd, orden').eq('activo', true).order('orden'),
    db.from('uso_portal').select('client_id, user_id, modulo, hits, dia').gte('dia', s30),
    db.from('ia_uso').select('conversaciones, tokens_in, tokens_out').eq('periodo', periodoActual()),
  ])

  const clientesArr = clientes ?? []
  const catalogoArr = catalogo ?? []
  const usoArr      = uso ?? []

  // Adopción de módulos/addons: cuántos tenants tienen cada clave + ingreso mensual aportado.
  const adopcion: AdopcionModulo[] = catalogoArr.map(m => {
    let contratados = 0
    let ingresoMensual = 0
    for (const c of clientesArr) {
      const activos = Array.isArray(c.modulos_activos) ? (c.modulos_activos as string[]) : []
      if (activos.includes(m.clave)) {
        contratados += 1
        ingresoMensual += precioModulo(m, c.tarifa)
      }
    }
    return { clave: m.clave, nombre: m.nombre, tipo: m.tipo, contratados, ingresoMensual }
  }).sort((a, b) => b.contratados - a.contratados)

  // Usuarios/tenants activos (con actividad en el periodo).
  const tenants30 = new Set<string>(), tenants7 = new Set<string>()
  const users30 = new Set<string>(), users7 = new Set<string>()
  const hitsPorModulo = new Map<string, number>()
  for (const r of usoArr) {
    tenants30.add(r.client_id)
    users30.add(`${r.client_id}·${r.user_id}`)
    hitsPorModulo.set(r.modulo, (hitsPorModulo.get(r.modulo) ?? 0) + (r.hits ?? 0))
    if (r.dia >= s7) {
      tenants7.add(r.client_id)
      users7.add(`${r.client_id}·${r.user_id}`)
    }
  }

  const nombreDe = new Map(catalogoArr.map(m => [m.clave, m.nombre]))
  const modulosMasUsados: UsoModulo[] = [...hitsPorModulo.entries()]
    .map(([modulo, hits]) => ({ modulo: nombreDe.get(modulo) ?? modulo, hits }))
    .sort((a, b) => b.hits - a.hits)

  const iaConversaciones = (ia ?? []).reduce((s, r) => s + (Number(r.conversaciones) || 0), 0)
  const iaTokens = (ia ?? []).reduce((s, r) => s + (Number(r.tokens_in) || 0) + (Number(r.tokens_out) || 0), 0)

  const sectorMap = new Map<string, number>()
  for (const c of clientesArr) {
    const k = (c.sector as string) || 'Sin sector'
    sectorMap.set(k, (sectorMap.get(k) ?? 0) + 1)
  }
  const porSector: SectorDist[] = [...sectorMap.entries()]
    .map(([sector, total]) => ({ sector, total }))
    .sort((a, b) => b.total - a.total)

  return {
    totalTenants:      clientesArr.length,
    tenantsActivos7:   tenants7.size,
    tenantsActivos30:  tenants30.size,
    usuariosActivos7:  users7.size,
    usuariosActivos30: users30.size,
    adopcion,
    modulosMasUsados,
    iaConversaciones,
    iaTokens,
    porSector,
  }
}

export type UsuarioUso = {
  email: string
  nombre: string | null
  rol: string
  estado: string
  last_login_at: string | null
}
export type CreacionModulo = { modulo: string; label: string; total: number }

export type UsoCliente = {
  usuarios: UsuarioUso[]
  usuariosActivos30: number
  creados: CreacionModulo[]
  modulosMasUsados: UsoModulo[]
}

/** Métricas de uso de un cliente concreto. */
export async function obtenerUsoCliente(clientId: string): Promise<UsoCliente> {
  const db = createAdminClient()
  const s30 = diaHace(30)

  const [{ data: cliente }, { data: usuarios }, { data: uso }, { data: catalogo }] = await Promise.all([
    db.from('clients').select('modulos_activos').eq('client_id', clientId).single(),
    db.from('client_users').select('email, nombre, rol, estado, last_login_at').eq('client_id', clientId).order('created_at'),
    db.from('uso_portal').select('modulo, hits').eq('client_id', clientId).gte('dia', s30),
    db.from('modulos_catalogo').select('clave, nombre'),
  ])

  const activos = Array.isArray(cliente?.modulos_activos) ? (cliente!.modulos_activos as string[]) : []

  // Registros creados por módulo (solo módulos contratados). Conteos en paralelo.
  const relevantes = TABLAS_CREACION.filter(t => activos.includes(t.modulo))
  const creados: CreacionModulo[] = await Promise.all(
    relevantes.map(async t => {
      const { count } = await db.from(t.tabla).select('*', { count: 'exact', head: true }).eq('client_id', clientId)
      return { modulo: t.modulo, label: t.label, total: count ?? 0 }
    }),
  )

  // Módulos más usados por este tenant (últimos 30 días).
  const nombreDe = new Map((catalogo ?? []).map(m => [m.clave, m.nombre]))
  const hits = new Map<string, number>()
  for (const r of uso ?? []) hits.set(r.modulo, (hits.get(r.modulo) ?? 0) + (r.hits ?? 0))
  const modulosMasUsados: UsoModulo[] = [...hits.entries()]
    .map(([modulo, h]) => ({ modulo: nombreDe.get(modulo) ?? modulo, hits: h }))
    .sort((a, b) => b.hits - a.hits)

  const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30)
  const usuariosActivos30 = (usuarios ?? []).filter(u => u.last_login_at && new Date(u.last_login_at) >= hace30).length

  return {
    usuarios: (usuarios ?? []) as UsuarioUso[],
    usuariosActivos30,
    creados,
    modulosMasUsados,
  }
}
