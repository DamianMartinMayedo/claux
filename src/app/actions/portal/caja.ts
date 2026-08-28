'use server'

// Server actions del módulo Caja (portal del dueño). Gestión de instancias de
// caja (crear/config/token), lectura del detalle (operaciones + movimientos de
// stock + cierres) y subida de archivo para sincronizar sin conexión.
// El detalle vive en las tablas del módulo; los efectos en Tesorería/Inventario
// los aplica el núcleo compartido (@/lib/caja/ingesta), no estas acciones.

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarModulo }  from './auth'
import { obtenerEmpresas }   from './empresas'
import { ingestarLote, contabilizarCierre, type LotePayload, type CajaRow } from '@/lib/caja/ingesta'
import { tieneModulo }      from '@/lib/modulos'
import { LIMITE_LISTADO, limiteDelFiltro, rangoUltimosMeses, type FiltroListado } from '@/lib/listados'
import { diaDelNegocio } from '@/lib/fecha-tz'
import { comprobarLimite } from '@/lib/limites'

// ── Tipos ─────────────────────────────────────────────────────────────────────

/** Qué baja al dispositivo (mig. 120). Mismo vocabulario que `TipoImportacion` del catálogo QR.
 *  Sin `export`: un fichero `'use server'` solo puede exportar funciones async (un array
 *  es un objeto en runtime y rompe el build). Solo se usa aquí abajo. */
const TIPOS_CATALOGO = ['PRODUCTO', 'SERVICIO', 'AMBOS'] as const

export interface Caja {
  caja_id:           string
  client_id:         string
  empresa_id:        string
  nombre:            string
  almacen_id:        string | null
  cuentas_moneda:    Record<string, string>
  /** Moneda → cuenta donde entra lo cobrado por transferencia (mig. 172). Opcional. */
  cuentas_transferencia: Record<string, string>
  monedas_aceptadas: string[]
  tipos_catalogo:    string
  sync_token:        string
  activa:            boolean
  last_sync_at:      string | null
  created_at:        string
}

export interface Ticket {
  ticket_uuid: string
  caja_id:     string
  fecha:       string
  moneda:      string
  total:       number
  // Lo que habría costado sin descuentos. En los tickets anteriores a la migración 207
  // vale lo mismo que el total: no hubo descuento.
  bruto:       number
  descuento_importe: number
  medio_pago:  string | null
  sesion_uuid: string | null
  estado:      string   // VIGENTE | ANULADO | RECTIFICACION
}

/** Una línea de venta tal como se enseña en el detalle desplegado del ticket.
 *  `subtotal` es el NETO (lo que se cobró por esa línea); `descuento_importe`, lo que se
 *  le quitó. Los dos, porque uno sin el otro no deja repasar la venta con el cajero. */
export interface LineaTicket {
  descripcion:       string
  cantidad:          number
  precio_unitario:   number
  subtotal:          number
  descuento_importe: number
}

export interface MovimientoStock {
  ticket_uuid:     string
  fecha:           string
  caja_id:         string
  producto_id:     string | null
  descripcion:     string
  cantidad:        number
  precio_unitario: number
}

export interface Cierre {
  sesion_uuid:      string
  caja_id:          string
  abierta_at:       string
  cerrada_at:       string | null
  estado:           string
  total_por_moneda: Record<string, number>
  efectivo_contado: Record<string, number>
  posted_at:        string | null
  tesoreria_movs:   Record<string, string> | null
  stock_movs:       Record<string, string> | null
  /** Quién abrió y quién cerró el turno (mig. 208). Nombres congelados; `null` en los
   *  turnos anteriores a la migración, que no se pueden backfillear. */
  abierta_por:      string | null
  cerrada_por:      string | null
  /** Lo que se regaló en el turno, POR MONEDA. No es una columna de `caja_sesiones`: se
   *  calcula sumando los tickets del turno, porque el cierre lo escribe el dispositivo y
   *  añadirle un campo obligaría a que todos los móviles se actualizaran para que el dato
   *  existiera. Al lado del descuadre, que es donde se mira lo que no cuadra. */
  descuento_total:  Record<string, number>
}

/** Quién puede manejar una caja. La lista es del CLIENTE; la asignación, de la caja. */
export interface Operador {
  operador_id: string
  nombre:      string
  /** Vínculo OPCIONAL con RRHH: lo pone «Importar del personal», nunca es requisito. */
  empleado_id: string | null
  activo:      boolean
}

/**
 * Una campaña de descuento (mig. 210). No es un precio: es una REGLA con su ventana,
 * y quien la resuelve es el dispositivo — la caja sincroniza solo al cerrar turno, así
 * que un precio calculado aquí lo aplicaría un aparato que quizá lleva días sin sembrar.
 */
export interface CampaniaCaja {
  descuento_id: string
  nombre:       string
  pct:          number
  ambito:       'TODO' | 'PRODUCTO'
  ambito_id:    string | null
  desde:        string | null
  hasta:        string | null
  /** 0 = domingo … 6 = sábado. Vacío = todos los días. */
  dias_semana:  number[]
  /** El punto de venta al que pertenece. `null` solo en las filas anteriores a que las
   *  campañas fueran de cada punto: siguen valiendo para todos los de la empresa. */
  caja_id:      string | null
  activo:       boolean
}

