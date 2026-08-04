'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { ESTADOS_FACTURA_INGRESO } from '@/lib/contabilidad'
import { cobroEsIngreso, computaEnResultados } from '@/lib/gastos-core'
import { getPortalSession }  from './auth'
import { obtenerEmpresas }   from './empresas'
import { obtenerCuentasPorCobrar, obtenerCuentasPorPagar, type CuentasPageData } from './cobranza'
import { modulosDeUsuario, calcularAcceso } from '@/lib/permisos'
import { leerSetting }       from '@/lib/settings'
import { suscripcionLabel }  from '@/lib/billing'
import { obtenerEtiquetasNegocio } from './sector'
import { estadoStock, pideAtencion } from '@/lib/inventario/stock'
import { historialPorAcuerdo } from '@/lib/facturacion-suscripciones'
import { valorarPorMoneda } from '@/lib/inventario/valoracion'
import { consumoDiario, diasDeCobertura, DIAS_VENTANA, type MovimientoConsumo } from '@/lib/inventario/consumo'
import { hoyEnTz, ahoraEnTz, sumarDias, TZ_NEGOCIO } from '@/lib/fecha-tz'
import { diasDeTasa } from '@/lib/tasas-mensaje'
import { estadoEfectivo, calcularCobroAcuerdo, type EstadoSub, type PeriodicidadSub, type DescuentoModo } from '@/lib/suscripciones'
import type { EtiquetasSector } from '@/lib/sector'

// Dashboard del portal — ADAPTABLE a los módulos contratados. Solo se calculan
// y devuelven las secciones de los módulos que el cliente tiene activos, así que
// un cliente con una sola funcionalidad ve un dashboard útil (no vacío) y uno
// con todo ve todas las secciones. Addons (multiempresa) e IA quedan fuera.
// La contabilidad ('base') es un módulo más: solo aparece si está contratada.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const ESTADOS_AGENDA_ACTIVOS = ['PENDIENTE', 'CONFIRMADA']

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface SerieMes { mes: string; etiqueta: string; ventas: number; gastos: number }
export interface FacturaResumen {
  factura_id: string; numero: string; cliente_nombre: string
  fecha: string; total: number; moneda: string; estado: string
}
// Ventas/gastos/neto del mes y serie de 6 meses, SEPARADOS por moneda: distintas
// monedas no se pueden sumar en un único número (cada empresa opera en la suya).
export interface ContabMonedaResumen {
  moneda: string
  ventasMes: number; gastosMes: number; netoMes: number
  serie: SerieMes[]
}
export interface ContabilidadResumen {
  porMoneda: ContabMonedaResumen[]
  consolidado: ContabMonedaResumen | null   // ventas/gastos convertidos a la moneda de consolidación
  monedaConsolidacion: string               // código de la moneda de consolidación (es_consolidacion)
  caja: { moneda: string; saldo: number }[]
  ultimasFacturas: FacturaResumen[]
  gastosPorCategoria: { categoria: string; moneda: string; total: number }[]   // mes actual, top por importe
}
export interface InventarioResumen {
  totalProductos: number
  /** Cuenta parejas (producto, almacén) donde hay mínimo por almacén; productos donde no. */
  bajoMinimoCount: number
  /** `almacen` solo viene cuando la alerta es de un almacén concreto (mig. 153). */
  bajoMinimo: { nombre: string; stock: number; minimo: number; unidad: string; almacen?: string }[]
  /**
   * Lo que el insight de IA necesitaba y no tenía. Con `{total, bajoMinimoCount}` el
   * modelo solo podía repetir lo que la pantalla ya dice; con la cobertura pasa de
   * «tienes 3 bajo mínimo» a «al ritmo de las últimas semanas te quedas sin arroz en
   * Central el 12 de agosto». Recortado a los 10 más urgentes: el prompt tiene
   * presupuesto y volcar el ledger entero es la forma de empeorarlo.
   */
  urgentes: {
    producto: string
    almacen:  string
    unidad:   string
    stock:    number
    minimo:   number
    /** Días estimados al ritmo de los últimos 90 días; `null` si no hay historia. */
    cobertura: number | null
  }[]
  /** Stock negativo: se informa, nunca se alarma (es un flujo permitido). */
  negativos: { producto: string; almacen: string; stock: number; unidad: string }[]
  /** Valor del inventario, nativo por moneda y sin convertir. */
  valor: { moneda: string; valor: number; sinCoste: number }[]
}
/**
 * Equipo. «Empleados activos» y «altas del mes» son censo, no gestión: no piden
 * ninguna acción. Lo accionable es la nómina que sigue en borrador y los contratos
 * que se acaban — eso sí hay que atenderlo antes de que pase la fecha.
 */
export interface RrhhResumen {
  activos:  number
  altasMes: number
  /** Nóminas en BORRADOR (sin confirmar): el gasto aún no está contabilizado. */
  nominasBorrador: number
  /** Contratos que terminan en los próximos 30 días. */
  contratosPorVencer: number
}
// Deudas pendientes (aging compacto para el insight). Un lado = cobrar o pagar.
export interface DeudasLado {
  por_moneda: { moneda: string; total: number; vencido: number }[]
  top:        { nombre: string; moneda: string; saldo: number; dias_vencido_max: number }[]
}
export interface DeudasResumen { cobrar: DeudasLado; pagar: DeudasLado }
export type FuenteTasa = 'EL_TOQUE' | 'FRANKFURTER' | 'MANUAL'
export interface TasaFila {
  origen:  string
  destino: string
  /** «1 origen = tasa destino». `null` = par configurado pero aún sin tasa. */
  tasa:    number | null
  fuente:  FuenteTasa
  fecha:   string | null
  /** Días desde que se actualizó. `null` si la tasa no lleva fecha. */
  dias:    number | null
}
export interface TasasResumen {
  /** Los pares de cambio configurados en Monedas, con su tasa vigente. */
  filas: TasaFila[]
}
export interface ServiciosResumen {
  activas: number
  ingresoRecurrente: { moneda: string; total: number }[]   // Σ precio_pactado normalizado a mensual, por moneda
  proximasRenovaciones: number                              // suscripciones cuyo próximo cobro cae en 30 días
  /** Las próximas, CON NOMBRE: «2 renuevan» no dice a quién hay que cobrar. */
  proximas: { nombre: string; fecha: string; moneda: string; importe: number }[]
  /**
   * El ingreso recurrente no dice si SUBE o BAJA, que es la única pregunta que se hace
   * quien vive de cuotas. Altas = `fecha_inicio` en el mes; bajas = `cancelada_at` en el
   * mes (mig. 161 — `updated_at` daría bajas inventadas porque lo pisa cualquier edición).
   */
  altasMes: number
  bajasMes: number
  /**
   * Lo que el widget NO enseña y el insight de IA necesitaba para aportar algo: el
   * contexto anterior repetía exactamente las tres cifras de la pantalla, así que ningún
   * prompt podía sacar una conclusión nueva (mismo diagnóstico que llevó a enriquecer el
   * `FocoContexto` de Inventario). Se calcula solo cuando hay suscripciones.
   */
  cobrosAtrasados: number
  /** El atraso más viejo, para poder decir «desde mayo». */
  atrasoDesde: string | null
  /** Facturas de suscripción sin emitir: el trabajo invisible del mes. */
  borradoresSinEmitir: number
  /** Deuda viva de las facturas de suscripción, por moneda. */
  deuda: { moneda: string; total: number }[]
  /** Acuerdos que vencen en 60 días SIN renovación automática: riesgo de baja. */
  vencenSinRenovar: number
  /** Pausados ahora mismo. */
  pausadas: number
}

export interface PuntoVentaResumen {
  ventasHoy:      { moneda: string; total: number }[]
  sinSincronizar: number
  puntos: {
    nombre:        string
    ventasHoy:     { moneda: string; total: number }[]
    ultimaSync:    string | null
    syncHoy:       boolean
    turnoAbiertoDesde: string | null   // fecha del turno abierto de un día anterior
  }[]
}
/**
 * Dossier del negocio en el dashboard. Lo que importa de un vistazo NO son sus
 * cifras —esas ya están en Reportes— sino si el documento que el dueño reparte
 * está LISTO y AL DÍA: un enlace publicado con números viejos es peor que no
 * tenerlo, porque alguien lo está mirando ahora mismo.
 */
export interface DossierResumen {
  total:       number
  publicados:  number
  /** Publicados con el snapshot desfasado o rancio: la única cifra accionable. */
  desfasados:  number
  /** `snapshot_at` más reciente, para decir cuándo se actualizó por última vez. */
  ultimoSnapshot: string | null
  /** Título del primero, para nombrarlo cuando solo hay uno. */
  titulo:      string | null
  /** Sin dossier creado todavía: el widget invita a crearlo en vez de dar ceros. */
  vacio:       boolean
}

/**
 * Catálogo/menú público en el dashboard. Lo que importa no es cuántos platos hay,
 * sino si lo que ve el cliente final está PRESENTABLE: un plato sin foto o sin
 * precio en una carta publicada es una venta que no ocurre.
 */
export interface CatalogoResumen {
  items:       number
  agotados:    number   // `disponible = false`
  sinFoto:     number
  sinPrecio:   number
  vacio:       boolean  // sin ningún ítem: el widget invita a crearlo
}