export interface CajaConfigData {
  caja:      Caja
  empresas:  { empresa_id: string; nombre: string }[]
  almacenes: { almacen_id: string; nombre: string; empresa_id: string }[]
  cuentas:   { cuenta_id: string; nombre: string; moneda: string; empresa_id: string }[]
  monedas:   string[]
  baseUrl:   string
  tieneBase:       boolean
  tieneInventario: boolean
  tieneServicios:  boolean
  /**
   * Cuántos servicios suscribibles hay con acuerdos vivos. Si además se cobran en el
   * mostrador, esa venta entra DOS veces en el estado de resultados: el cierre escribe su
   * COBRO (mig. 149) y la factura de la suscripción cuenta como Ventas.
   */
  suscribiblesActivos: number
  /**
   * Cuántos SERVICIOS activos hay en el catálogo del cliente, tenga el módulo Servicios
   * o no: con solo Caja los cataloga en el mostrador (`modoCatalogoMostrador`). Es lo que
   * decide si «Qué se vende aquí» es una pregunta real — y si hay que avisar de que esos
   * servicios no bajan al dispositivo con el ajuste puesto en «solo productos».
   */
  serviciosActivos: number
  // ¿Hay cierres ya sincronizados? Solo sirve para que el aviso de cambio de
  // empresa no mienta: sin histórico no hay nada que se quede en la empresa vieja.
  tieneHistorico:  boolean
  /** Los operadores activos de la EMPRESA de esta caja (la lista completa). */
  operadores:      Operador[]
  /** De esos, cuáles manejan ESTA caja: son los únicos que bajan al dispositivo. */
  operadoresCaja:  string[]
  /** ¿Se puede ofrecer «Importar del personal»? Solo con el módulo RRHH contratado. */
  tieneRrhh:       boolean
  /** Campañas vivas que afectan a ESTA caja: las suyas y las heredadas de cuando una
   *  campaña podía valer para todos los puntos de venta de la empresa. */
  campanias:       CampaniaCaja[]
  /** El catálogo para elegir producto en una campaña de ámbito PRODUCTO. */
  productos:       { producto_id: string; nombre: string }[]
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function generarCajaId(): string {
  return `CAJ-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}
function generarToken(): string {
  // 32 hex (128 bits): suficiente para un token revocable + rate-limitado, y
  // hace el enlace de instalación bastante más corto.
  return crypto.randomUUID().replace(/-/g, '')
}

async function empresaIds(): Promise<string[]> {
  const empresas = await obtenerEmpresas()
  return empresas.map(e => e.empresa_id)
}

/** Todo lo que toca contabilizar un cierre: su detalle y los dos módulos que recibe. Sin
 *  `export` (en un fichero `'use server'` solo se exportan funciones async). */
function revalidarCaja(caja_id?: string) {
  revalidatePath('/portal/caja')
  revalidatePath('/portal/caja/operaciones')
  revalidatePath('/portal/caja/cierres')
  revalidatePath('/portal/tesoreria')
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/inventario')
  if (caja_id) revalidatePath(`/portal/caja/${caja_id}`)
}

// ── Listar cajas (hub) ──────────────────────────────────────────────────────────

export async function listarCajas(): Promise<Caja[]> {
  const session = await getPortalSession()
  if (!session) return []
  const db  = createAdminClient()
  const ids = await empresaIds()
  const { data } = await db.from('cajas').select('*')
    .eq('client_id', session.client_id)
    .in('empresa_id', ids.length ? ids : ['__none__'])
    .order('created_at', { ascending: false })
  return (data ?? []) as Caja[]
}

/**
 * Qué le falta a cada punto para que su dinero llegue entero.
 *
 * Sin esto un punto mal configurado se ve **idéntico** a uno perfecto en el listado, y solo
 * se descubre cuando el cierre no se puede contabilizar — o sea, cuando ya se vendió.
 * Devuelve las monedas aceptadas sin caja de Tesorería y si le falta el almacén.
 */
export async function saludCajas(): Promise<Record<string, { monedasSinCuenta: string[]; sinAlmacen: boolean }>> {
  const session = await getPortalSession()
  if (!session) return {}
  const db = createAdminClient()

  const [cajasRes, cliRes] = await Promise.all([
    db.from('cajas').select('caja_id, empresa_id, monedas_aceptadas, cuentas_moneda, almacen_id, activa')
      .eq('client_id', session.client_id).eq('activa', true),
    db.from('clients').select('modulos_activos').eq('client_id', session.client_id).maybeSingle(),
  ])
  const modulos   = cliRes.data?.modulos_activos
  const tieneBase = tieneModulo(modulos, 'base')
  const tieneInv  = tieneModulo(modulos, 'inventario')

  const out: Record<string, { monedasSinCuenta: string[]; sinAlmacen: boolean }> = {}
  type Fila = { caja_id: string; monedas_aceptadas: string[] | null; cuentas_moneda: Record<string, string> | null; almacen_id: string | null }
  for (const c of ((cajasRes.data ?? []) as Fila[])) {
    const faltan = tieneBase
      ? (c.monedas_aceptadas ?? []).filter(m => !c.cuentas_moneda?.[m])
      : []
    const sinAlmacen = tieneInv && !c.almacen_id
    if (faltan.length || sinAlmacen) out[c.caja_id] = { monedasSinCuenta: faltan, sinAlmacen }
  }
  return out
}

// ── Crear caja ────────────────────────────────────────────────────────────────

export async function crearCaja(
  nombre: string, empresa_id: string,
): Promise<{ ok: boolean; caja_id?: string; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  if (!nombre?.trim())      return { ok: false, error: 'El nombre de la caja es obligatorio.' }

  const db       = createAdminClient()
  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_id)) {
    return { ok: false, error: 'Empresa no válida.' }
  }

  // El tope es del cliente entero, no de esta empresa: seis puntos de venta son
  // seis, repartidos como quiera.
  const tope = await comprobarLimite(db, session.client_id, 'puntos_venta')
  if (tope) return { ok: false, error: tope }

  // **Un punto de venta no nace roto.** Antes se aceptaban TODAS las monedas activas con
  // `cuentas_moneda` vacío: exactamente el estado que `guardarConfigCaja` se niega a
  // guardar, solo que por la puerta de atrás y sin que el dueño pase nunca por esa
  // pantalla. Vender así produce un cierre que no se puede contabilizar (le falta la caja
  // de Tesorería de esa moneda) y hasta la Fase 2 no había forma de recuperarlo.
  // Con Contabilidad se aceptan solo las monedas que YA tienen una cuenta en esta empresa;
  // sin ella no hay nada que mapear y valen todas, como hasta ahora.
  const [monsRes, cuentasRes] = await Promise.all([
    db.from('monedas').select('codigo').eq('client_id', session.client_id).eq('activa', true).order('codigo'),
    db.from('clients').select('modulos_activos').eq('client_id', session.client_id).maybeSingle(),
  ])
  const activas = ((monsRes.data ?? []) as { codigo: string }[]).map(m => m.codigo)

  let monedas = activas
  if (tieneModulo(cuentasRes.data?.modulos_activos, 'base')) {
    const { data: ctas } = await db.from('cuentas')
      .select('moneda').eq('client_id', session.client_id).eq('empresa_id', empresa_id)
      .eq('activa', true).eq('es_apertura', false)
    const conCuenta = new Set(((ctas ?? []) as { moneda: string }[]).map(c => c.moneda))
    monedas = activas.filter(m => conCuenta.has(m))
  }

  const caja_id = generarCajaId()
  const { error } = await db.from('cajas').insert({
    caja_id,
    client_id:         session.client_id,
    empresa_id,
    nombre:            nombre.trim(),
    monedas_aceptadas: monedas,
    cuentas_moneda:    {},
    sync_token:        generarToken(),
    activa:            true,
    updated_at:        new Date().toISOString(),
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/caja')
  return { ok: true, caja_id }
}

// ── Puntos de venta que aceptan una moneda ──────────────────────────────────────

// Lectura para avisar en «Monedas y tasas» antes de desactivar una moneda: si algún
// punto de venta la acepta, dejará de poder cobrar en ella en cuanto sincronice, y sin
// esto se enteraría el cajero en el mostrador. Devuelve NOMBRES porque el aviso los
// enumera. `monedas_aceptadas` es text[], así que la consulta es de contención, no de
// igualdad. Sin candado de escritura: no muta nada.
export async function puntosVentaConMoneda(codigo: string): Promise<string[]> {
  const session = await getPortalSession()
  if (!session) return []
  const { data } = await createAdminClient().from('cajas')
    .select('nombre')
    .eq('client_id', session.client_id).eq('activa', true)
    .contains('monedas_aceptadas', [codigo])
    .order('nombre')
  return ((data ?? []) as { nombre: string }[]).map(c => c.nombre)
}

// ── Datos de configuración de una caja ──────────────────────────────────────────

export async function obtenerCajaConfig(caja_id: string): Promise<CajaConfigData | null> {
  const session = await getPortalSession()
  if (!session) return null
  const db = createAdminClient()

  const { data: caja } = await db.from('cajas').select('*')
    .eq('caja_id', caja_id).eq('client_id', session.client_id).maybeSingle()
  if (!caja) return null

  const empresas = await obtenerEmpresas()
  const ids      = empresas.map(e => e.empresa_id)

  const [almRes, cuRes, monRes, cliRes, sesRes, opRes, opCajaRes, dtoRes, prodRes] = await Promise.all([
    db.from('almacenes').select('almacen_id, nombre, empresa_id')
      .eq('client_id', session.client_id).in('empresa_id', ids.length ? ids : ['__none__']).order('nombre'),
    db.from('cuentas').select('cuenta_id, nombre, moneda, empresa_id')
      .eq('client_id', session.client_id).eq('activa', true)
      .eq('es_apertura', false)   // técnica de la migración (mig. 130): no es caja
      .in('empresa_id', ids.length ? ids : ['__none__']).order('nombre'),
    db.from('monedas').select('codigo').eq('client_id', session.client_id).eq('activa', true).order('codigo'),
    db.from('clients').select('modulos_activos').eq('client_id', session.client_id).maybeSingle(),
    // head+count: solo interesa si existe alguna, no traer las filas.
    db.from('caja_sesiones').select('sesion_uuid', { count: 'exact', head: true })
      .eq('caja_id', caja_id).eq('client_id', session.client_id),
    // Operadores de la EMPRESA de la caja: en multiempresa, ofrecer la plantilla
    // entera es ruido (y el cajero del otro local no pinta nada aquí).
    db.from('caja_operadores').select('operador_id, nombre, empleado_id, activo')
      .eq('client_id', session.client_id).eq('empresa_id', caja.empresa_id)
      .eq('activo', true).order('nombre'),
    db.from('caja_operadores_cajas').select('operador_id').eq('caja_id', caja_id),
    // Campañas (mig. 210): las de ESTA caja y las de «todos los puntos de venta».
    // Se listan también las caducadas mientras sigan activas: el dueño tiene que poder
    // ver por qué ya no se aplica la del mes pasado, no encontrarse la lista vacía.
    db.from('caja_descuentos')
      .select('descuento_id, nombre, pct, ambito, ambito_id, desde, hasta, dias_semana, caja_id, activo')
      .eq('client_id', session.client_id).eq('empresa_id', caja.empresa_id)
      .eq('activo', true)
      .or(`caja_id.is.null,caja_id.eq.${caja_id}`)
      .order('nombre'),
    // El catálogo activo: alimenta el selector de campañas por artículo y, con el
    // `tipo`, el recuento de servicios (una consulta, no dos).
    db.from('products').select('producto_id, nombre, tipo')
      .eq('client_id', session.client_id).eq('estado', 'ACTIVO').order('nombre'),
  ])

  const modulos = cliRes.data?.modulos_activos

  // Los servicios suscribibles que ALGUIEN tiene contratado: es la condición del doble
  // conteo. Un suscribible que nadie ha contratado todavía no puede duplicar nada.
  let suscribibles = 0
  if (tieneModulo(modulos, 'servicios')) {
    const { data: lins } = await db.from('suscripcion_lineas')
      .select('producto_id').eq('client_id', session.client_id)
    const ids = [...new Set(((lins ?? []) as { producto_id: string }[]).map(l => l.producto_id))]
    if (ids.length) {
      const { count } = await db.from('products').select('producto_id', { count: 'exact', head: true })
        .eq('client_id', session.client_id).eq('es_suscribible', true)
        .eq('estado', 'ACTIVO').in('producto_id', ids)
      suscribibles = count ?? 0
    }
  }

  const catalogo = (prodRes.data ?? []) as { producto_id: string; nombre: string; tipo: string }[]

  return {
    caja: caja as Caja,
    empresas:  empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
    almacenes: (almRes.data ?? []) as CajaConfigData['almacenes'],
    cuentas:   (cuRes.data  ?? []) as CajaConfigData['cuentas'],
    monedas:   ((monRes.data ?? []) as { codigo: string }[]).map(m => m.codigo),
    baseUrl:   (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, ''),
    tieneBase:       tieneModulo(modulos, 'base'),
    tieneInventario: tieneModulo(modulos, 'inventario'),
    tieneServicios:  tieneModulo(modulos, 'servicios'),
    suscribiblesActivos: suscribibles,
    serviciosActivos: catalogo.filter(p => p.tipo === 'SERVICIO').length,
    tieneHistorico:  (sesRes.count ?? 0) > 0,
    operadores:      (opRes.data ?? []) as Operador[],
    operadoresCaja:  ((opCajaRes.data ?? []) as { operador_id: string }[]).map(o => o.operador_id),
    tieneRrhh:       tieneModulo(modulos, 'rrhh'),
    campanias:       ((dtoRes.data ?? []) as CampaniaCaja[]).map(c => ({ ...c, pct: Number(c.pct), dias_semana: c.dias_semana ?? [] })),
    productos:       catalogo.map(({ producto_id, nombre }) => ({ producto_id, nombre })),
  }
}

// ── Guardar configuración ───────────────────────────────────────────────────────

export async function guardarConfigCaja(
  caja_id: string,
  cfg: {
    nombre: string; empresa_id?: string; almacen_id: string | null
    monedas_aceptadas: string[]; cuentas_moneda: Record<string, string>
    cuentas_transferencia?: Record<string, string>
    tipos_catalogo?: string
  },
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  if (!cfg.nombre?.trim())  return { ok: false, error: 'El nombre es obligatorio.' }

  const db = createAdminClient()

  // La empresa determina de qué almacén descuenta stock y a qué cuentas de Tesorería
  // postea, así que un cambio arrastra las dos cosas: el almacén y las cuentas eran
  // de la empresa vieja y ahí dejarían de existir. Se limpian EN SERVIDOR y no solo
  // en el formulario, porque es una invariante del dato: un punto de venta no puede
  // apuntar a un almacén ni a una cuenta de otra empresa, venga la petición de donde
  // venga. Lo ya sincronizado no se toca: las sesiones y los tickets llevan su propio
  // empresa_id y los resúmenes ya posteados viven en la contabilidad de la vieja.
  const { data: actual } = await db.from('cajas').select('empresa_id')
    .eq('caja_id', caja_id).eq('client_id', session.client_id).maybeSingle()
  if (!actual) return { ok: false, error: 'Punto de venta no encontrado.' }

  let empresaFinal = actual.empresa_id as string
  if (cfg.empresa_id && cfg.empresa_id !== actual.empresa_id) {
    const empresas = await obtenerEmpresas()
    if (!empresas.some(e => e.empresa_id === cfg.empresa_id)) {
      return { ok: false, error: 'Empresa no válida.' }
    }
    empresaFinal = cfg.empresa_id
  }

  // No se limpia a ciegas por «ha cambiado la empresa»: eso tiraría el almacén y las
  // cuentas que el usuario acaba de elegir para la empresa NUEVA en el mismo guardado.
  // Se comprueba la pertenencia real y se cae solo lo que no es de `empresaFinal`.
  const [almOk, cuentasEmpresa] = await Promise.all([
    cfg.almacen_id
      ? db.from('almacenes').select('almacen_id').eq('almacen_id', cfg.almacen_id)
          .eq('client_id', session.client_id).eq('empresa_id', empresaFinal).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('cuentas').select('cuenta_id')
      .eq('client_id', session.client_id).eq('empresa_id', empresaFinal)
      .eq('es_apertura', false),   // una caja no puede depositar en la cuenta técnica
  ])
  const cuentasValidas = new Set((cuentasEmpresa.data ?? []).map((c: { cuenta_id: string }) => c.cuenta_id))
  const soloDeLaEmpresa = (mapa: Record<string, string> | undefined) => {
    const out: Record<string, string> = {}
    for (const [moneda, cuentaId] of Object.entries(mapa ?? {})) {
      if (cuentasValidas.has(cuentaId)) out[moneda] = cuentaId
    }
    return out
  }
  const cuentasFinal = soloDeLaEmpresa(cfg.cuentas_moneda)
  // Misma guardia para la cuenta de transferencias: es una invariante del dato (un punto
  // no puede depositar en la cuenta de otra empresa), no una validación del formulario.
  const transfFinal  = soloDeLaEmpresa(cfg.cuentas_transferencia)

  const { error } = await db.from('cajas').update({
    nombre:            cfg.nombre.trim(),
    empresa_id:        empresaFinal,
    almacen_id:        almOk.data ? cfg.almacen_id : null,
    monedas_aceptadas: cfg.monedas_aceptadas ?? [],
    cuentas_moneda:    cuentasFinal,
    cuentas_transferencia: transfFinal,
    // Guardia de servidor: la columna tiene CHECK, y un valor inventado reventaría el
    // guardado entero en vez de ignorarse.
    tipos_catalogo:    (TIPOS_CATALOGO as readonly string[]).includes(cfg.tipos_catalogo ?? '') ? cfg.tipos_catalogo : 'PRODUCTO',
    updated_at:        new Date().toISOString(),
  }).eq('caja_id', caja_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/caja')
  revalidatePath(`/portal/caja/${caja_id}`)
  return { ok: true }
}

// ── Campañas de descuento (mig. 210) ────────────────────────────────────────────
//
// El descuento de la fase 1 lo pone el cajero, venta a venta. Esto es el otro: una
// regla puesta UNA vez desde aquí («−10 % en todo, del 1 al 7»; «este título, −20 %
// los martes») que el dispositivo aplica solo. No escribe en ningún sitio nuevo: al
// cobrar rellena el mismo `descuento_pct` de siempre.
//
// Como los operadores, estas acciones DEVUELVEN la lista en vez de revalidar la ruta:
// un `revalidatePath` re-renderiza la página y se lleva por delante la configuración
// que el dueño tenga a medio cambiar en el mismo formulario.

function generarDescuentoId(): string {
  return `DTO-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

async function listarCampaniasDe(
  db: ReturnType<typeof createAdminClient>, client_id: string, empresa_id: string, caja_id: string,
): Promise<CampaniaCaja[]> {
  const { data } = await db.from('caja_descuentos')
    .select('descuento_id, nombre, pct, ambito, ambito_id, desde, hasta, dias_semana, caja_id, activo')
    .eq('client_id', client_id).eq('empresa_id', empresa_id).eq('activo', true)
    .or(`caja_id.is.null,caja_id.eq.${caja_id}`)
    .order('nombre')
  return ((data ?? []) as CampaniaCaja[]).map(c => ({ ...c, pct: Number(c.pct), dias_semana: c.dias_semana ?? [] }))
}

/**
 * Alta o edición de una campaña.
 *
 * Se valida aquí y no solo en el formulario porque los CHECK de la migración devuelven
 * el nombre de la restricción, no una frase: «caja_descuentos_ambito_id_ck» en pantalla
 * no le dice nada a quien lleva una cafetería.
 */
export async function guardarCampaniaCaja(
  caja_id: string,
  campania: {
    descuento_id?: string
    nombre: string; pct: number
    ambito: 'TODO' | 'PRODUCTO'; ambito_id: string | null
    desde: string | null; hasta: string | null
    dias_semana: number[]
  },
): Promise<{ ok: boolean; error?: string; campanias?: CampaniaCaja[] }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja')))
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const nombre = campania.nombre.trim()
  if (!nombre) return { ok: false, error: 'Ponle un nombre a la campaña.' }
  const pct = Math.round((Number(campania.pct) || 0) * 100) / 100
  if (!(pct > 0 && pct <= 100)) return { ok: false, error: 'El descuento tiene que estar entre 0 y 100 %.' }
  if (campania.ambito === 'PRODUCTO' && !campania.ambito_id)
    return { ok: false, error: 'Elige a qué producto se le aplica.' }
  if (campania.desde && campania.hasta && campania.hasta < campania.desde)
    return { ok: false, error: 'La fecha de fin no puede ser anterior a la de inicio.' }
  const dias = [...new Set(campania.dias_semana)].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort()

  const empresa_id = await empresaDeCaja(session.client_id, caja_id)
  if (!empresa_id) return { ok: false, error: 'Caja no encontrada.' }

  const db = createAdminClient()

  const fila = {
    nombre, pct,
    ambito:      campania.ambito,
    // Un ámbito TODO con producto miente sobre lo que hace: al cambiar de ámbito el
    // producto se suelta, no se conserva «por si acaso».
    ambito_id:   campania.ambito === 'PRODUCTO' ? campania.ambito_id : null,
    desde:       campania.desde || null,
    hasta:       campania.hasta || null,
    dias_semana: dias,
  }

  if (campania.descuento_id) {
    // El ÁMBITO no se toca al editar. `caja_id` sigue siendo nullable porque quedan filas
    // de cuando una campaña podía valer para todos los puntos: reescribirlas a esta caja
    // al corregirles una fecha las quitaría de los otros mostradores sin decir nada.
    const { error } = await db.from('caja_descuentos').update(fila)
      .eq('descuento_id', campania.descuento_id).eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
  } else {
    // Una campaña nace SIEMPRE de un punto de venta: se configura desde su ficha, y «los
    // martes −10 %» en la librería no tiene por qué valer en el almacén de la otra punta.
    // Pasarla a otro punto es copiarla allí, no marcar una casilla.
    const { error } = await db.from('caja_descuentos').insert({
      ...fila, caja_id, descuento_id: generarDescuentoId(),
      client_id: session.client_id, empresa_id, activo: true,
    })
    if (error) return { ok: false, error: error.message }
  }

  return { ok: true, campanias: await listarCampaniasDe(db, session.client_id, empresa_id, caja_id) }
}

/**
 * Retirar una campaña. Se ARCHIVA (`activo = false`), no se borra: los tickets que ya
 * se cobraron con ella guardan el descuento, y el dueño que mire un cierre viejo tiene
 * derecho a que la campaña que lo explica siga existiendo.
 */
export async function archivarCampaniaCaja(
  caja_id: string, descuento_id: string,
): Promise<{ ok: boolean; error?: string; campanias?: CampaniaCaja[] }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja')))
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const empresa_id = await empresaDeCaja(session.client_id, caja_id)
  if (!empresa_id) return { ok: false, error: 'Caja no encontrada.' }

  const db = createAdminClient()
  const { error } = await db.from('caja_descuentos').update({ activo: false })
    .eq('descuento_id', descuento_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  return { ok: true, campanias: await listarCampaniasDe(db, session.client_id, empresa_id, caja_id) }
}

// ── Operadores (quién maneja la caja) ───────────────────────────────────────────
//
// La lista es del CLIENTE y la asignación, de la caja (`caja_operadores_cajas`).
// Patrón calcado de Citas (`recursos` + `importarPersonalRRHH`): módulo
// independiente, con RRHH como llenado rápido opcional y nunca como requisito.

function generarOperadorId(): string {
  return `OPE-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

/**
 * La lista viva de operadores de una empresa. Las acciones de abajo la DEVUELVEN en
 * vez de revalidar la ruta: un `revalidatePath` aquí re-renderiza la página entera y
 * se lleva por delante lo que el dueño tenga a medio escribir en el formulario de
 * configuración (mismo problema que ya se arregló en la ficha de cliente). La vista
 * se actualiza con lo que llega, sin recargar nada.
 */
async function listarOperadoresDe(db: ReturnType<typeof createAdminClient>, client_id: string, empresa_id: string): Promise<Operador[]> {
  const { data } = await db.from('caja_operadores')
    .select('operador_id, nombre, empleado_id, activo')
    .eq('client_id', client_id).eq('empresa_id', empresa_id)
    .eq('activo', true).order('nombre')
  return (data ?? []) as Operador[]
}

/** La empresa de una caja del cliente en sesión (y de paso, que la caja sea suya). */
async function empresaDeCaja(client_id: string, caja_id: string): Promise<string | null> {
  const db = createAdminClient()
  const { data } = await db.from('cajas').select('empresa_id')
    .eq('caja_id', caja_id).eq('client_id', client_id).maybeSingle()
  return (data as { empresa_id: string } | null)?.empresa_id ?? null
}

/**
 * Alta o renombrado de un operador. Se crea desde la configuración de la caja, así
 * que hereda su empresa.
 *
 * Un nombre repetido no es un error que enseñar: es el mismo cajero que se archivó
 * y vuelve. Si existe una ficha inactiva con ese nombre, se REACTIVA en vez de
 * chocar contra el índice único — así el histórico de turnos sigue apuntando a la
 * misma persona en lugar de partirse en dos.
 */
export async function guardarOperador(
  caja_id: string,
  nombre: string,
  operador_id?: string,
): Promise<{ ok: boolean; error?: string; operadores?: Operador[] }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja')))
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const limpio = nombre.trim()
  if (!limpio) return { ok: false, error: 'El nombre es obligatorio.' }

  const empresa_id = await empresaDeCaja(session.client_id, caja_id)
  if (!empresa_id) return { ok: false, error: 'Caja no encontrada.' }

  const db = createAdminClient()

  if (operador_id) {
    const { error } = await db.from('caja_operadores').update({ nombre: limpio })
      .eq('operador_id', operador_id).eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
    return { ok: true, operadores: await listarOperadoresDe(db, session.client_id, empresa_id) }
  }

  const { data: previo } = await db.from('caja_operadores').select('operador_id, activo')
    .eq('client_id', session.client_id).eq('empresa_id', empresa_id)
    .ilike('nombre', limpio).maybeSingle()
  if (previo) {
    const p = previo as { operador_id: string; activo: boolean }
    if (!p.activo) {
      await db.from('caja_operadores').update({ activo: true })
        .eq('operador_id', p.operador_id).eq('client_id', session.client_id)
    }
    return { ok: true, operadores: await listarOperadoresDe(db, session.client_id, empresa_id) }
  }

  const { error } = await db.from('caja_operadores').insert({
    operador_id: generarOperadorId(), client_id: session.client_id, empresa_id,
    nombre: limpio, activo: true,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, operadores: await listarOperadoresDe(db, session.client_id, empresa_id) }
}

/**
 * Baja de un operador. Se ARCHIVA, no se borra: los turnos cerrados guardan su id
 * y su nombre congelado, y borrarlo dejaría huérfano el histórico.
 */
export async function archivarOperador(
  caja_id: string, operador_id: string,
): Promise<{ ok: boolean; error?: string; operadores?: Operador[] }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja')))
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const empresa_id = await empresaDeCaja(session.client_id, caja_id)
  if (!empresa_id) return { ok: false, error: 'Caja no encontrada.' }

  const db = createAdminClient()
  const { error } = await db.from('caja_operadores').update({ activo: false })
    .eq('operador_id', operador_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }
  // Y deja de manejar cualquier caja: si vuelve, se le vuelve a marcar.
  await db.from('caja_operadores_cajas').delete()
    .eq('operador_id', operador_id).eq('client_id', session.client_id)
  return { ok: true, operadores: await listarOperadoresDe(db, session.client_id, empresa_id) }
}

/**
 * Quién maneja ESTA caja. Se reemplaza el conjunto entero (la UI manda casillas,
 * no altas y bajas): borrar + insertar es más simple que diferenciar, y la tabla
 * tiene dos columnas.
 */
export async function asignarOperadoresCaja(
  caja_id: string, operador_ids: string[],
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja')))
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const empresa_id = await empresaDeCaja(session.client_id, caja_id)
  if (!empresa_id) return { ok: false, error: 'Caja no encontrada.' }

  const db = createAdminClient()
  // Solo operadores REALES del cliente y de la empresa de la caja: la lista llega
  // del navegador y no se inserta lo que venga.
  const { data: validos } = await db.from('caja_operadores').select('operador_id')
    .eq('client_id', session.client_id).eq('empresa_id', empresa_id).eq('activo', true)
    .in('operador_id', operador_ids.length ? operador_ids : ['__none__'])

  await db.from('caja_operadores_cajas').delete().eq('caja_id', caja_id).eq('client_id', session.client_id)
  const rows = ((validos ?? []) as { operador_id: string }[]).map(o => ({
    caja_id, operador_id: o.operador_id, client_id: session.client_id,
  }))
  if (rows.length) {
    const { error } = await db.from('caja_operadores_cajas').insert(rows)
    if (error) return { ok: false, error: error.message }
  }
  return { ok: true }
}

/**
 * Un empleado que se puede traer a la lista de cajeros, con lo que hace falta para
 * decidir: el nombre, a qué se dedica y si ya está.
 */
export interface PersonalImportable {
  empleado_id: string
  nombre:      string
  cargo:       string | null
  /** Ya está en la lista de cajeros de esta empresa. Se enseña igual, apagado: que
   *  desaparezca de la lista deja la pregunta «¿y Yoandry, por qué no sale?». */
  ya_operador: boolean
}

/**
 * Los empleados de la empresa de esta caja, con su estado. Se pide al ABRIR el modal
 * de importar, no en cada carga de la configuración: son 500 filas en un cliente con
 * plantilla grande y la pantalla no las necesita para nada más.
 *
 * «Ya está» se mide contra los operadores **activos**. Un cajero al que se le dio de
 * baja se archiva (`activo = false`) para que sus turnos sigan apuntando a alguien, y
 * contarlo aquí es lo que hacía que el import dijera «no hay nadie nuevo» con la
 * lista de cajeros vacía.
 */
async function personalImportableDe(
  db: ReturnType<typeof createAdminClient>, client_id: string, empresa_id: string,
): Promise<PersonalImportable[]> {
  const [{ data: emps }, { data: ops }] = await Promise.all([
    db.from('empleados').select('empleado_id, nombre, apellidos, cargo')
      .eq('client_id', client_id).eq('empresa_id', empresa_id).is('fecha_baja', null)
      .order('nombre'),
    db.from('caja_operadores').select('empleado_id, nombre, activo')
      .eq('client_id', client_id).eq('empresa_id', empresa_id),
  ])
  type Op = { empleado_id: string | null; nombre: string; activo: boolean }
  const vivos       = ((ops ?? []) as Op[]).filter(o => o.activo)
  const porEmpleado = new Set(vivos.map(o => o.empleado_id).filter(Boolean) as string[])
  // Y también por NOMBRE: el dueño pudo teclear «Yoandry» a mano antes de contratar RRHH,
  // y el índice único de la tabla rechazaría el lote entero por ese duplicado.
  const porNombre   = new Set(vivos.map(o => o.nombre.toLowerCase()))

  return ((emps ?? []) as { empleado_id: string; nombre: string; apellidos: string | null; cargo: string | null }[])
    .map(e => {
      const nombre = [e.nombre, e.apellidos].filter(Boolean).join(' ')
      return {
        empleado_id: e.empleado_id,
        nombre,
        cargo:       e.cargo,
        ya_operador: porEmpleado.has(e.empleado_id) || porNombre.has(nombre.toLowerCase()),
      }
    })
}

/** Para el modal de «Importar del personal». Exige RRHH: sin el módulo no hay plantilla. */
export async function listarPersonalImportable(
  caja_id: string,
): Promise<{ ok: boolean; error?: string; personal?: PersonalImportable[] }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja')))
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const empresa_id = await empresaDeCaja(session.client_id, caja_id)
  if (!empresa_id) return { ok: false, error: 'Caja no encontrada.' }

  const db = createAdminClient()
  const { data: cli } = await db.from('clients').select('modulos_activos')
    .eq('client_id', session.client_id).single()
  if (!tieneModulo(cli?.modulos_activos, 'rrhh'))
    return { ok: false, error: 'El módulo de RRHH no está activo.' }

  return { ok: true, personal: await personalImportableDe(db, session.client_id, empresa_id) }
}

/**
 * Llenado rápido desde RRHH: trae los empleados que el dueño ELIGE, no la plantilla
 * entera. Traerla entera es lo que había, y con 500 trabajadores y 30 puntos de venta
 * obligaba a quitar uno a uno a los que no atienden ese mostrador.
 *
 * Devuelve también los `operador_id` creados para que la vista los marque en ESTA caja:
 * quien los eligió de una lista titulada «quién maneja este punto» no espera tener que
 * marcarlos otra vez. La asignación en sí se guarda con el resto de la configuración
 * (`asignarOperadoresCaja`), como las casillas.
 *
 * Caja funciona sin RRHH y RRHH no sabe que Caja existe — la dirección es una sola.
 */
export async function importarPersonalRRHH(
  caja_id: string,
  empleado_ids: string[],
): Promise<{ ok: boolean; error?: string; importados?: number; operadores?: Operador[]; nuevos?: string[] }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja')))
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const empresa_id = await empresaDeCaja(session.client_id, caja_id)
  if (!empresa_id) return { ok: false, error: 'Caja no encontrada.' }

  const db = createAdminClient()
  const { data: cli } = await db.from('clients').select('modulos_activos')
    .eq('client_id', session.client_id).single()
  if (!tieneModulo(cli?.modulos_activos, 'rrhh'))
    return { ok: false, error: 'El módulo de RRHH no está activo.' }

  // La selección llega del navegador: solo se importa lo que de verdad es un empleado
  // importable de esta empresa.
  const pedidos = new Set(empleado_ids)
  const elegidos = (await personalImportableDe(db, session.client_id, empresa_id))
    .filter(e => pedidos.has(e.empleado_id) && !e.ya_operador)
  if (elegidos.length === 0) return { ok: true, importados: 0, nuevos: [] }

  // Fichas ARCHIVADAS que son la misma persona: el mismo cajero que vuelve, no uno
  // nuevo. Se reactivan en vez de chocar contra el índice único, igual que hace
  // `guardarOperador`, y así sus turnos anteriores siguen siendo suyos.
  const { data: archRaw } = await db.from('caja_operadores')
    .select('operador_id, nombre, empleado_id')
    .eq('client_id', session.client_id).eq('empresa_id', empresa_id).eq('activo', false)
  const archivados = (archRaw ?? []) as { operador_id: string; nombre: string; empleado_id: string | null }[]
  const archivadoDe = (e: PersonalImportable) =>
    archivados.find(a => a.empleado_id === e.empleado_id)
    ?? archivados.find(a => a.empleado_id === null && a.nombre.toLowerCase() === e.nombre.toLowerCase())

  const nuevos: string[] = []
  const insertar: { operador_id: string; client_id: string; empresa_id: string; nombre: string; empleado_id: string; activo: boolean }[] = []
  const usados = new Set<string>()

  for (const e of elegidos) {
    const arch = archivadoDe(e)
    if (arch && !usados.has(arch.operador_id)) {
      usados.add(arch.operador_id)
      const { error } = await db.from('caja_operadores')
        .update({ activo: true, nombre: e.nombre, empleado_id: e.empleado_id })
        .eq('operador_id', arch.operador_id).eq('client_id', session.client_id)
      if (error) return { ok: false, error: error.message }
      nuevos.push(arch.operador_id)
    } else {
      const operador_id = generarOperadorId()
      insertar.push({
        operador_id, client_id: session.client_id, empresa_id,
        nombre: e.nombre, empleado_id: e.empleado_id, activo: true,
      })
      nuevos.push(operador_id)
    }
  }

  if (insertar.length) {
    const { error } = await db.from('caja_operadores').insert(insertar)
    if (error) return { ok: false, error: error.message }
  }

  return {
    ok: true, importados: elegidos.length, nuevos,
    operadores: await listarOperadoresDe(db, session.client_id, empresa_id),
  }
}

// ── Regenerar token / activar-desactivar ────────────────────────────────────────

export async function regenerarToken(caja_id: string): Promise<{ ok: boolean; token?: string; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const token = generarToken()
  const { error } = await createAdminClient().from('cajas')
    .update({ sync_token: token, updated_at: new Date().toISOString() })
    .eq('caja_id', caja_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/portal/caja/${caja_id}`)
  return { ok: true, token }
}