export interface AgendaItem { hora: string | null; nombre: string; personas: number; estado: string }
export interface AgendaResumen {
  hoyCount: number
  personasHoy: number
  proxima: { fecha: string; hora: string | null; nombre: string } | null
  hoyLista: AgendaItem[]
  serie7: { fecha: string; etiqueta: string; total: number }[]
}
export interface AccesoRapido { clave: string; label: string; ruta: string }

/** Una línea de «Pendiente»: algo que el dueño debería atender HOY. */
export interface Pendiente {
  clave: string
  texto: string
  ruta:  string
  /** `alerta` = ya duele (vencido, bajo mínimo); `aviso` = conviene mirarlo. */
  tono:  'alerta' | 'aviso'
}

/** Un módulo que el cliente NO tiene, para ofrecérselo. */
export interface ModuloOferta {
  clave:  string
  label:  string
  gancho: string
  /** Día en que este cliente ya pidió activarlo («26 jul»), si lo pidió. */
  pedidoEl?: string
}

export interface Captacion {
  /** Módulos con panel que SÍ tiene. Decide si el banner va destacado o al pie. */
  conPanel: number
  faltan:   ModuloOferta[]
  /**
   * Buzón comercial al que escribe el dueño para activar algo. Setting
   * `email_contratacion` (por defecto `contacto@claux.es`): si mañana hay un
   * alias propio de contratación se cambia ahí, no en el código.
   */
  email:    string
}

export interface EmpresaLite { empresa_id: string; nombre: string; color?: string | null }

// Paso de puesta en marcha: dato base que el negocio debe crear para operar un
// módulo (empresa, moneda, almacén…). Nada se pre-crea, así que el dashboard guía
// los pasos fundamentales según los módulos contratados.
export interface OnboardingPaso { clave: string; label: string; hecho: boolean; href: string }

export interface DashboardData {
  nombreEmpresa: string
  empresas: EmpresaLite[]
  // Prerrequisitos base pendientes (solo admin_empresa, que es quien los crea;
  // ambos false para el resto). El dashboard muestra un aviso para crearlos sin
  // ocultar los widgets. `moneda` solo se marca si hay módulos que la usan.
  setupPendiente: { empresa: boolean; moneda: boolean }
  fecha: string
  etiquetas: EtiquetasSector
  suscripcion: { estado: string; diasRestantes: number | null; label: string }
  tieneIa: boolean
  /** Lo accionable de TODOS los módulos, en una franja arriba. */
  pendiente: Pendiente[]
  captacion: Captacion
  contabilidad?: ContabilidadResumen
  deudas?: DeudasResumen
  tasas?: TasasResumen
  inventario?: InventarioResumen
  puntoVenta?: PuntoVentaResumen
  rrhh?: RrhhResumen
  servicios?: ServiciosResumen
  dossier?: DossierResumen
  catalogo?: CatalogoResumen
  reservas?: AgendaResumen
  citas?: AgendaResumen
  accesos: AccesoRapido[]
}

// Accesos rápidos de fallback (módulos sin widget propio o cliente sin widgets).
// Fuera: addons (multiempresa) e IA (asistente_ia).
const ACCESOS: Record<string, { label: string; ruta: string }> = {
  base:               { label: 'Contabilidad', ruta: '/portal/ventas' },
  inventario:         { label: 'Inventario',   ruta: '/portal/inventario' },
  rrhh:               { label: 'Personal',     ruta: '/portal/rrhh' },
  reservas_citas:     { label: 'Reservas',     ruta: '/portal/reservas' },
  agenda:             { label: 'Citas',        ruta: '/portal/citas' },
  catalogo_qr:        { label: 'Catálogo',     ruta: '/portal/catalogo' },
  documentos_imprenta:{ label: 'Documentos',   ruta: '/portal/imprenta' },
  dossier:            { label: 'Dossier',      ruta: '/portal/dossier' },
}

// Módulos que aportan panel propio al dashboard. Es lo que se cuenta para decidir
// si el banner de captación va destacado: un cliente puede tener tres cosas
// contratadas (IA, imprenta, multiempresa) y el dashboard seguir casi vacío, así
// que contar «lo contratado» a secas daría la respuesta equivocada.
const MODULOS_CON_PANEL = ['base', 'inventario', 'caja', 'rrhh', 'reservas_citas', 'agenda', 'servicios', 'dossier', 'catalogo_qr']

// Catálogo de lo que se puede ofrecer, con el gancho de por qué le importa al
// dueño (el nombre solo no vende: «Inventario» no dice qué problema resuelve).
// Fuera: `documentos_imprenta`, que sale solo (su fila del catálogo está inactiva:
// la página es EnConstruccion y no se vende lo que no existe).
//
// Los ADDONS sí se ofrecen, pero los que amplían otro módulo llevan `requiere`:
// ofrecer «Multidossier» a quien no tiene Dossier es vender un accesorio de algo
// que no tiene. `multiempresa` no lleva requisito porque no amplía un módulo: es
// de la cuenta, y llevar dos negocios es justo el caso de quien aún tiene uno.
// Los nombres son los del CATÁLOGO comercial (`modulos_catalogo`): es lo que el
// cliente verá al contratar y en su factura, así que llamarlo de otra forma aquí
// sería venderle algo con un nombre que luego no encuentra. Si un nombre no gusta,
// se cambia en el catálogo —una sola fuente—, no aquí.
//
// ORDEN: el de este array NO decide nada. Lo que se enseña primero sale de
// `modulos_catalogo` (tipo + orden) — ver `ordenarOferta`.
const OFERTA: { clave: string; label: string; gancho: string; requiere?: string }[] = [
  { clave: 'base',           label: 'Contabilidad',   gancho: 'Factura, controla gastos y sabe si de verdad ganas dinero.' },
  { clave: 'inventario',     label: 'Inventario',     gancho: 'Sabe qué te queda y qué hay que reponer antes de quedarte sin.' },
  { clave: 'caja',           label: 'Punto de venta', gancho: 'Cobra en el mostrador y cuadra la caja al cerrar.' },
  { clave: 'rrhh',           label: 'RRHH',           gancho: 'Personal, contratos, turnos y nóminas de tu equipo.' },
  { clave: 'reservas_citas', label: 'Reservas',       gancho: 'Tus clientes reservan solos, sin llamadas ni libreta.' },
  { clave: 'agenda',         label: 'Citas',          gancho: 'Agenda por profesional, sin solapes ni huecos muertos.' },
  { clave: 'servicios',      label: 'Servicios',      gancho: 'Cobros que se repiten cada mes, controlados solos.' },
  { clave: 'catalogo_qr',    label: 'Catálogo',       gancho: 'Tu carta con un QR, siempre al día y sin reimprimir.' },
  { clave: 'dossier',        label: 'Dossier',        gancho: 'Presenta tus números a un banco o a un socio.' },
  { clave: 'asistente_ia',   label: 'Asistente IA',   gancho: 'Pregúntale a tus datos en lenguaje normal.' },
  { clave: 'multiempresa',   label: 'Multiempresa',   gancho: 'Lleva varios negocios desde la misma cuenta, cada uno con sus números.' },
  { clave: 'multidossier',   label: 'Multidossier',   gancho: 'Un dossier distinto para cada interlocutor: banco, socio, proveedor.', requiere: 'dossier' },
]

// Se ofrece primero lo que MÁS resuelve: primero los módulos (capacidad ERP
// completa), después las funcionalidades por su importancia comercial, y al final
// los addons. Ese reparto ya está decidido en `modulos_catalogo` (`tipo` +
// `orden`), que es lo que ve el admin al contratar: repetirlo en un array aquí
// sería una segunda fuente de verdad que se desincroniza al primer módulo nuevo.
// Lo ya pedido baja al final: sigue visible como acuse, pero no ocupa portada.
const RANGO_TIPO: Record<string, number> = { modulo: 0, funcionalidad: 1, addon: 2 }

interface FilaCatalogo { clave: string; tipo: string; orden: number }

function ordenarOferta(oferta: ModuloOferta[], catalogo: FilaCatalogo[]): ModuloOferta[] {
  const peso = new Map(catalogo.map(c => [c.clave, (RANGO_TIPO[c.tipo] ?? 9) * 1000 + (c.orden ?? 0)]))
  return oferta
    // Sin fila activa en el catálogo no se ofrece: bajar un módulo del catálogo
    // tiene que dejar de venderlo sin tocar código.
    .filter(o => peso.has(o.clave))
    .sort((a, b) => {
      if (!!a.pedidoEl !== !!b.pedidoEl) return a.pedidoEl ? 1 : -1
      return peso.get(a.clave)! - peso.get(b.clave)!
    })
}

// Importe para las frases de «Pendiente». El código de moneda lo pone quien llama:
// aquí solo se formatea el número (nunca se asume una moneda).
const fmtImporte = (n: number) =>
  n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * «1.130,00 USD y 725,00 EUR» — los vencidos de un lado (cobrar o pagar) en una
 * sola frase. Se respeta el ORDEN en que vienen las monedas del cliente: ordenar
 * por importe compararía 7.000 CUP con 320 USD, que no es comparar nada.
 * Más de tres no se leen, así que el resto se resume — el desglose exacto está a
 * un clic, en la tarjeta de Cobros y pagos.
 */