export async function setActivaCaja(caja_id: string, activa: boolean): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  // Reactivar cuenta como crear: si no, archivar seis y desarchivarlos después
  // deja doce puntos de venta con derecho a seis.
  if (activa) {
    const tope = await comprobarLimite(db, session.client_id, 'puntos_venta', 1, 'desarchivar')
    if (tope) return { ok: false, error: tope }
  }

  const { error } = await db.from('cajas')
    .update({ activa, updated_at: new Date().toISOString() })
    .eq('caja_id', caja_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/caja')
  return { ok: true }
}

// ── Operaciones (detalle: Ventas + Movimientos de stock) ─────────────────────────

/**
 * Ventas del TPV y sus movimientos de stock.
 *
 * Traía `.limit(1000)` **sin rango, sin aviso y sin forma de traer más**, y la vista encima
 * filtra en el navegador por punto de venta y búsqueda: un negocio de mostrador con más de
 * 1.000 tickets no veía los viejos y no había ni una pista de que faltaran. Es el mismo fallo
 * que ya se corrigió en Gastos y cobros (`lib/listados.ts`), aquí con más volumen todavía —un
 * TPV escribe un ticket por venta—. Ahora: rango por defecto de 3 meses aplicado EN LA
 * CONSULTA, `count: 'exact'` para poder decir cuántos faltan, y techo que sube con «Traer más».
 */
export async function listarOperaciones(
  filtro?: FiltroListado,
): Promise<{
  tickets: Ticket[]; stock: MovimientoStock[]; cajaNombres: Record<string, string>
  lineasPorTicket: Record<string, LineaTicket[]>
  rango: { desde: string; hasta: string }; hay_mas: boolean; total: number; limite: number
}> {
  const session = await getPortalSession()
  const vacio = { desde: '', hasta: '' }
  if (!session) return { tickets: [], stock: [], cajaNombres: {}, lineasPorTicket: {}, rango: vacio, hay_mas: false, total: 0, limite: LIMITE_LISTADO }
  const db  = createAdminClient()
  const ids = await empresaIds()
  const scope = ids.length ? ids : ['__none__']

  const porDefecto = rangoUltimosMeses(3)
  const desde  = filtro?.desde ?? porDefecto.desde
  const hasta  = filtro?.hasta ?? porDefecto.hasta
  const limite = limiteDelFiltro(filtro)

  let tkQuery = db.from('caja_tickets')
    .select('ticket_uuid, caja_id, fecha, moneda, total, bruto, descuento_importe, medio_pago, sesion_uuid, estado', { count: 'exact' })
    .eq('client_id', session.client_id).in('empresa_id', scope)
  // `fecha` es un timestamp: el «hasta» incluye el día entero, o las ventas de hoy se
  // quedarían fuera de un rango que dice llegar hasta hoy. Y los dos extremos van en el
  // calendario del NEGOCIO: con una fecha desnuda Postgres las lee en UTC, así que el rango
  // se comía las ventas de después de las 20:00 hora de Cuba del último día — las de más
  // venta en un restaurante.
  if (desde) tkQuery = tkQuery.gte('fecha', diaDelNegocio(desde).inicio)
  if (hasta) tkQuery = tkQuery.lte('fecha', diaDelNegocio(hasta).fin)

  const [tkRes, cajasRes] = await Promise.all([
    tkQuery.order('fecha', { ascending: false }).limit(limite),
    db.from('cajas').select('caja_id, nombre').eq('client_id', session.client_id),
  ])

  // `bruto` a cero es un ticket de antes de los descuentos: se normaliza al total aquí y
  // no en la vista, para que ninguna pantalla tenga que acordarse de este detalle.
  const tickets = ((tkRes.data ?? []) as Ticket[]).map(t => ({
    ...t,
    bruto: Number(t.bruto) > 0 ? Number(t.bruto) : Number(t.total),
    descuento_importe: Number(t.descuento_importe) || 0,
  }))
  const cajaNombres: Record<string, string> = {}
  for (const c of (cajasRes.data ?? []) as { caja_id: string; nombre: string }[]) cajaNombres[c.caja_id] = c.nombre

  // Líneas (movimientos de stock detallados) de esos tickets. Se excluyen las de
  // tickets ANULADO (rectificados: no movieron stock) y se ordena por fecha desc.
  const uuids = tickets.map(t => t.ticket_uuid)
  let stock: MovimientoStock[] = []
  let lineasPorTicket: Record<string, LineaTicket[]> = {}
  if (uuids.length) {
    const { data: lineas } = await db.from('caja_ticket_lineas')
      .select('ticket_uuid, producto_id, descripcion, cantidad, precio_unitario, subtotal, descuento_importe')
      .in('ticket_uuid', uuids)

    // Las mismas líneas, agrupadas por ticket: es lo que permite DESPLEGAR una venta y ver
    // qué llevaba sin irse a la otra pestaña a cruzarlo a ojo.
    lineasPorTicket = {}
    for (const l of ((lineas ?? []) as (LineaTicket & { ticket_uuid: string })[])) {
      const dto = Number(l.descuento_importe) || 0
      ;(lineasPorTicket[l.ticket_uuid] ??= []).push({
        descripcion: l.descripcion, cantidad: Number(l.cantidad), precio_unitario: Number(l.precio_unitario),
        // El neto de la línea es lo que se cobró; sin él, «2 × 300» junto a un descuento
        // no dice cuánto entró de verdad por esa línea.
        subtotal: Number(l.subtotal) || Math.round((Number(l.cantidad) * Number(l.precio_unitario) - dto) * 100) / 100,
        descuento_importe: dto,
      })
    }
    const tkMap = new Map(tickets.map(t => [t.ticket_uuid, t]))
    stock = ((lineas ?? []) as Omit<MovimientoStock, 'fecha' | 'caja_id'>[])
      .filter(l => (tkMap.get(l.ticket_uuid)?.estado ?? 'VIGENTE') !== 'ANULADO')
      .map(l => {
        const tk = tkMap.get(l.ticket_uuid)
        return { ...l, fecha: tk?.fecha ?? '', caja_id: tk?.caja_id ?? '' }
      })
      .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
  }

  return {
    tickets, stock, cajaNombres, lineasPorTicket,
    rango: { desde, hasta },
    hay_mas: tickets.length >= limite,
    total:   tkRes.count ?? tickets.length,
    limite,
  }
}