function importesVencidos(ms: { moneda: string; vencido: number }[]): string {
  const partes = ms.slice(0, 3).map(m => `${fmtImporte(m.vencido)} ${m.moneda}`)
  const resto = ms.length - partes.length
  if (resto > 0) partes.push(`${resto} moneda${resto === 1 ? '' : 's'} más`)
  if (partes.length === 1) return partes[0]
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

// ── Helpers de fecha ────────────────────────────────────────────────────────────

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** «26 jul» a partir de un timestamp, en la hora del negocio (no la del server). */
function fechaCortaDeISO(iso: string | undefined): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return undefined
  // formatToParts, no `format().split()`: el orden de día y mes depende del
  // locale y partirlo a mano es justo cómo se cuela un «7 de 26».
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_NEGOCIO, day: 'numeric', month: 'numeric',
  }).formatToParts(d)
  const dia = Number(partes.find(p => p.type === 'day')?.value)
  const mes = Number(partes.find(p => p.type === 'month')?.value)
  if (!dia || !mes) return undefined
  return `${dia} ${MESES_CORTOS[mes - 1]}`
}
const DIAS_CORTOS  = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

function clavesMes(hoy: string, n: number): { mes: string; etiqueta: string }[] {
  const [y, m] = hoy.split('-').map(Number)
  const out: { mes: string; etiqueta: string }[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    const mm = d.getUTCMonth()
    out.push({
      mes: `${d.getUTCFullYear()}-${String(mm + 1).padStart(2, '0')}`,
      etiqueta: MESES_CORTOS[mm],
    })
  }
  return out
}