// ── Cierres ─────────────────────────────────────────────────────────────────────

/** Cierres de caja. Mismo contrato que Operaciones: `.limit(500)` sin aviso escondía los
 *  cierres viejos —y con ellos la serie de números Z, que es lo que se audita—. */
export async function listarCierres(
  filtro?: FiltroListado,
): Promise<{
  cierres: Cierre[]; cajaNombres: Record<string, string>
  hay_mas: boolean; total: number; limite: number
}> {
  const session = await getPortalSession()
  if (!session) return { cierres: [], cajaNombres: {}, hay_mas: false, total: 0, limite: LIMITE_LISTADO }
  const db  = createAdminClient()
  const ids = await empresaIds()
  const scope = ids.length ? ids : ['__none__']
  const limite = limiteDelFiltro(filtro)

  const [seRes, cajasRes] = await Promise.all([
    db.from('caja_sesiones')
      .select('sesion_uuid, caja_id, abierta_at, cerrada_at, estado, total_por_moneda, efectivo_contado, posted_at, tesoreria_movs, stock_movs, abierta_por, cerrada_por', { count: 'exact' })
      .eq('client_id', session.client_id).in('empresa_id', scope)
      // **Solo los CERRADOS.** Desde que el dispositivo sube también el turno ABIERTO —lo
      // que permite avisar de que lleva días sin cerrar y rescatarlo—, esta pantalla
      // recibiría turnos en curso con la fecha de cierre vacía, sin totales y con la
      // contabilidad en «Pendiente»: indistinguibles de un cierre que falló. Un turno
      // abierto no es un cierre; su sitio es el panel de rescate.
      .eq('estado', 'CERRADA')
      .order('cerrada_at', { ascending: false, nullsFirst: false }).limit(limite),
    db.from('cajas').select('caja_id, nombre').eq('client_id', session.client_id),
  ])

  const cajaNombres: Record<string, string> = {}
  for (const c of (cajasRes.data ?? []) as { caja_id: string; nombre: string }[]) cajaNombres[c.caja_id] = c.nombre
  const cierres = (seRes.data ?? []) as Cierre[]

  // Lo regalado en cada turno. Una consulta más sobre los turnos que se están enseñando —no
  // sobre toda la tabla—, con las anuladas fuera: un ticket rectificado no regaló nada.
  const sesiones = cierres.map(c => c.sesion_uuid)
  const dtoPorSesion = new Map<string, Record<string, number>>()
  if (sesiones.length) {
    const { data: tks } = await db.from('caja_tickets')
      .select('sesion_uuid, moneda, total, bruto, estado')
      .eq('client_id', session.client_id).in('sesion_uuid', sesiones)
    for (const tk of ((tks ?? []) as { sesion_uuid: string; moneda: string; total: number; bruto: number; estado: string }[])) {
      if ((tk.estado ?? 'VIGENTE') === 'ANULADO') continue
      const regalado = (Number(tk.bruto) > 0 ? Number(tk.bruto) : Number(tk.total)) - Number(tk.total)
      if (!(regalado > 0.005)) continue
      const acc = dtoPorSesion.get(tk.sesion_uuid) ?? {}
      acc[tk.moneda] = Math.round(((acc[tk.moneda] ?? 0) + regalado) * 100) / 100
      dtoPorSesion.set(tk.sesion_uuid, acc)
    }
  }
  for (const c of cierres) c.descuento_total = dtoPorSesion.get(c.sesion_uuid) ?? {}

  return {
    cierres, cajaNombres,
    hay_mas: cierres.length >= limite,
    total:   seRes.count ?? cierres.length,
    limite,
  }
}