function etiquetaDia(fechaISO: string): string {
  const [y, m, d] = fechaISO.split('-').map(Number)
  return DIAS_CORTOS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

// ── Builders por módulo ─────────────────────────────────────────────────────────

// `empresaIds` acota los datos a las empresas accesibles del usuario, igual que
// Ventas/Gastos/Tesorería/Reportes (`.in('empresa_id', …)`). Así el resumen del
// dashboard cuadra con lo que el usuario ve al abrir cada página.
/**
 * Los pares de cambio configurados en Monedas, con su tasa vigente — los MISMOS
 * que el dueño ve y edita ahí (EUR→CUP, USD→CUP…), no una derivación contra una
 * base. No es adorno: TODO lo que el dashboard consolida (ventas, gastos, deudas)
 * se convierte con estas tasas, así que una tasa vieja no da error, da un número
 * creíble y equivocado. Sin pares configurados no hay nada que enseñar.
 */
async function resumenTasas(db: Db, cid: string, hoy: string): Promise<TasasResumen | undefined> {
  const [{ data: paresData }, { data: tasasData }] = await Promise.all([
    db.from('pares_tasa')
      .select('origen, destino, fuente')
      .eq('client_id', cid).eq('activo', true)
      .order('origen').order('destino'),
    db.from('tasas_cambio')
      .select('moneda_origen, moneda_destino, tasa, fecha')
      .eq('client_id', cid)
      .order('fecha', { ascending: false }).order('tasa_id', { ascending: false }),
  ])
  const pares = (paresData ?? []) as { origen: string; destino: string; fuente: FuenteTasa }[]
  if (pares.length === 0) return undefined

  // Tasa más reciente por par (la primera al venir ordenado por fecha desc).
  const rateMap = new Map<string, { tasa: number; fecha: string | null }>()
  for (const t of (tasasData ?? []) as { moneda_origen: string; moneda_destino: string; tasa: number; fecha: string | null }[]) {
    const k = `${t.moneda_origen}__${t.moneda_destino}`
    if (!rateMap.has(k)) rateMap.set(k, { tasa: Number(t.tasa), fecha: t.fecha })
  }

  const filas: TasaFila[] = pares.map(p => {
    const r = rateMap.get(`${p.origen}__${p.destino}`)
    return {
      origen: p.origen, destino: p.destino, fuente: p.fuente,
      tasa:  r ? r.tasa : null,
      fecha: r?.fecha ?? null,
      dias:  diasDeTasa(r?.fecha ?? null, hoy),
    }
  })
  return { filas }
}

async function resumenContabilidad(db: Db, cid: string, hoy: string, empresaIds: string[]): Promise<ContabilidadResumen> {
  const meses = clavesMes(hoy, 6)
  const desde6 = `${meses[0].mes}-01`
  const mesActual = hoy.slice(0, 7)

  const [facturas6, registros6, movimientos, cuentasCaja, ultimas, consolRow, tasas, categoriasGasto] = await Promise.all([
    db.from('facturas').select('fecha_emision, total, moneda')
      .eq('client_id', cid).in('empresa_id', empresaIds).in('estado', ESTADOS_FACTURA_INGRESO).gte('fecha_emision', desde6),
    // Los DOS tipos, no solo los gastos. Este widget contaba como ventas únicamente las
    // facturas, así que un negocio que cobra sin facturar —mostrador, TPV— veía «Ventas
    // del mes: 0» y un neto igual a sus gastos en negativo, mientras Reportes le decía
    // otra cosa. Y la IA lee este mismo resumen: le llegaba el cero como un hecho.
    db.from('gastos_cobros').select('tipo, fecha, monto, moneda, categoria_id, origen_tipo, naturaleza')
      .eq('client_id', cid).in('empresa_id', empresaIds).gte('fecha', desde6),
    db.from('movimientos_tesoreria').select('cuenta_id, monto, tipo').eq('client_id', cid).in('empresa_id', empresaIds),
    db.from('cuentas').select('cuenta_id, moneda, saldo_inicial').eq('client_id', cid).in('empresa_id', empresaIds).eq('activa', true).eq('es_apertura', false),
    db.from('facturas').select('factura_id, numero, cliente_id, fecha_emision, total, moneda, estado')
      .eq('client_id', cid).in('empresa_id', empresaIds).order('fecha_emision', { ascending: false }).limit(5),
    db.from('monedas').select('codigo').eq('client_id', cid).eq('es_consolidacion', true).limit(1).maybeSingle(),
    db.from('tasas_cambio').select('moneda_origen, moneda_destino, tasa, fecha')
      .eq('client_id', cid).order('fecha', { ascending: false }),
    db.from('categorias_gastos').select('categoria_id, nombre').eq('client_id', cid),
  ])

  // Se parten los registros en los dos lados del informe, y las filas que son SOLO
  // DEUDA se quedan fuera de los dos (mig. 166): el subsidio por cobrar, que recupera
  // un anticipo, y las deudas de una nómina —salario neto y retenciones—, cuyo coste
  // ya está en las filas de coste de esa misma nómina. Es el mismo predicado que usan
  // Reportes y el dossier, para que las tres pantallas no digan tres cifras.
  type FilaGC = { tipo: string; fecha: string; monto: number; moneda: string; categoria_id: string | null; origen_tipo: string | null; naturaleza: string | null }
  const registros = (registros6.data ?? []) as FilaGC[]
  const gastosGC   = registros.filter(g => g.tipo === 'GASTO' && computaEnResultados(g.naturaleza))
  const ingresosGC = registros.filter(g => g.tipo === 'COBRO' && cobroEsIngreso(g.naturaleza))

  // Serie mensual y totales del mes SEPARADOS POR MONEDA (no se suman entre sí).
  const monedasSet = new Set<string>()
  for (const f of (facturas6.data ?? [])) monedasSet.add(f.moneda)
  for (const g of registros) monedasSet.add(g.moneda)

  const porMoneda: ContabMonedaResumen[] = [...monedasSet].sort().map(moneda => {
    const serieMap = new Map(meses.map(m => [m.mes, { ...m, ventas: 0, gastos: 0 }]))
    for (const f of (facturas6.data ?? [])) {
      if (f.moneda !== moneda) continue
      const b = serieMap.get(String(f.fecha_emision).slice(0, 7)); if (b) b.ventas += Number(f.total) || 0
    }
    for (const g of ingresosGC) {
      if (g.moneda !== moneda) continue
      const b = serieMap.get(String(g.fecha).slice(0, 7)); if (b) b.ventas += Number(g.monto) || 0
    }
    for (const g of gastosGC) {
      if (g.moneda !== moneda) continue
      const b = serieMap.get(String(g.fecha).slice(0, 7)); if (b) b.gastos += Number(g.monto) || 0
    }
    const bucket = serieMap.get(mesActual)
    const ventasMes = bucket?.ventas ?? 0
    const gastosMes = bucket?.gastos ?? 0
    return { moneda, ventasMes, gastosMes, netoMes: ventasMes - gastosMes, serie: [...serieMap.values()] }
  })

  // Consolidado: convierte cada moneda a la de consolidación (es_consolidacion).
  // Se ancla en los pares "consol→moneda" (p. ej. 1 USD = 670 CUP), que son los
  // consistentes; el factor es su inverso. Si falta tasa, esa moneda se excluye.
  const consolCode: string | null = consolRow.data?.codigo ?? null
  const rateMap = new Map<string, number>()
  for (const t of (tasas.data ?? [])) {
    const k = `${t.moneda_origen}__${t.moneda_destino}`
    if (!rateMap.has(k)) rateMap.set(k, Number(t.tasa)) // primera = más reciente (orden desc por fecha)
  }
  const factorAConsol = (moneda: string): number | null => {
    if (!consolCode) return null
    if (moneda === consolCode) return 1
    const saliente = rateMap.get(`${consolCode}__${moneda}`) // 1 consol = X moneda
    if (saliente && saliente > 0) return 1 / saliente
    const entrante = rateMap.get(`${moneda}__${consolCode}`) // 1 moneda = X consol
    if (entrante && entrante > 0) return entrante
    return null
  }
  const r2 = (n: number) => Math.round(n * 100) / 100

  let consolidado: ContabMonedaResumen | null = null
  if (consolCode && porMoneda.length > 1) {
    const convertibles = porMoneda
      .map(pm => ({ pm, f: factorAConsol(pm.moneda) }))
      .filter((x): x is { pm: ContabMonedaResumen; f: number } => x.f != null)
    if (convertibles.length) {
      const serie = meses.map((mm, i) => {
        let ventas = 0, gastos = 0
        for (const { pm, f } of convertibles) {
          ventas += (pm.serie[i]?.ventas ?? 0) * f
          gastos += (pm.serie[i]?.gastos ?? 0) * f
        }
        return { mes: mm.mes, etiqueta: mm.etiqueta, ventas: r2(ventas), gastos: r2(gastos) }
      })
      let ventasMes = 0, gastosMes = 0
      for (const { pm, f } of convertibles) { ventasMes += pm.ventasMes * f; gastosMes += pm.gastosMes * f }
      consolidado = { moneda: consolCode, ventasMes: r2(ventasMes), gastosMes: r2(gastosMes), netoMes: r2(ventasMes - gastosMes), serie }
    }
  }

  // Caja por moneda (igual que Tesorería: saldo_inicial de cuentas activas + Σ INGRESO − Σ EGRESO;
  // cuentas archivadas quedan fuera, junto con sus movimientos — y también las de
  // «Apertura» de la migración, que no son caja: el `continue` de abajo las descarta
  // porque no están en `cuentaMoneda`)
  const cuentaMoneda = new Map<string, string>()
  const cajaMap = new Map<string, number>()
  for (const c of (cuentasCaja.data ?? [])) {
    cuentaMoneda.set(c.cuenta_id, c.moneda)
    cajaMap.set(c.moneda, (cajaMap.get(c.moneda) ?? 0) + Number(c.saldo_inicial))
  }
  for (const m of (movimientos.data ?? [])) {
    const moneda = cuentaMoneda.get(m.cuenta_id)
    if (!moneda) continue
    const delta = m.tipo === 'INGRESO' ? Number(m.monto) : -Number(m.monto)
    cajaMap.set(moneda, (cajaMap.get(moneda) ?? 0) + (delta || 0))
  }
  const caja = [...cajaMap.entries()].filter(([, s]) => Math.abs(s) > 0.005).map(([moneda, saldo]) => ({ moneda, saldo }))

  // Desglose de gastos del MES ACTUAL por categoría y moneda (alimenta el insight
  // de Gastos: sin esto solo hay totales y no puede decir «dónde ahorrar»). Top 8.
  const nombreCat = new Map<string, string>(
    (categoriasGasto.data ?? []).map((c: { categoria_id: string; nombre: string }) => [c.categoria_id, c.nombre]),
  )
  const catAgg = new Map<string, { categoria: string; moneda: string; total: number }>()
  for (const g of gastosGC) {
    if (String(g.fecha).slice(0, 7) !== mesActual) continue
    const categoria = g.categoria_id ? (nombreCat.get(g.categoria_id) ?? 'Sin categoría') : 'Sin categoría'
    const k = `${g.categoria_id ?? 'none'}__${g.moneda}`
    const cur = catAgg.get(k) ?? { categoria, moneda: g.moneda, total: 0 }
    cur.total += Number(g.monto) || 0
    catAgg.set(k, cur)
  }
  const gastosPorCategoria = [...catAgg.values()]
    .map(x => ({ ...x, total: r2(x.total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)

  // Nombres de terceros para últimas facturas
  const ids = [...new Set((ultimas.data ?? []).map((f: { cliente_id: string }) => f.cliente_id).filter(Boolean))]
  const { data: terceros } = ids.length
    ? await db.from('third_parties').select('tercero_id, nombre').eq('client_id', cid).in('tercero_id', ids)
    : { data: [] }
  const nombres = Object.fromEntries((terceros ?? []).map((t: { tercero_id: string; nombre: string }) => [t.tercero_id, t.nombre]))

  return {
    porMoneda, consolidado, monedaConsolidacion: consolCode ?? '', caja,
    ultimasFacturas: (ultimas.data ?? []).map((f: Record<string, unknown>) => ({
      factura_id: f.factura_id as string,
      numero: f.numero as string,
      cliente_nombre: nombres[f.cliente_id as string] ?? '—',
      fecha: f.fecha_emision as string,
      total: Number(f.total),
      moneda: f.moneda as string,
      estado: f.estado as string,
    })),
    gastosPorCategoria,
  }
}

// Aging compacto de un lado (CxC o CxP): total y vencido por moneda + top 5
// terceros por saldo. Reutiliza el cálculo real de cobranza (no lo reimplementa).
function agregarDeuda(data: CuentasPageData | null): DeudasLado {
  const r2 = (n: number) => Math.round(n * 100) / 100
  const porMonedaMap = new Map<string, { total: number; vencido: number }>()
  const topMap = new Map<string, { nombre: string; moneda: string; saldo: number; dias_vencido_max: number }>()
  for (const d of (data?.documentos ?? [])) {
    const pm = porMonedaMap.get(d.moneda) ?? { total: 0, vencido: 0 }
    pm.total += d.saldo
    if ((d.dias_vencido ?? 0) > 0) pm.vencido += d.saldo
    porMonedaMap.set(d.moneda, pm)

    const nombre = d.tercero_nombre ?? '—'
    const k = `${nombre}__${d.moneda}`
    const t = topMap.get(k) ?? { nombre, moneda: d.moneda, saldo: 0, dias_vencido_max: 0 }
    t.saldo += d.saldo
    t.dias_vencido_max = Math.max(t.dias_vencido_max, d.dias_vencido ?? 0)
    topMap.set(k, t)
  }
  return {
    por_moneda: [...porMonedaMap.entries()].map(([moneda, v]) => ({ moneda, total: r2(v.total), vencido: r2(v.vencido) })),
    top: [...topMap.values()].map(x => ({ ...x, saldo: r2(x.saldo) })).sort((a, b) => b.saldo - a.saldo).slice(0, 5),
  }
}

async function resumenDeudas(): Promise<DeudasResumen> {
  const [cobrar, pagar] = await Promise.all([obtenerCuentasPorCobrar(), obtenerCuentasPorPagar()])
  return { cobrar: agregarDeuda(cobrar), pagar: agregarDeuda(pagar) }
}

/**
 * Catálogo/menú público. Cuenta lo que ESTROPEA la carta de cara al cliente
 * final (agotados, sin foto, sin precio), no lo que hay: el número de platos no
 * pide ninguna acción, un plato sin precio sí.
 */
async function resumenCatalogo(db: Db, cid: string): Promise<CatalogoResumen> {
  const { data } = await db.from('catalogo_items')
    .select('precio, foto_url, disponible')
    .eq('client_id', cid).eq('activo', true)

  const items = (data ?? []) as { precio: number | null; foto_url: string | null; disponible: boolean }[]
  return {
    items:     items.length,
    agotados:  items.filter(i => !i.disponible).length,
    sinFoto:   items.filter(i => !i.foto_url).length,
    sinPrecio: items.filter(i => i.precio == null).length,
    vacio:     items.length === 0,
  }
}

// El mismo criterio que el escáner de avisos y que el listado, vía `estadoStock`:
// antes había tres copias con dos criterios y el resultado era campana roja con
// dashboard en verde sobre el mismo producto.
//
// OJO: este resumen alimenta también el contexto de la IA (`lib/ia/contexto.ts`).
// Lo que se añada aquí lo ve el modelo; lo que se rompa aquí, también.
async function resumenInventario(db: Db, cid: string): Promise<InventarioResumen> {
  const desdeConsumo = new Date(Date.now() - DIAS_VENTANA * 86_400_000).toISOString().split('T')[0]
  const [{ data: productos }, { data: config }, { data: stock }, { data: almacenes }, { data: movs }, { data: mon }] = await Promise.all([
    db.from('products')
      .select('producto_id, nombre, stock_actual, stock_minimo, unidad, tipo, estado, costos')
      .eq('client_id', cid).eq('estado', 'ACTIVO').neq('tipo', 'SERVICIO'),
    db.from('producto_almacen_config')
      .select('producto_id, almacen_id, stock_minimo').eq('client_id', cid).not('stock_minimo', 'is', null),
    db.from('stock_almacenes').select('producto_id, almacen_id, cantidad').eq('client_id', cid),
    // `almacenes` archiva con `activo` boolean; no tiene columna `estado`.
    db.from('almacenes').select('almacen_id, nombre').eq('client_id', cid).eq('activo', true),
    db.from('movimientos_inventario')
      .select('producto_id, almacen_id, almacen_destino_id, tipo, origen, cantidad, fecha')
      .eq('client_id', cid).in('tipo', ['SALIDA', 'TRANSFERENCIA']).gte('fecha', desdeConsumo),
    db.from('monedas').select('codigo').eq('client_id', cid).eq('activa', true).order('codigo'),
  ])

  type Fila = { producto_id: string; nombre: string; stock_actual: number; stock_minimo: number; unidad: string; costos: Record<string, number> | null }
  const lista       = (productos ?? []) as Fila[]
  const filasCfg    = (config    ?? []) as { producto_id: string; almacen_id: string; stock_minimo: number }[]
  const filasStk    = (stock     ?? []) as { producto_id: string; almacen_id: string; cantidad: number }[]
  const filasAlm    = (almacenes ?? []) as { almacen_id: string; nombre: string }[]

  const productoDe  = new Map(lista.map(p => [p.producto_id, p]))
  const nombreAlm   = new Map(filasAlm.map(a => [a.almacen_id, a.nombre]))
  const cantidadDe  = new Map(filasStk.map(s => [`${s.producto_id}@${s.almacen_id}`, Number(s.cantidad ?? 0)]))
  const conConfig   = new Set(filasCfg.map(c => c.producto_id))

  const bajo: InventarioResumen['bajoMinimo'] = []

  // Con mínimo por almacén, la alerta es de ese almacén.
  for (const c of filasCfg) {
    const p = productoDe.get(c.producto_id)
    const almacen = nombreAlm.get(c.almacen_id)
    if (!p || !almacen) continue
    const stockAlm = cantidadDe.get(`${c.producto_id}@${c.almacen_id}`) ?? 0
    const minimo   = Number(c.stock_minimo)
    if (!pideAtencion(estadoStock(stockAlm, minimo))) continue
    bajo.push({ nombre: p.nombre, stock: stockAlm, minimo, unidad: p.unidad ?? '', almacen })
  }

  // Sin configuración, el consolidado con el mínimo global — como siempre.
  for (const p of lista) {
    if (conConfig.has(p.producto_id)) continue
    const actual = Number(p.stock_actual) || 0
    const minimo = Number(p.stock_minimo) || 0
    if (!pideAtencion(estadoStock(actual, minimo))) continue
    bajo.push({ nombre: p.nombre, stock: actual, minimo, unidad: p.unidad ?? '' })
  }

  bajo.sort((a, b) => (a.stock - a.minimo) - (b.stock - b.minimo))

  // ── Lo que la IA necesita y no tenía (Fase 9.1) ──
  // El consumo se calcula sobre el MISMO ledger, con la misma función que la pantalla:
  // así el modelo no puede decir un número distinto del que el dueño está viendo.
  const consumo = consumoDiario((movs ?? []) as MovimientoConsumo[])
  const urgentes = bajo
    .map(b => {
      // La cobertura es por almacén; para una alerta consolidada se suma el consumo
      // de todos sus almacenes, que es el ritmo con el que se vacía el total.
      const p = lista.find(x => x.nombre === b.nombre)
      let diario = 0, movimientos = 0, dias = 0
      for (const [clave, c] of consumo) {
        if (!p || !clave.startsWith(`${p.producto_id}@`)) continue
        if (b.almacen && nombreAlm.get(clave.split('@')[1]) !== b.almacen) continue
        diario      += c.diario
        movimientos += c.movimientos
        dias         = Math.max(dias, c.diasHistoria)
      }
      return {
        producto:  b.nombre,
        almacen:   b.almacen ?? 'todos los almacenes',
        unidad:    b.unidad,
        stock:     b.stock,
        minimo:    b.minimo,
        cobertura: diasDeCobertura(b.stock, diario > 0 ? { diario, movimientos, diasHistoria: dias } : undefined),
      }
    })
    // Lo que se acaba antes, primero: es el orden con el que hay que reponer.
    .sort((a, b) => (a.cobertura ?? Number.MAX_SAFE_INTEGER) - (b.cobertura ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 10)

  // Solo productos vivos: uno archivado con negativo es cosa de «Revisar», no del
  // resumen que se le cuenta al dueño.
  const negativos = filasStk
    .filter(s => Number(s.cantidad) < -0.0005 && productoDe.has(s.producto_id))
    .map(s => ({
      producto: productoDe.get(s.producto_id)!.nombre,
      almacen:  nombreAlm.get(s.almacen_id) ?? s.almacen_id,
      stock:    Number(s.cantidad),
      unidad:   productoDe.get(s.producto_id)!.unidad ?? '',
    }))
    .slice(0, 10)

  // Valor nativo por moneda, sin convertir, y con las referencias sin coste aparte:
  // un producto sin coste NO vale 0.
  const monedas = ((mon ?? []) as { codigo: string }[]).map(m => m.codigo)
  const valor = valorarPorMoneda(
    filasStk
      .map(s => ({ producto_id: s.producto_id, cantidad: Number(s.cantidad), costos: productoDe.get(s.producto_id)?.costos }))
      .filter(f => productoDe.has(f.producto_id)),
    monedas,
  ).map(v => ({ moneda: v.moneda, valor: Math.round(v.valor * 100) / 100, sinCoste: v.sinCoste }))

  return {
    totalProductos: lista.length,
    bajoMinimoCount: bajo.length,
    bajoMinimo: bajo.slice(0, 5),
    urgentes, negativos, valor,
  }
}

// Resumen del Punto de venta. Sirve a los DOS tipos de cliente: al que tiene
// Contabilidad (para quien esto son sus ventas de mostrador, que además ya entran en
// el gráfico de Contabilidad vía los cierres) y al que solo tiene este módulo, para
// quien es su ÚNICO resumen de ventas en todo Claux.
//
// Sin gráfico a propósito: los datos llegan a golpes —cuando el dispositivo
// sincroniza, no cuando se vende—, así que una serie por días enseñaría huecos que
// parecen días sin ventas y no lo son.
async function resumenPuntoVenta(db: Db, cid: string, hoy: string, empresaIds: string[]): Promise<PuntoVentaResumen> {
  const [cajasRes, tksRes, sesRes] = await Promise.all([
    db.from('cajas').select('caja_id, nombre, last_sync_at')
      .eq('client_id', cid).eq('activa', true).order('nombre'),
    // Ventas de hoy: los ANULADO (rectificados) fuera, igual que en los cierres.
    db.from('caja_tickets').select('caja_id, moneda, total, estado')
      .eq('client_id', cid).in('empresa_id', empresaIds)
      .gte('fecha', `${hoy}T00:00:00`).lte('fecha', `${hoy}T23:59:59`),
    // Turnos abiertos: solo importan los de un día ANTERIOR. Uno abierto hoy es que
    // están vendiendo ahora; uno de ayer es que se olvidaron de cerrar, y sin cierre
    // no hay ingreso en Tesorería ni salida de stock — la contabilidad se queda quieta.
    db.from('caja_sesiones').select('caja_id, abierta_at')
      .eq('client_id', cid).eq('estado', 'ABIERTA').lt('abierta_at', `${hoy}T00:00:00`),
  ])

  const cajas = (cajasRes.data ?? []) as { caja_id: string; nombre: string; last_sync_at: string | null }[]
  const tickets = ((tksRes.data ?? []) as { caja_id: string; moneda: string; total: number; estado?: string }[])
    .filter(t => (t.estado ?? 'VIGENTE') !== 'ANULADO')
  const abiertas = new Map<string, string>()
  for (const s of ((sesRes.data ?? []) as { caja_id: string; abierta_at: string }[])) {
    if (!abiertas.has(s.caja_id)) abiertas.set(s.caja_id, s.abierta_at)
  }

  const sumar = (items: { moneda: string; total: number }[]) => {
    const acc = new Map<string, number>()
    for (const t of items) acc.set(t.moneda, (acc.get(t.moneda) ?? 0) + Number(t.total || 0))
    return [...acc].map(([moneda, total]) => ({ moneda, total })).sort((a, b) => b.total - a.total)
  }

  const puntos = cajas.map(c => {
    const suyos = tickets.filter(t => t.caja_id === c.caja_id)
    return {
      nombre:     c.nombre,
      ventasHoy:  sumar(suyos),
      ultimaSync: c.last_sync_at,
      syncHoy:    Boolean(c.last_sync_at && c.last_sync_at.slice(0, 10) === hoy),
      turnoAbiertoDesde: abiertas.get(c.caja_id) ?? null,
    }
  })

  return {
    ventasHoy:      sumar(tickets),
    sinSincronizar: puntos.filter(p => !p.syncHoy).length,
    puntos,
  }
}

async function resumenRrhh(db: Db, cid: string, hoy: string, empresaIds: string[]): Promise<RrhhResumen> {
  const inicioMes = `${hoy.slice(0, 7)}-01`
  const en30 = sumarDias(hoy, 30)

  const [empRes, nomRes, conRes] = await Promise.all([
    db.from('empleados').select('fecha_alta, fecha_baja').eq('client_id', cid).in('empresa_id', empresaIds),
    // La nómina en borrador es dinero que el negocio ya debe pero que todavía no
    // está en los gastos: hasta confirmarla, el resultado del mes miente.
    db.from('nominas').select('*', { count: 'exact', head: true })
      .eq('client_id', cid).in('empresa_id', empresaIds).eq('estado', 'BORRADOR'),
    // `fecha_fin` NULL = indefinido, y esos no vencen: la query los deja fuera sola.
    db.from('contratos').select('*', { count: 'exact', head: true })
      .eq('client_id', cid).gte('fecha_fin', hoy).lte('fecha_fin', en30),
  ])

  const lista = (empRes.data ?? []) as { fecha_alta: string | null; fecha_baja: string | null }[]
  const activos = lista.filter(e => !e.fecha_baja).length
  const altasMes = lista.filter(e => !e.fecha_baja && e.fecha_alta && String(e.fecha_alta) >= inicioMes).length
  return {
    activos, altasMes,
    nominasBorrador:    nomRes.count ?? 0,
    contratosPorVencer: conRes.count ?? 0,
  }
}

async function resumenAgenda(db: Db, cid: string, hoy: string, tipo: 'reserva' | 'cita'): Promise<AgendaResumen> {
  const hasta = sumarDias(hoy, 6)
  let q = db.from('reservas')
    .select('fecha, hora, personas, estado, nombre_cliente')
    .eq('client_id', cid)
    .in('estado', ESTADOS_AGENDA_ACTIVOS)
    .gte('fecha', hoy).lte('fecha', hasta)
  q = tipo === 'cita' ? q.not('recurso_id', 'is', null) : q.is('recurso_id', null)
  const { data } = await q

  const filas = ((data ?? []) as { fecha: string; hora: string | null; personas: number | null; estado: string; nombre_cliente: string | null }[])
    .map(r => ({ fecha: String(r.fecha), hora: r.hora ? String(r.hora).slice(0, 5) : null, personas: Number(r.personas) || (tipo === 'cita' ? 1 : 0), estado: r.estado, nombre: r.nombre_cliente ?? '—' }))
    .sort((a, b) => (a.fecha + (a.hora ?? '')).localeCompare(b.fecha + (b.hora ?? '')))

  const deHoy = filas.filter(r => r.fecha === hoy)
  const ahora = ahoraEnTz().slice(0, 5)
  const proximaRow = filas.find(r => r.fecha > hoy || (r.fecha === hoy && (r.hora ?? '99:99') >= ahora)) ?? null

  // Serie de carga próximos 7 días
  const serie7 = Array.from({ length: 7 }, (_, i) => {
    const f = sumarDias(hoy, i)
    return { fecha: f, etiqueta: etiquetaDia(f), total: filas.filter(r => r.fecha === f).length }
  })

  return {
    hoyCount: deHoy.length,
    personasHoy: deHoy.reduce((s, r) => s + r.personas, 0),
    proxima: proximaRow ? { fecha: proximaRow.fecha, hora: proximaRow.hora, nombre: proximaRow.nombre } : null,
    hoyLista: deHoy.map(r => ({ hora: r.hora, nombre: r.nombre, personas: r.personas, estado: r.estado })),
    serie7,
  }
}

/* Checklist de onboarding EN PAUSA (no convence de momento). Para reactivarlo:
   volver a añadir la llamada al Promise.all del loader y descomentar la sección en
   DashboardView.tsx.
// Pasos fundamentales de puesta en marcha, según los módulos contratados. Cuenta
// solo lo que cada módulo necesita (evita queries de módulos no contratados). El
// paso "empresa" y la letra de facturación salen de `empresas` (ya cargadas), sin
// query extra. Los conteos usan head:true (baratos: no traen filas).
async function resumenOnboarding(
  db: Db, cid: string, modulos: string[],
  empresas: { estado: string; letra_facturacion?: string | null }[],
): Promise<OnboardingPaso[]> {
  const tiene = (m: string) => modulos.includes(m)
  const contar = async (tabla: string, filtrar: (q: Db) => Db): Promise<number> => {
    const { count } = await filtrar(db.from(tabla).select('*', { count: 'exact', head: true }).eq('client_id', cid))
    return count ?? 0
  }
  const necesitaMoneda = tiene('base') || tiene('rrhh') || tiene('catalogo_qr')

  const [monedas, almacenes, productos, franjas, servicios, recursos, catalogo] = await Promise.all([
    necesitaMoneda        ? contar('monedas', q => q.eq('activa', true)) : Promise.resolve(1),
    tiene('inventario')   ? contar('almacenes', q => q)                  : Promise.resolve(1),
    tiene('inventario')   ? contar('products', q => q)                   : Promise.resolve(1),
    tiene('reservas_citas') ? contar('reserva_franjas', q => q)          : Promise.resolve(1),
    tiene('agenda')       ? contar('servicios', q => q)                  : Promise.resolve(1),
    tiene('agenda')       ? contar('recursos', q => q)                   : Promise.resolve(1),
    tiene('catalogo_qr')  ? contar('catalogo_items', q => q)             : Promise.resolve(1),
  ])

  const pasos: OnboardingPaso[] = [
    { clave: 'empresa', label: 'Crea tu empresa', hecho: empresas.length > 0, href: '/portal/empresas' },
  ]
  if (necesitaMoneda)  pasos.push({ clave: 'moneda',   label: 'Configura una moneda',        hecho: monedas > 0,   href: '/portal/monedas' })
  if (tiene('base'))   pasos.push({ clave: 'letra',    label: 'Asigna letra de facturación', hecho: empresas.some(e => !!e.letra_facturacion), href: '/portal/empresas' })
  if (tiene('inventario')) {
    pasos.push({ clave: 'almacen',  label: 'Crea un almacén', hecho: almacenes > 0, href: '/portal/almacenes' })
    pasos.push({ clave: 'producto', label: 'Añade un producto', hecho: productos > 0, href: '/portal/productos' })
  }
  if (tiene('reservas_citas')) pasos.push({ clave: 'franja', label: 'Crea una franja de reservas', hecho: franjas > 0, href: '/portal/reservas' })
  if (tiene('agenda')) {
    pasos.push({ clave: 'servicio', label: 'Añade un servicio',    hecho: servicios > 0, href: '/portal/citas' })
    pasos.push({ clave: 'recurso',  label: 'Añade un profesional', hecho: recursos > 0,  href: '/portal/citas' })
  }
  if (tiene('catalogo_qr')) pasos.push({ clave: 'catalogo', label: 'Añade un ítem al catálogo', hecho: catalogo > 0, href: '/portal/catalogo' })
  return pasos
}
*/

/** Un dossier publicado con el snapshot más viejo que esto enseña números rancios. */
const DIAS_DOSSIER_RANCIO = 45

/**
 * Estado del dossier. Una sola query a la cabecera: el widget no pinta cifras
 * del negocio (para eso está Reportes), solo si el documento está listo y al día.
 *
 * `desfasados` usa el MISMO criterio que el aviso `dossier_snapshot_desactualizado`
 * del cron (`lib/notificaciones/escaneres.ts`): `snapshot_stale` o más de 45 días.
 * Si el dashboard y la campana usaran umbrales distintos, el dueño vería un aviso
 * rojo con el widget en verde y dejaría de creerse a los dos.
 */
async function resumenDossier(db: Db, cid: string): Promise<DossierResumen> {
  const { data } = await db.from('dossiers')
    .select('titulo, estado, snapshot_at, snapshot_stale')
    .eq('client_id', cid)
    .order('created_at', { ascending: true })

  const filas = (data ?? []) as { titulo: string | null; estado: string; snapshot_at: string | null; snapshot_stale: boolean }[]

  let publicados = 0, desfasados = 0
  let ultimoSnapshot: string | null = null

  for (const d of filas) {
    if (d.snapshot_at && (!ultimoSnapshot || d.snapshot_at > ultimoSnapshot)) ultimoSnapshot = d.snapshot_at
    if (d.estado !== 'PUBLICADO') continue
    publicados++
    const dias = d.snapshot_at
      ? Math.round((Date.now() - new Date(d.snapshot_at).getTime()) / 86_400_000)
      : null
    // Solo cuenta lo PUBLICADO: un borrador con números viejos no lo ve nadie.
    if (d.snapshot_stale === true || (dias !== null && dias > DIAS_DOSSIER_RANCIO)) desfasados++
  }

  return {
    total: filas.length,
    publicados,
    desfasados,
    ultimoSnapshot,
    titulo: filas.length === 1 ? (filas[0].titulo ?? null) : null,
    vacio: filas.length === 0,
  }
}

async function resumenServicios(db: Db, cid: string, hoy: string): Promise<ServiciosResumen> {
  // El mes en curso, para el movimiento del MRR (altas − bajas).
  const mes = hoy.slice(0, 7)
  const [{ data }, { data: lins }, { data: terc }, { count: altasMes }, { count: bajasMes }] = await Promise.all([
    db.from('suscripciones')
      .select('suscripcion_id, cliente_id, moneda, periodicidad, fecha_proximo_cobro, estado, fecha_fin, renovacion_automatica')
      .eq('client_id', cid).eq('estado', 'ACTIVA'),
    db.from('suscripcion_lineas').select('suscripcion_id, precio_mensual, descuento_modo, descuento_valor').eq('client_id', cid),
    db.from('third_parties').select('tercero_id, nombre').eq('client_id', cid),
    db.from('suscripciones').select('suscripcion_id', { count: 'exact', head: true })
      .eq('client_id', cid).gte('fecha_inicio', `${mes}-01`).lte('fecha_inicio', hoy),
    db.from('suscripciones').select('suscripcion_id', { count: 'exact', head: true })
      .eq('client_id', cid).gte('cancelada_at', `${mes}-01`),
  ])
  const nombreTercero = new Map(
    ((terc ?? []) as { tercero_id: string; nombre: string }[]).map(t => [t.tercero_id, t.nombre]),
  )

  // Las líneas de cada acuerdo (mig. 124/125): el cobro suma el de cada servicio con su
  // propio descuento.
  const lineasPorSub = new Map<string, { precio_mensual: number; descuento_modo: DescuentoModo; descuento_valor: number }[]>()
  for (const l of (lins ?? []) as { suscripcion_id: string; precio_mensual: number | string; descuento_modo: string; descuento_valor: number | string }[]) {
    const arr = lineasPorSub.get(l.suscripcion_id) ?? []
    arr.push({
      precio_mensual:  Number(l.precio_mensual) || 0,
      descuento_modo:  (l.descuento_modo === 'MONTO_FIJO' ? 'MONTO_FIJO' : 'PORCENTAJE') as DescuentoModo,
      descuento_valor: Number(l.descuento_valor) || 0,
    })
    lineasPorSub.set(l.suscripcion_id, arr)
  }

  // «Vencida» no se guarda, se DERIVA (decisión 12): una de fin fijo que ya pasó sigue
  // en estado ACTIVA en la tabla. Sin derivar aquí, el listado la daba por vencida y el
  // widget la seguía sumando al ingreso recurrente — el mismo negocio con dos cifras
  // distintas, y la del dashboard inflada con dinero que ya no entra.
  const filas = ((data ?? []) as {
    suscripcion_id: string; cliente_id: string | null
    moneda: string; periodicidad: string
    fecha_proximo_cobro: string; estado: string; fecha_fin: string | null; renovacion_automatica: boolean
  }[]).filter(f => estadoEfectivo(
    { estado: f.estado as EstadoSub, fecha_fin: f.fecha_fin, renovacion_automatica: f.renovacion_automatica }, hoy,
  ) === 'ACTIVA')

  const [y, m, d] = hoy.split('-').map(Number)
  const en30 = new Date(Date.UTC(y, m - 1, d + 30)).toISOString().split('T')[0]

  const porMoneda = new Map<string, number>()
  const proximasLista: { nombre: string; fecha: string; moneda: string; importe: number }[] = []
  for (const f of filas) {
    // Con el descuento aplicado: un anual rebajado un 15 % no aporta el precio de
    // catálogo al ingreso recurrente, aporta lo que de verdad se cobra.
    // `total` es lo que se cobra en SU ciclo (un anual cobra 12 meses de golpe);
    // `equivalenteMensual` es ese total repartido, que es lo comparable mes a mes.
    const { equivalenteMensual, total } = calcularCobroAcuerdo(
      lineasPorSub.get(f.suscripcion_id) ?? [], f.periodicidad as PeriodicidadSub,
    )
    porMoneda.set(f.moneda, (porMoneda.get(f.moneda) ?? 0) + equivalenteMensual)
    if (f.fecha_proximo_cobro && f.fecha_proximo_cobro <= en30) {
      proximasLista.push({
        nombre:  (f.cliente_id && nombreTercero.get(f.cliente_id)) || 'Sin cliente',
        fecha:   f.fecha_proximo_cobro,
        moneda:  f.moneda,
        importe: Math.round(total * 100) / 100,
      })
    }
  }
  proximasLista.sort((a, b) => a.fecha.localeCompare(b.fecha))

  // ── Lo que la pantalla no dice (contexto de la IA) ──
  const atrasados = filas.filter(f => f.fecha_proximo_cobro && f.fecha_proximo_cobro < hoy)
  const [y2, m2, d2] = hoy.split('-').map(Number)
  const en60 = new Date(Date.UTC(y2, m2 - 1, d2 + 60)).toISOString().split('T')[0]
  const { count: pausadas } = await db.from('suscripciones')
    .select('suscripcion_id', { count: 'exact', head: true })
    .eq('client_id', cid).eq('estado', 'PAUSADA')

  // Deuda y borradores: de las facturas que cubren suscripciones, no de todas las ventas.
  let borradoresSinEmitir = 0
  const deudaPorMoneda = new Map<string, number>()
  if (filas.length) {
    const historial = await historialPorAcuerdo(db, cid, filas.map(f => f.suscripcion_id))
    const vistas = new Set<string>()
    for (const arr of historial.values()) {
      for (const f of arr) {
        if (vistas.has(f.factura_id)) continue     // una factura puede cubrir varios acuerdos
        vistas.add(f.factura_id)
        if (f.estado === 'BORRADOR') borradoresSinEmitir++
        if (f.saldo > 0.005) deudaPorMoneda.set(f.moneda, (deudaPorMoneda.get(f.moneda) ?? 0) + f.saldo)
      }
    }
  }

  const extra = {
    cobrosAtrasados: atrasados.length,
    atrasoDesde: atrasados.reduce<string | null>(
      (min, f) => (min === null || f.fecha_proximo_cobro < min ? f.fecha_proximo_cobro : min), null),
    borradoresSinEmitir,
    deuda: [...deudaPorMoneda.entries()].map(([moneda, total]) => ({
      moneda, total: Math.round(total * 100) / 100,
    })),
    vencenSinRenovar: filas.filter(f => !f.renovacion_automatica && f.fecha_fin && f.fecha_fin <= en60).length,
    pausadas: pausadas ?? 0,
  }

  return {
    activas: filas.length,
    ingresoRecurrente: [...porMoneda.entries()].map(([moneda, total]) => ({ moneda, total: Math.round(total * 100) / 100 })),
    proximasRenovaciones: proximasLista.length,
    proximas: proximasLista.slice(0, 3),
    altasMes: altasMes ?? 0,
    bajasMes: bajasMes ?? 0,
    ...extra,
  }
}

// ── Loader principal ─────────────────────────────────────────────────────────────

export async function obtenerDashboard(): Promise<DashboardData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const cid = session.client_id
  const hoy = hoyEnTz()

  // El dashboard muestra SOLO lo que este usuario puede ver, no lo que el tenant
  // tiene contratado: módulos por permiso efectivo (mismo cálculo que el sidebar,
  // `calcularAcceso`) y datos acotados a sus empresas (igual que cada página del
  // portal). Así cada widget coincide con lo que encuentra al abrir el módulo.
  const [{ data: cliente }, filasUsuario, empresasAcc] = await Promise.all([
    db.from('clients')
      .select('nombre_empresa, estado, modulos_activos, precio_mensual_usd, ciclo_facturacion, fecha_expiracion')
      .eq('client_id', cid).single(),
    modulosDeUsuario(db, session.user_id),
    obtenerEmpresas(),
  ])
  if (!cliente) return null

  const modulosActivos: string[] = Array.isArray(cliente.modulos_activos) ? cliente.modulos_activos : []
  const { visibles } = calcularAcceso(session, modulosActivos, filasUsuario)
  const puedeVer = (m: string) => visibles.includes(m)

  // Empresas accesibles del usuario. Contabilidad y RRHH acotan sus datos a estas
  // (como reportes.ts/gastos.ts/rrhh.ts); Inventario y Reservas/Citas quedan
  // client-wide, igual que productos.ts/reservas.ts. El '__none__' replica el guard
  // de las páginas: sin empresas asignadas no se filtra a "todo el cliente".
  const empresaIds    = empresasAcc.map(e => e.empresa_id)
  const idsFiltro     = empresaIds.length ? empresaIds : ['__none__']
  const empresasVista = empresasAcc.filter(e => e.estado === 'ACTIVO')

  const [contabilidad, deudas, inventario, puntoVenta, rrhh, reservas, citas, servicios, dossier, catalogo, tasas, etiquetas, descuentoRaw, emailContratacion, catalogoModulos, interesesPrevios] = await Promise.all([
    puedeVer('base')           ? resumenContabilidad(db, cid, hoy, idsFiltro) : Promise.resolve(undefined),
    puedeVer('base')           ? resumenDeudas()                              : Promise.resolve(undefined),
    puedeVer('inventario')     ? resumenInventario(db, cid)                   : Promise.resolve(undefined),
    puedeVer('caja')           ? resumenPuntoVenta(db, cid, hoy, idsFiltro)   : Promise.resolve(undefined),
    puedeVer('rrhh')           ? resumenRrhh(db, cid, hoy, idsFiltro)         : Promise.resolve(undefined),
    puedeVer('reservas_citas') ? resumenAgenda(db, cid, hoy, 'reserva')       : Promise.resolve(undefined),
    puedeVer('agenda')         ? resumenAgenda(db, cid, hoy, 'cita')          : Promise.resolve(undefined),
    puedeVer('servicios')      ? resumenServicios(db, cid, hoy)               : Promise.resolve(undefined),
    puedeVer('dossier')        ? resumenDossier(db, cid)                      : Promise.resolve(undefined),
    puedeVer('catalogo_qr')    ? resumenCatalogo(db, cid)                     : Promise.resolve(undefined),
    // Las tasas acompañan a la contabilidad: es lo que convierte sus totales.
    puedeVer('base')           ? resumenTasas(db, cid, hoy)                   : Promise.resolve(undefined),
    obtenerEtiquetasNegocio(),
    leerSetting('descuento_anual_pct', '10'),
    leerSetting('email_contratacion', 'contacto@claux.es'),
    // Qué ofrecer y en qué orden lo decide el catálogo comercial, no el código.
    db.from('modulos_catalogo').select('clave, tipo, orden').eq('activo', true),
    // Lo que este cliente ya pidió activar. Sin esto, «Te contactamos» vivía solo
    // en el estado del componente y se perdía al recargar: el dueño volvía a ver
    // «Me interesa» y no sabía si su clic había servido de algo.
    db.from('soporte_mensajes')
      .select('modulo_clave, created_at')
      .eq('client_id', cid)
      .not('modulo_clave', 'is', null)
      .order('created_at', { ascending: false }),
  ])
  // Aviso de setup: datos base que solo el admin puede crear. Empresa siempre;
  // moneda solo si hay módulos que la usan (base/rrhh/catálogo/dossier). La query
  // de moneda se hace solo cuando aplica y para admin. (El checklist quedó en pausa.)
  let setupPendiente = { empresa: false, moneda: false }
  if (session.rol === 'admin_empresa') {
    const MODULOS_CON_MONEDA = ['base', 'rrhh', 'catalogo_qr', 'dossier']
    const necesitaMoneda = MODULOS_CON_MONEDA.some(m => modulosActivos.includes(m))
    let sinMoneda = false
    if (necesitaMoneda) {
      const { count } = await db.from('monedas')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', cid).eq('activa', true)
      sinMoneda = !count
    }
    setupPendiente = { empresa: empresasAcc.length === 0, moneda: sinMoneda }
  }

  const descuento = parseInt(descuentoRaw, 10) || 0
  const precioMes = Number(cliente.precio_mensual_usd ?? 0)
  const diasRestantes = cliente.fecha_expiracion
    ? Math.ceil((new Date(cliente.fecha_expiracion).getTime() - Date.now()) / 86_400_000)
    : null

  // La etiqueta del acceso respeta el vocabulario del sector (Menú/Carta en vez
  // de "Catálogo", "Citas" en vez de "Reservas"…). El resto mantiene su nombre.
  const labelAcceso = (c: string): string =>
    c === 'catalogo_qr'    ? etiquetas.catalogo
    : c === 'reservas_citas' ? etiquetas.reservas
    : ACCESOS[c].label
  const accesos: AccesoRapido[] = visibles
    .filter(c => ACCESOS[c])
    .map(c => ({ clave: c, label: labelAcceso(c), ruta: ACCESOS[c].ruta }))

  // ── «Pendiente»: lo accionable de TODOS los módulos, en una franja ──────────
  // Se agrega aquí en vez de que cada widget grite lo suyo: el dueño abre el
  // dashboard para saber si tiene que hacer algo hoy, y esa respuesta estaba
  // repartida entre ocho tarjetas. Un módulo nuevo añade una LÍNEA aquí, no otra
  // tarjeta — que es lo que mantiene el dashboard acotado.
  const pendiente: Pendiente[] = []
  const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios)

  if (deudas) {
    // UNA línea por lado, no una por moneda. Un cliente con tres monedas generaba
    // hasta seis avisos que decían lo mismo dos veces («te deben» y «debes»), y la
    // franja se convertía en un muro donde ya no se distinguía lo importante.
    const vencCobrar = deudas.cobrar.por_moneda.filter(m => m.vencido > 0.005)
    if (vencCobrar.length > 0) {
      pendiente.push({
        clave: 'cobrar', tono: 'alerta', ruta: '/portal/cxc',
        texto: `Te deben ${importesVencidos(vencCobrar)} ${plural(vencCobrar.length, 'vencido', 'vencidos')}`,
      })
    }
    const vencPagar = deudas.pagar.por_moneda.filter(m => m.vencido > 0.005)
    if (vencPagar.length > 0) {
      pendiente.push({
        clave: 'pagar', tono: 'alerta', ruta: '/portal/cxp',
        texto: `Debes ${importesVencidos(vencPagar)} ${plural(vencPagar.length, 'vencido', 'vencidos')}`,
      })
    }
  }
  if (inventario && inventario.bajoMinimoCount > 0) {
    pendiente.push({
      // A los productos que faltan, no a Movimientos: el pendiente tiene que llevar
      // a donde se resuelve.
      clave: 'stock', tono: 'alerta', ruta: '/portal/productos?stock=bajo',
      texto: `${inventario.bajoMinimoCount} ${plural(inventario.bajoMinimoCount, 'producto', 'productos')} bajo mínimo`,
    })
  }
  if (puntoVenta && puntoVenta.sinSincronizar > 0) {
    pendiente.push({
      clave: 'sync', tono: 'aviso', ruta: '/portal/caja/operaciones',
      texto: `${puntoVenta.sinSincronizar} ${plural(puntoVenta.sinSincronizar, 'punto de venta sin sincronizar', 'puntos de venta sin sincronizar')}`,
    })
  }
  if (dossier && dossier.desfasados > 0) {
    pendiente.push({
      clave: 'dossier', tono: 'aviso', ruta: '/portal/dossier',
      texto: `${dossier.desfasados} ${plural(dossier.desfasados, 'dossier publicado con números viejos', 'dossiers publicados con números viejos')}`,
    })
  }
  if (rrhh && rrhh.nominasBorrador > 0) {
    pendiente.push({
      clave: 'nomina', tono: 'alerta', ruta: '/portal/nomina',
      texto: `${rrhh.nominasBorrador} ${plural(rrhh.nominasBorrador, 'nómina sin confirmar', 'nóminas sin confirmar')}`,
    })
  }
  if (rrhh && rrhh.contratosPorVencer > 0) {
    pendiente.push({
      clave: 'contratos', tono: 'aviso', ruta: '/portal/rrhh',
      texto: `${rrhh.contratosPorVencer} ${plural(rrhh.contratosPorVencer, 'contrato termina', 'contratos terminan')} en 30 días`,
    })
  }
  if (catalogo && !catalogo.vacio) {
    // Lo que estropea la carta de cara al cliente final. Los agotados no entran:
    // marcar algo agotado es una decisión del dueño, no un descuido.
    const flojos = catalogo.sinFoto + catalogo.sinPrecio
    if (flojos > 0) {
      const partes: string[] = []
      if (catalogo.sinFoto > 0)   partes.push(`${catalogo.sinFoto} sin foto`)
      if (catalogo.sinPrecio > 0) partes.push(`${catalogo.sinPrecio} sin precio`)
      pendiente.push({
        clave: 'catalogo', tono: 'aviso', ruta: '/portal/catalogo',
        texto: `En tu ${etiquetas.catalogo.toLowerCase()}: ${partes.join(' y ')}`,
      })
    }
  }
  if (servicios && servicios.proximasRenovaciones > 0) {
    pendiente.push({
      clave: 'renovaciones', tono: 'aviso', ruta: '/portal/suscripciones',
      texto: `${servicios.proximasRenovaciones} ${plural(servicios.proximasRenovaciones, 'suscripción renueva', 'suscripciones renuevan')} en 30 días`,
    })
  }
  // Lo que duele primero.
  pendiente.sort((a, b) => (a.tono === b.tono ? 0 : a.tono === 'alerta' ? -1 : 1))

  // ── Captación ───────────────────────────────────────────────────────────────
  const conPanel = MODULOS_CON_PANEL.filter(m => visibles.includes(m)).length
  // Primer pedido de cada módulo por fecha descendente ⇒ el primero que aparece
  // es el más reciente, que es la fecha que se le enseña al dueño.
  const pedidoPorModulo = new Map<string, string>()
  for (const fila of interesesPrevios.data ?? []) {
    const clave = fila.modulo_clave as string
    if (!pedidoPorModulo.has(clave)) pedidoPorModulo.set(clave, fila.created_at as string)
  }
  const faltan: ModuloOferta[] = ordenarOferta(
    OFERTA
      .filter(o => !visibles.includes(o.clave) && (!o.requiere || visibles.includes(o.requiere)))
      .map(o => ({
        ...o,
        // Respeta el vocabulario del sector: «Menú»/«Carta» en vez de «Catálogo».
        label: o.clave === 'catalogo_qr' ? etiquetas.catalogo
             : o.clave === 'reservas_citas' ? etiquetas.reservas
             : o.label,
        pedidoEl: fechaCortaDeISO(pedidoPorModulo.get(o.clave)),
      })),
    (catalogoModulos.data ?? []) as FilaCatalogo[],
  )

  return {
    nombreEmpresa: cliente.nombre_empresa,
    empresas: empresasVista.map(({ empresa_id, nombre, color }) => ({ empresa_id, nombre, color })),
    setupPendiente,
    fecha: hoy,
    etiquetas,
    suscripcion: {
      estado: cliente.estado ?? '—',
      diasRestantes,
      label: suscripcionLabel(precioMes, cliente.ciclo_facturacion ?? 'mensual', descuento),
    },
    tieneIa: puedeVer('asistente_ia'),
    pendiente,
    captacion: { conPanel, faltan, email: emailContratacion },
    contabilidad, deudas, tasas, inventario, puntoVenta, rrhh, servicios, dossier, catalogo, reservas, citas, accesos,
  }
}