// ── Rescate: las ventas que no llegaron a la contabilidad ───────────────────────

/**
 * Un grupo de ventas cuyo turno no se ha cerrado, y por tanto **no está en los libros**.
 * `motivo`: `ABIERTA` (el turno existe y sigue abierto) · `SIN_SESION` (su turno nunca
 * llegó — histórico anterior a que el dispositivo subiera la sesión abierta).
 */
export interface PendienteContabilizar {
  caja_id:     string
  sesion_uuid: string
  motivo:      'ABIERTA' | 'SIN_SESION'
  desde:       string
  hasta:       string
  tickets:     number
  totales:     Record<string, number>
}

/** LECTURA: sin candado de escritura, el de la página basta. */
export async function listarSinContabilizar(): Promise<{
  grupos: PendienteContabilizar[]; cajaNombres: Record<string, string>
}> {
  const session = await getPortalSession()
  if (!session) return { grupos: [], cajaNombres: {} }
  const db  = createAdminClient()
  const ids = await empresaIds()
  if (!ids.length) return { grupos: [], cajaNombres: {} }

  const [rpc, cajasRes] = await Promise.all([
    db.rpc('caja_pendientes_contabilizar', { p_client_id: session.client_id, p_empresa_ids: ids }),
    db.from('cajas').select('caja_id, nombre').eq('client_id', session.client_id),
  ])
  // El error NO se traga: un `?? []` aquí diría «no falta nada», que es la conclusión
  // contraria y la más cara de todas. Es la trampa que ya dejó ciega la facturación manual.
  if (rpc.error) throw new Error(`No se pudo calcular lo pendiente: ${rpc.error.message}`)

  const cajaNombres: Record<string, string> = {}
  for (const c of (cajasRes.data ?? []) as { caja_id: string; nombre: string }[]) cajaNombres[c.caja_id] = c.nombre

  return {
    grupos: ((rpc.data ?? []) as PendienteContabilizar[]).map(g => ({ ...g, totales: g.totales ?? {} })),
    cajaNombres,
  }
}

/**
 * Cierra un turno olvidado DESDE EL PORTAL y lo contabiliza.
 *
 * Red de seguridad, no camino normal — el gemelo de «Recalcular» en Inventario. El cierre se
 * fecha con el **último ticket**, nunca «hoy»: el dinero es del día en que se vendió, y
 * fecharlo hoy lo metería en el mes equivocado.
 */
export async function cerrarYContabilizar(
  caja_id: string, sesion_uuid: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: caja } = await db.from('cajas')
    .select('caja_id, client_id, empresa_id, nombre, almacen_id, cuentas_moneda, cuentas_transferencia, monedas_aceptadas, tipos_catalogo, activa')
    .eq('caja_id', caja_id).eq('client_id', session.client_id).maybeSingle()
  if (!caja) return { ok: false, error: 'Punto de venta no encontrado.' }

  // Tickets sin `sesion_uuid` (histórico): la RPC los agrupa por caja y día con una clave
  // sintética `SIN-TURNO-<caja>-<fecha>`. Adoptarlos es darles ese turno, y como la clave
  // es estable, repetir la operación no crea un segundo turno ni mueve nada dos veces.
  if (sesion_uuid.startsWith('SIN-TURNO-')) {
    const dia = sesion_uuid.slice(-10)
    const { error } = await db.rpc('caja_adoptar_tickets_sueltos', {
      p_client_id: session.client_id, p_caja_id: caja_id, p_dia: dia, p_sesion_uuid: sesion_uuid,
    })
    if (error) return { ok: false, error: error.message }
  }

  // Rango real de la jornada, leído de sus tickets.
  const { data: tks } = await db.from('caja_tickets')
    .select('fecha').eq('client_id', session.client_id).eq('sesion_uuid', sesion_uuid)
    .order('fecha', { ascending: true })
  const fechas = (tks ?? []) as { fecha: string }[]
  if (!fechas.length) return { ok: false, error: 'Ese turno ya no tiene ventas que contabilizar.' }

  // Quién cerró: aquí NO hay cajero. Este es el camino de rescate —se fue la luz, se
  // perdió el móvil— y el turno lo está cerrando el dueño desde el portal. Decirlo tal
  // cual es más honesto que dejarlo vacío o inventar un nombre, y es la razón de que
  // `cerrada_por` sea nullable en la BD en vez de obligatorio (mig. 208).
  //
  // Solo si no hay ya un nombre: un turno que SÍ cerró alguien en el mostrador y que
  // aquí solo se re-contabiliza no puede perder a su cajero.
  const { data: yaCerrada } = await db.from('caja_sesiones')
    .select('cerrada_por').eq('sesion_uuid', sesion_uuid).maybeSingle()
  const cerradaPor = (yaCerrada as { cerrada_por: string | null } | null)?.cerrada_por
    ?? `Cerrado desde el portal por ${session.email}`

  const { error: sesErr } = await db.from('caja_sesiones').upsert({
    sesion_uuid,
    caja_id:         caja.caja_id,
    client_id:       session.client_id,
    empresa_id:      caja.empresa_id,
    abierta_at:      fechas[0].fecha,
    cerrada_at:      fechas[fechas.length - 1].fecha,
    estado:          'CERRADA',
    cerrada_por:     cerradaPor,
    sincronizado_at: new Date().toISOString(),
  }, { onConflict: 'sesion_uuid' })
  if (sesErr) return { ok: false, error: sesErr.message }

  try {
    await contabilizarCierre(db, caja as CajaRow, sesion_uuid)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo contabilizar.' }
  }

  revalidarCaja(caja_id)
  return { ok: true }
}

/**
 * Reintenta contabilizar un cierre YA cerrado.
 *
 * Es la vuelta que faltaba: si una moneda no tenía su caja de Tesorería, el cierre se
 * quedaba a medias, el badge decía «Falta CUP» y no había forma de arreglarlo — el
 * dispositivo ya lo dio por enviado y no lo reenvía nunca. Idempotente: solo escribe lo que
 * falte, así que pulsarlo dos veces no duplica nada.
 */
export async function reintentarContabilizar(
  sesion_uuid: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: ses } = await db.from('caja_sesiones')
    .select('caja_id').eq('sesion_uuid', sesion_uuid).eq('client_id', session.client_id).maybeSingle()
  if (!ses) return { ok: false, error: 'Cierre no encontrado.' }

  const { data: caja } = await db.from('cajas')
    .select('caja_id, client_id, empresa_id, nombre, almacen_id, cuentas_moneda, cuentas_transferencia, monedas_aceptadas, tipos_catalogo, activa')
    .eq('caja_id', ses.caja_id).eq('client_id', session.client_id).maybeSingle()
  if (!caja) return { ok: false, error: 'Punto de venta no encontrado.' }

  try {
    await contabilizarCierre(db, caja as CajaRow, sesion_uuid)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo contabilizar.' }
  }

  revalidarCaja(ses.caja_id as string)
  return { ok: true }
}

// ── Subir archivo para sincronizar (fallback sin conexión) ──────────────────────

export async function ingestarLoteArchivo(
  caja_id: string, payload: LotePayload,
): Promise<{ ok: boolean; resultado?: Awaited<ReturnType<typeof ingestarLote>>; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('caja'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  // El archivo dice de qué punto de venta salió. Manda ÉL, no lo que haya elegido la
  // vista: ingerir las ventas de un punto en otro las mete en la empresa equivocada,
  // descuenta del almacén equivocado y postea a la cuenta equivocada, y una vez dentro
  // no hay deshacer. La comprobación va en servidor porque el cliente se puede saltar.
  const destino = typeof payload?.caja === 'string' && payload.caja ? payload.caja : caja_id
  if (destino !== caja_id) {
    return { ok: false, error: 'El archivo es de otro punto de venta que el seleccionado.' }
  }

  const db = createAdminClient()
  const { data: caja } = await db.from('cajas')
    .select('caja_id, client_id, empresa_id, nombre, almacen_id, cuentas_moneda, cuentas_transferencia, monedas_aceptadas, tipos_catalogo, activa')
    .eq('caja_id', destino).eq('client_id', session.client_id).maybeSingle()
  if (!caja) return { ok: false, error: 'Punto de venta no encontrado.' }

  const resultado = await ingestarLote(db, caja as CajaRow, payload, 'ARCHIVO')

  revalidatePath('/portal/caja/operaciones')
  revalidatePath('/portal/caja/cierres')
  revalidatePath('/portal/tesoreria')
  revalidatePath('/portal/inventario')
  return { ok: true, resultado }
}
