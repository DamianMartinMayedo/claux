// Núcleo server-only del módulo Caja. Construye la SEMILLA (productos/monedas/
// tasas/config) que baja al dispositivo, e INGESTA el lote de tickets+cierres de
// forma idempotente. Compartido por los endpoints públicos tokenizados
// (/punto-de-venta/api/seed y /punto-de-venta/api/sync) y por la subida de archivo del portal
// (ingestarLoteArchivo en actions/portal/caja.ts).
//
// Regla de independencia (CONTEXTO §2): la caja guarda SIEMPRE su propio detalle
// (caja_tickets/caja_ticket_lineas). Los efectos en módulos compartidos son
// RESÚMENES POR CIERRE, y solo si el cliente tiene el módulo:
//   · base       → un INGRESO de Tesorería por moneda (origen='CAJA') **y** un COBRO
//                  resumen en `gastos_cobros` por moneda (origen_tipo='CIERRE_CAJA').
//   · inventario → un SALIDA de Inventario por producto (origen='VENTA', permitir_negativo).
// Idempotencia: ticket_uuid (detalle) y los flags tesoreria_movs/stock_movs del
// cierre (resúmenes). Re-sincronizar o re-subir un archivo no duplica.

import { tieneModulo } from '@/lib/modulos'
import { fechaEnTz, hoyEnTz } from '@/lib/fecha-tz'
import { aplicarMovimiento } from '@/app/actions/portal/_inventario-helpers'
import { ORIGEN_CIERRE_CAJA, generarRegistroId } from '@/lib/gastos-core'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface CajaRow {
  caja_id:           string
  client_id:         string
  empresa_id:        string
  /** Solo para etiquetar los resúmenes: con dos cajas cerrando el mismo día, dos
   *  filas «Ventas de caja» son indistinguibles en Gastos y cobros. */
  nombre?:           string | null
  almacen_id:        string | null
  cuentas_moneda:    Record<string, string>
  /** Moneda → cuenta donde entra lo cobrado por TRANSFERENCIA (mig. 172). Vacío = a la de
   *  efectivo, que es como se comportaba el sistema entero hasta ahora. */
  cuentas_transferencia?: Record<string, string> | null
  monedas_aceptadas: string[]
  /** Qué baja al dispositivo: PRODUCTO | SERVICIO | AMBOS (mig. 120). */
  tipos_catalogo?:   string | null
  activa?:           boolean
}

export interface LineaIn {
  producto_id?:    string | null
  descripcion:     string
  cantidad:        number
  precio_unitario: number
  // NETO de la línea (cantidad × precio − descuento de línea). Es lo que suma la guardia
  // de más abajo, así que el descuento de línea NUNCA es una deducción aparte.
  subtotal:        number
  // Par calcado de `documento_lineas` (mig. 015), con el modo derivado: pct > 0 ⇒
  // porcentaje, si no monto fijo. Opcionales porque un dispositivo con la versión vieja
  // instalada sigue enviando líneas sin ellos.
  descuento_pct?:     number
  descuento_importe?: number
}
export interface TicketIn {
  ticket_uuid:  string
  sesion_uuid?: string | null
  fecha:        string
  moneda:       string
  total:        number
  // Lo que habría costado sin ningún descuento. Si no viene (dispositivo viejo) se deduce
  // de las líneas: nunca se guarda 0, que en el listado se leería como avería.
  bruto?:             number
  descuento_pct?:     number
  descuento_importe?: number
  // Lo que se puso en el mostrador y lo que se devolvió, cada uno con su moneda (mig. 209).
  // Ausentes = pagó justo en la moneda de la venta, que es el caso de siempre.
  cobrado_moneda?:  string | null
  cobrado_importe?: number | null
  cambio_moneda?:   string | null
  cambio_importe?:  number | null
  medio_pago?:  string | null
  estado?:      'VIGENTE' | 'ANULADO' | 'RECTIFICACION'
  rectifica_a?: string | null   // ticket_uuid del original (solo en RECTIFICACION)
  lineas:       LineaIn[]
}
export interface CierreIn {
  sesion_uuid:       string
  abierta_at:        string
  cerrada_at?:       string | null
  estado?:           string
  fondo_inicial?:    Record<string, number>
  efectivo_contado?: Record<string, number>
  /** Quién contó el dinero. NOMBRE congelado: si el cajero se renombra o se da de
   *  baja, el turno cerrado tiene que seguir diciendo quién lo cerró. */
  cerrada_por?:      string | null
  cerrada_por_id?:   string | null
  /** Y quién lo abrió (mig. 208). Mismo par id + nombre congelado. */
  abierta_por?:      string | null
  abierta_por_id?:   string | null
}
/** Salidas y entradas de efectivo DURANTE el turno: la otra mitad del arqueo. */
export interface MovimientoTurnoIn {
  movimiento_uuid: string
  sesion_uuid:     string
  tipo:            'SALIDA' | 'ENTRADA'
  moneda:          string
  importe:         number
  motivo?:         string | null
  fecha:           string
}
// `caja` lo escribe el export de la PWA: identifica de qué punto de venta salió el
// archivo. Es opcional porque un export viejo no lo trae, pero cuando viene manda.
export interface LotePayload {
  caja?: string | null
  tickets?: TicketIn[]
  cierres?: CierreIn[]
  movimientos?: MovimientoTurnoIn[]
}

export interface IngestaResultado {
  tickets_nuevos:    number
  cierres_posteados: number
  duplicados:        number
  errores:           string[]
  /**
   * LOS UUID QUE EL SERVIDOR NO ACEPTÓ. Sin esta lista se perdía dinero, en silencio.
   *
   * La ingesta no lanza: un ticket que falla —moneda que el punto ya no acepta, fecha
   * fuera de rango, cualquier error de la base— se apunta en `errores` y el bucle sigue,
   * para que un ticket malo no tumbe el lote entero. Pero la ruta devolvía `ok: true`
   * pasara lo que pasara, y el dispositivo, al ver el `ok`, marcaba como sincronizados
   * **todos los que había mandado**. Resultado: la venta rechazada desaparecía de la cola
   * del móvil y no existía en Claux — sin rastro en ningún sitio y con la caja diciendo
   * «Todo sincronizado».
   *
   * Con esto el dispositivo marca solo lo aceptado y lo demás **se queda pendiente** y se
   * reintenta. Es la misma idea que ya rige en el módulo: el estado se deduce de los
   * datos reales, nunca de un flag optimista.
   */
  rechazados:        string[]
  /**
   * POR QUÉ se rechazó, en las dos únicas categorías que cambian lo que hay que hacer:
   *
   * · `CONEXION` — el servidor no pudo hablar con la base (`fetch failed`, timeout, socket
   *   caído). No hay nada roto y no hay nada que revisar: el siguiente intento entra.
   * · `DATOS`    — la venta no encaja (moneda que el punto no acepta, fecha imposible, una
   *   restricción de la base). Esto no se arregla solo; hay que tocar la configuración.
   *
   * Sin esta distinción, un parpadeo de red le decía al cajero «no se pudo registrar, hay
   * algo mal configurado» y le enseñaba un `TypeError: fetch failed` con un uuid dentro.
   * Los textos de `errores` son para el DUEÑO en el portal, nunca para el mostrador.
   */
  rechazo_motivo:    'CONEXION' | 'DATOS' | null
}

/** Un fallo de transporte, no de contenido: se resuelve reintentando, sin tocar nada. */
function esFalloDeRed(msg: string): boolean {
  return /fetch failed|network|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket|EAI_AGAIN/i.test(msg)
}

/** Dos decimales, como el resto del módulo: partir un total en dos destinos no puede
 *  dejar céntimos flotando por el redondeo binario. */
function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

function generarMovId(): string {
  return `MOV-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

/** Token de la caja: cabecera x-caja-token o query ?t= (el fragmento no viaja al servidor). */
export function getCajaToken(req: Request): string | null {
  const h = req.headers.get('x-caja-token')
  if (h) return h.trim()
  const q = new URL(req.url).searchParams.get('t')
  return q ? q.trim() : null
}

// ── SEMILLA (Claux → dispositivo) ─────────────────────────────────────────────

interface OpLink   { operador_id: string }
interface Operador { operador_id: string; nombre: string }

/**
 * Las filas de una consulta de la semilla, **dejando dicho si falló**.
 *
 * Todas usaban `?? []`, así que un error de PostgREST no reventaba nada: el aparato
 * recibía una lista VACÍA y nadie se enteraba. Así se perdieron los operadores durante
 * una versión entera (un embed sin FOREIGN KEY), y el mismo `?? []` habría mandado un
 * catálogo vacío al mostrador con la misma cara de normalidad. Se mantiene la tolerancia
 * —una semilla a medias es mejor que ninguna delante de una cola— pero el fallo queda en
 * el log del servidor en vez de desaparecer.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filas(res: any, que: string): any[] {
  if (res?.error) console.error(`[caja/semilla] ${que}: ${res.error.message ?? res.error}`)
  return res?.data ?? []
}

export async function construirSeed(db: Db, caja: CajaRow) {
  const { data: cli } = await db.from('clients').select('modulos_activos').eq('client_id', caja.client_id).maybeSingle()
  const tieneBase = tieneModulo(cli?.modulos_activos, 'base')

  // Qué baja al dispositivo (mig. 120). Lo decide SOLO el ajuste del dueño
  // (`cajas.tipos_catalogo`), que para eso está: lo que esté catalogado y activo del
  // tipo que pidió, baja. Ni los PRODUCTO piden `inventario` ni los SERVICIO piden
  // `servicios` — el módulo Caja cataloga los dos tipos en /portal/caja/productos
  // (`modoCatalogoMostrador`), así que exigir el módulo dejaba la rejilla VACÍA a quien
  // sí había cargado su catálogo: la peluquería con solo Caja cobraba el champú y el
  // corte no le aparecía por ningún sitio.
  const tipos = caja.tipos_catalogo ?? 'PRODUCTO'
  const tiposPermitidos: string[] = []
  if (tipos !== 'SERVICIO') tiposPermitidos.push('PRODUCTO')
  if (tipos !== 'PRODUCTO') tiposPermitidos.push('SERVICIO')

  // Al dispositivo solo bajan las monedas que además tienen su caja de Tesorería
  // asignada, aunque en la configuración estén marcadas. Cobrar en una moneda sin
  // cuenta produce una venta que el cierre NO puede contabilizar: mejor no ofrecerla
  // que aceptar dinero que luego no aparece en ningún sitio. Sin el módulo de
  // Contabilidad no hay cuentas que mapear, así que ahí no se filtra nada.
  const aceptadas = caja.monedas_aceptadas ?? []
  const monedasCaja = tieneBase
    ? aceptadas.filter(m => Boolean(caja.cuentas_moneda?.[m]))
    : aceptadas
  // Y se dice CUÁLES se quedaron fuera. Retirarlas en silencio tenía un agujero: cuando
  // se retiran TODAS, el dispositivo enseña su pantalla de «Sin monedas para cobrar» con
  // la instrucción; cuando se retira solo alguna, no pasaba nada — el selector de moneda
  // simplemente desaparecía al llegar la semilla, delante del vendedor, sin una palabra.
  // Con la lista, el aparato puede enseñar la moneda tachada y decir qué falta en Claux.
  const monedasSinCuenta = aceptadas.filter(m => !monedasCaja.includes(m))

  const [prodRes, monRes, tasaRes, opLinkRes, opRes, dtoRes] = await Promise.all([
    tiposPermitidos.length > 0
      ? db.from('products')
          .select('producto_id, codigo, nombre, precios, unidad, tipo, es_suscribible')
          .eq('client_id', caja.client_id).eq('estado', 'ACTIVO')
          .in('tipo', tiposPermitidos).order('nombre')
      : Promise.resolve({ data: [] }),
    db.from('monedas').select('codigo, simbolo').eq('client_id', caja.client_id).eq('activa', true).order('codigo'),
    db.from('tasas_cambio')
      .select('moneda_origen, moneda_destino, tasa, fecha')
      .eq('client_id', caja.client_id).order('fecha', { ascending: false }),
    // Los operadores de ESTA caja, no los del cliente: el mostrador de arriba no
    // enseña a los cajeros del de abajo. Baja la lista para que abrir y cerrar el
    // turno sea ELEGIR, no teclear — un campo de texto obligatorio en un mostrador
    // con cola se rellena con «x», y entonces no sirve para ningún informe.
    //
    // DOS consultas y el cruce en JS, no un `caja_operadores!inner(...)`: el embed de
    // PostgREST necesita una FOREIGN KEY declarada y la mig. 208 no la puso, así que la
    // petición fallaba con «could not find a relationship» y el `?? []` de abajo la
    // convertía en «esta caja no tiene cajeros» — el dueño ligaba dos trabajadores en el
    // portal y el desplegable del mostrador no aparecía nunca. La mig. 211 añade la FK,
    // pero la semilla ya no depende de que PostgREST deduzca nada.
    db.from('caja_operadores_cajas').select('operador_id').eq('caja_id', caja.caja_id),
    // Sin filtrar por `empresa_id`: la que manda es la LIGADURA a esta caja. Filtrar
    // además por la empresa haría desaparecer cajeros en silencio el día que una caja
    // cambie de empresa, que es la clase de fallo que acabamos de pagar.
    db.from('caja_operadores').select('operador_id, nombre')
      .eq('client_id', caja.client_id).eq('activo', true),
    // Campañas (mig. 210). Bajan como REGLA CON SU VENTANA, no como precio ya
    // calculado: la caja sincroniza solo al cerrar turno, así que un «hoy este
    // libro vale 450» resuelto aquí llegaría caducado al dispositivo que no ha
    // vuelto a sembrar. Se filtra por fecha lo que YA no puede volver a valer
    // (`hasta` pasado) para no cargar el aparato con campañas muertas, pero
    // NUNCA por el día de la semana: el móvil se lleva el martes puesto y lo
    // evalúa cada vez que se cobra.
    db.from('caja_descuentos')
      .select('nombre, pct, ambito, ambito_id, desde, hasta, dias_semana, caja_id')
      .eq('client_id', caja.client_id).eq('empresa_id', caja.empresa_id)
      .eq('activo', true)
      .or(`caja_id.is.null,caja_id.eq.${caja.caja_id}`),
  ])

  // «Hoy» en la zona del NEGOCIO: con UTC, a partir de las 20:00 en Cuba ya es mañana
  // y una campaña que termina hoy se caería de la semilla medio día antes de tiempo.
  const hoy = hoyEnTz()

  // Quién puede llevar esta caja: los ligados a ella, ya filtrados por activo en la BD.
  const ligados = new Set(filas(opLinkRes, 'operadores ligados a la caja').map((r: OpLink) => r.operador_id))

  // Tasa más reciente por par (primera al venir ordenado por fecha desc).
  const seen = new Set<string>()
  const tasas: { origen: string; destino: string; tasa: number }[] = []
  for (const t of filas(tasaRes, 'tasas de cambio')) {
    const k = `${t.moneda_origen}__${t.moneda_destino}`
    if (seen.has(k)) continue
    seen.add(k)
    tasas.push({ origen: t.moneda_origen, destino: t.moneda_destino, tasa: Number(t.tasa) })
  }

  return {
    caja: {
      caja_id:           caja.caja_id,
      empresa_id:        caja.empresa_id,
      almacen_id:        caja.almacen_id,
      monedas_aceptadas: monedasCaja,
      monedas_sin_cuenta: monedasSinCuenta,
      // El dispositivo no puede deducirlo: sin esto, quedarse sin monedas le pedía
      // «asigna la caja de Tesorería» a un cliente que no tiene Contabilidad y por
      // tanto no tiene ninguna cuenta que asignar.
      tiene_base:        tieneBase,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    productos: filas(prodRes, 'productos').map((p: any) => ({
      producto_id: p.producto_id, codigo: p.codigo, nombre: p.nombre,
      precios: p.precios ?? {}, unidad: p.unidad,
      // El dispositivo necesita el tipo para separar mostrador y servicios: mezclados en
      // la misma rejilla, el corte de pelo se pierde entre los champús.
      tipo: p.tipo ?? 'PRODUCTO',
      // **La misma venta contada dos veces.** Un servicio que ya se factura por
      // suscripción y además se cobra en el mostrador entra DOS veces en el estado de
      // resultados: el cierre de caja escribe su fila COBRO (mig. 149) y la factura
      // emitida cuenta como Ventas. Baja marcado —no se esconde: cobrarlo en caja puede
      // ser lo correcto (un extra, un cliente sin acuerdo)— para que se pueda avisar.
      es_suscribible: p.es_suscribible === true,
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    monedas: filas(monRes, 'monedas').map((m: any) => ({ codigo: m.codigo, simbolo: m.simbolo || m.codigo })),
    tasas,
    // La campaña viaja entera —ventana incluida— y el dispositivo la resuelve
    // contra su reloj. El nombre baja porque es lo único que después distingue
    // «Semana del libro» de un descuento que puso el cajero a ojo.
    // Lo ya vencido se queda en el servidor: no es un filtro de negocio (el aparato
    // vuelve a comprobar la ventana en cada venta), es no cargar el móvil con campañas
    // que ya no pueden volver a valer. Un solo `.or()` en la consulta y la fecha aquí:
    // dos `.or()` encadenados en PostgREST no está claro que se combinen con Y.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    descuentos: filas(dtoRes, 'campañas').filter((d: any) => !d.hasta || d.hasta >= hoy).map((d: any) => ({
      nombre: d.nombre, pct: Number(d.pct),
      ambito: d.ambito as 'TODO' | 'PRODUCTO', ambito_id: d.ambito_id ?? null,
      desde: d.desde ?? null, hasta: d.hasta ?? null,
      dias_semana: (d.dias_semana ?? []) as number[],
    })),
    operadores: filas(opRes, 'operadores del cliente')
      .filter((o: Operador) => ligados.has(o.operador_id))
      .map((o: Operador) => ({ operador_id: o.operador_id, nombre: o.nombre }))
      .sort((a: Operador, b: Operador) => a.nombre.localeCompare(b.nombre, 'es')),
  }
}

// ── INGESTA (dispositivo → Claux) ─────────────────────────────────────────────

export async function ingestarLote(
  db: Db, caja: CajaRow, payload: LotePayload, origenSync: 'ONLINE' | 'ARCHIVO',
): Promise<IngestaResultado> {
  const res: IngestaResultado = {
    tickets_nuevos: 0, cierres_posteados: 0, duplicados: 0,
    errores: [], rechazados: [], rechazo_motivo: null,
  }
  // Rechazar = apuntar el motivo Y el uuid. Van juntos en una función para que no se pueda
  // hacer lo uno sin lo otro: el `errores.push` suelto es lo que dejaba al dispositivo
  // creyendo que el ticket había entrado.
  //
  // `DATOS` gana sobre `CONEXION`: si en el mismo lote hay un parpadeo de red y una venta
  // que de verdad no encaja, lo que hay que contar es lo segundo — es lo único que pide
  // que alguien haga algo.
  const rechazar = (uuid: string | null | undefined, motivo: string) => {
    res.errores.push(motivo)
    if (uuid) res.rechazados.push(uuid)
    const tipo = esFalloDeRed(motivo) ? 'CONEXION' : 'DATOS'
    if (res.rechazo_motivo !== 'DATOS') res.rechazo_motivo = tipo
  }

  const { data: cli } = await db.from('clients').select('modulos_activos').eq('client_id', caja.client_id).maybeSingle()
  const tieneBase = tieneModulo(cli?.modulos_activos, 'base')
  const tieneInv  = tieneModulo(cli?.modulos_activos, 'inventario')

  const tickets = Array.isArray(payload.tickets) ? payload.tickets : []
  const cierres = Array.isArray(payload.cierres) ? payload.cierres : []

  // ── A. Detalle: tickets (idempotente por ticket_uuid) ──
  //
  // Lo que llega del dispositivo se comprueba antes de escribirlo. No es desconfianza del
  // cajero: el token es de la CAJA, viaja por WhatsApp y cualquiera que lo tenga puede
  // llamar al endpoint. Los tres controles cuestan nada y evitan que la contabilidad se
  // trague un total que no cuadra con sus líneas, una moneda que este punto no acepta o un
  // ticket fechado en un período ya cerrado.
  const aceptadas = new Set(caja.monedas_aceptadas ?? [])
  const ahoraMs   = Date.now()
  const HACE_2A   = ahoraMs - 2 * 365 * 86_400_000
  const EN_1D     = ahoraMs + 86_400_000

  for (const t of tickets) {
    if (!t?.ticket_uuid || !t.fecha || !t.moneda) { rechazar(t?.ticket_uuid, 'ticket inválido (faltan campos)'); continue }
    if (aceptadas.size > 0 && !aceptadas.has(t.moneda)) {
      rechazar(t.ticket_uuid, `ticket ${t.ticket_uuid}: moneda ${t.moneda}, que este punto de venta no acepta`)
      continue
    }
    // La misma guardia para la moneda del PAGO y la del VUELTO. Las monedas aceptadas ya
    // vienen filtradas a las que tienen cuenta de Tesorería (`construirSeed`), justo para
    // no admitir dinero que el cierre no puede contabilizar; dejar entrar un vuelto en una
    // moneda sin cuenta recrearía ese mismo agujero por la otra puerta.
    const monedaMala = [t.cobrado_moneda, t.cambio_moneda]
      .find(m => m && aceptadas.size > 0 && !aceptadas.has(m))
    if (monedaMala) {
      rechazar(t.ticket_uuid, `ticket ${t.ticket_uuid}: cobro o vuelto en ${monedaMala}, que este punto de venta no acepta`)
      continue
    }
    const ms = Date.parse(t.fecha)
    if (!Number.isFinite(ms) || ms < HACE_2A || ms > EN_1D) {
      rechazar(t.ticket_uuid, `ticket ${t.ticket_uuid}: fecha fuera de rango (${t.fecha})`)
      continue
    }
    // El total manda sobre las líneas SOLO si cuadra con ellas: es el número que acaba en
    // Tesorería, y aceptarlo a ciegas es dejar que el dispositivo escriba el ingreso que
    // quiera. Si no cuadra se guarda el de las líneas y se deja dicho.
    //
    // Con descuento de TICKET la cuenta ya no es «suma = total»: el descuento general se
    // resta DESPUÉS de las líneas (las líneas siguen valiendo lo suyo). La comprobación
    // pasa a ser `Σ subtotal − descuento_ticket ≈ total`; si se hubiera dejado la vieja,
    // cualquier venta con descuento general se rechazaría y se quedaría dando vueltas en
    // la cola del móvil para siempre.
    const lineasT = Array.isArray(t.lineas) ? t.lineas : []
    const suma    = round2(lineasT.reduce((s, l) => s + (Number(l.subtotal) || 0), 0))
    // Topado a la suma de líneas: un descuento mayor que la venta daría un ingreso
    // negativo en Tesorería. Y nunca negativo, que sería un recargo por la puerta de atrás.
    const dtoTk   = Math.min(Math.max(round2(Number(t.descuento_importe) || 0), 0), suma)
    let total     = round2(Number(t.total) || 0)
    if (lineasT.length > 0 && Math.abs(round2(suma - dtoTk) - total) > 0.01) {
      res.errores.push(`ticket ${t.ticket_uuid}: el total (${total}) no cuadra con sus líneas (${suma}${dtoTk ? ` − ${dtoTk} de descuento` : ''}); se registra ${round2(suma - dtoTk)}`)
      total = round2(suma - dtoTk)
    }
    // El bruto es la suma de lo que valían las líneas ANTES de su propio descuento. Se
    // recalcula aquí en vez de fiarse del que manda el dispositivo por lo mismo que el
    // total: es el número contra el que el dueño juzga lo que se regaló.
    const brutoLineas = round2(lineasT.reduce(
      (s, l) => s + (Number(l.subtotal) || 0) + Math.max(Number(l.descuento_importe) || 0, 0), 0))
    const bruto = brutoLineas > 0 ? brutoLineas : round2(Number(t.bruto) || total)

    const { data: nuevo, error } = await db.from('caja_tickets').upsert({
      ticket_uuid: t.ticket_uuid,
      caja_id:     caja.caja_id,
      client_id:   caja.client_id,
      empresa_id:  caja.empresa_id,
      sesion_uuid: t.sesion_uuid ?? null,
      fecha:       t.fecha,
      moneda:      t.moneda,
      total,
      bruto,
      descuento_pct:     Math.max(Number(t.descuento_pct) || 0, 0),
      descuento_importe: dtoTk,
      // Se guardan tal cual llegan, sin aritmética entre monedas: es la decisión de fondo
      // de la mig. 209 —el sistema registra lo que pasó, no lo recalcula—. Solo se
      // normaliza el «no hubo» a null, para que la fórmula del arqueo pueda distinguir
      // «pagó justo» de «cobró cero».
      cobrado_moneda:  t.cobrado_moneda ?? null,
      cobrado_importe: Number(t.cobrado_importe) > 0 ? round2(Number(t.cobrado_importe)) : null,
      cambio_moneda:   t.cambio_moneda ?? null,
      cambio_importe:  Number(t.cambio_importe)  > 0 ? round2(Number(t.cambio_importe))  : null,
      medio_pago:  t.medio_pago ?? null,
      estado:      t.estado ?? 'VIGENTE',
      rectifica_a: t.rectifica_a ?? null,
      origen_sync: origenSync,
    }, { onConflict: 'ticket_uuid', ignoreDuplicates: true }).select('ticket_uuid')

    if (error)                      { rechazar(t.ticket_uuid, `ticket ${t.ticket_uuid}: ${error.message}`); continue }
    if (!nuevo || nuevo.length === 0) {
      // Ya existía. Si vuelve como ANULADO (se rectificó un ticket ya sincronizado),
      // propagamos solo el cambio de estado; las líneas no se re-insertan.
      res.duplicados++
      if ((t.estado ?? 'VIGENTE') === 'ANULADO') {
        await db.from('caja_tickets')
          .update({ estado: 'ANULADO', rectifica_a: t.rectifica_a ?? null })
          .eq('ticket_uuid', t.ticket_uuid).eq('client_id', caja.client_id)
      }
      continue
    }
    res.tickets_nuevos++

    if (lineasT.length) {
      const { error: lErr } = await db.from('caja_ticket_lineas').insert(lineasT.map(l => ({
        ticket_uuid:     t.ticket_uuid,
        client_id:       caja.client_id,
        producto_id:     l.producto_id ?? null,
        descripcion:     l.descripcion ?? '',
        cantidad:        Number(l.cantidad) || 0,
        precio_unitario: Number(l.precio_unitario) || 0,
        subtotal:        Number(l.subtotal) || 0,
        descuento_pct:     Math.max(Number(l.descuento_pct) || 0, 0),
        descuento_importe: Math.max(Number(l.descuento_importe) || 0, 0),
      })))
      // NO se rechaza el ticket: su cabecera —con el total, que es lo que llega a
      // Tesorería— sí entró, así que el dinero está bien registrado y solo falta el
      // detalle. Devolverlo como rechazado provocaría un reenvío eterno que además nunca
      // arreglaría las líneas: al reenviarlo, el `ignoreDuplicates` de la cabecera lo
      // manda por la rama de duplicado y las líneas no se vuelven a intentar. Queda como
      // error visible, que es lo que es.
      if (lErr) res.errores.push(`líneas ${t.ticket_uuid}: ${lErr.message}`)
    }
  }

  // ── A bis. Movimientos de efectivo del turno (idempotente por movimiento_uuid) ──
  // Van antes que los cierres: el arqueo del cierre los resta del efectivo esperado, así
  // que tienen que estar ya escritos cuando se calcule.
  const movs = Array.isArray(payload.movimientos) ? payload.movimientos : []
  if (movs.length) {
    const { error } = await db.from('caja_turno_movimientos').upsert(
      movs
        .filter(m => m?.movimiento_uuid && m.sesion_uuid && m.moneda)
        .map(m => ({
          movimiento_uuid: m.movimiento_uuid,
          sesion_uuid:     m.sesion_uuid,
          caja_id:         caja.caja_id,
          client_id:       caja.client_id,
          tipo:            m.tipo === 'ENTRADA' ? 'ENTRADA' : 'SALIDA',
          moneda:          m.moneda,
          importe:         Number(m.importe) || 0,
          motivo:          m.motivo ?? null,
          fecha:           m.fecha,
        })),
      { onConflict: 'movimiento_uuid', ignoreDuplicates: true },
    )
    // El upsert es un lote: si falla, no entró NINGUNO, así que se rechazan todos y el
    // dispositivo los conserva. Un movimiento perdido descuadra el arqueo del turno y
    // deja el saldo de la cuenta de caja inflado, igual que si no se hubiera registrado.
    if (error) {
      res.errores.push(`movimientos del turno: ${error.message}`)
      for (const m of movs) if (m?.movimiento_uuid) res.rechazados.push(m.movimiento_uuid)
    }
  }

  // ── B. Resúmenes por cierre (solo CERRADA; idempotente por flags) ──
  for (const c of cierres) {
    if (!c?.sesion_uuid) continue
    try {
      await ensureCierre(db, caja, c)
      if ((c.estado ?? 'CERRADA') !== 'CERRADA') continue
      // El número Z lo pone el servidor, y aquí: es el momento en que un turno pasa a ser
      // un cierre. La RPC toma un lock por caja y es idempotente, así que resincronizar no
      // consume otro número ni deja huecos en la serie —que es justo lo que se audita—.
      await db.rpc('caja_asignar_numero_z', {
        p_client_id: caja.client_id, p_caja_id: caja.caja_id, p_sesion_uuid: c.sesion_uuid,
      })
      const posted = await postearResumenCierre(db, caja, c.sesion_uuid, tieneBase, tieneInv)
      if (posted) res.cierres_posteados++
    } catch (e) {
      // El cierre se queda pendiente en el dispositivo y se reintenta. Reenviarlo es
      // seguro: `ensureCierre` no reabre un turno ya cerrado, la RPC del número Z es
      // idempotente y el posteo pregunta a los movimientos reales, no a un flag.
      rechazar(c.sesion_uuid, `cierre ${c.sesion_uuid}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  await db.from('cajas').update({ last_sync_at: new Date().toISOString() }).eq('caja_id', caja.caja_id)
  return res
}

// Crea/actualiza la fila del cierre (detalle). NO toca los flags de posteo
// (tesoreria_movs/stock_movs/posted_at): se preservan al no incluirlos.
//
// **Un cierre no se REABRE desde el dispositivo.** El dueño puede cerrar y contabilizar un
// turno olvidado desde el portal; si después ese móvil vuelve a mandar su copia —que sigue
// diciendo ABIERTA— reabriría el turno, dejaría `cerrada_at` en null y el cierre ya
// contabilizado pasaría a ser un turno en curso, con su dinero ya en Tesorería. Manda el
// servidor: llegado ABIERTA sobre una sesión ya CERRADA, solo se actualiza el sello de
// sincronización. Al revés sí se acepta (el móvil la cierra de verdad), que es el camino normal.
//
// El `.eq('client_id')` no es decorativo: `sesion_uuid` es la PK GLOBAL de la tabla, así que
// sin él un lote podría reescribir el `caja_id`/`client_id` de la sesión de otro inquilino.
// Hay que acertar un UUID entero, pero el candado cuesta una línea y el camino de ANULADO ya
// lo lleva.
async function ensureCierre(db: Db, caja: CajaRow, c: CierreIn) {
  const { data: previa } = await db.from('caja_sesiones')
    .select('client_id, estado').eq('sesion_uuid', c.sesion_uuid).maybeSingle()

  if (previa && previa.client_id !== caja.client_id) {
    throw new Error('sesión de otro cliente')
  }

  const entrante = c.estado ?? 'CERRADA'
  if (previa?.estado === 'CERRADA' && entrante !== 'CERRADA') {
    await db.from('caja_sesiones')
      .update({ sincronizado_at: new Date().toISOString() })
      .eq('sesion_uuid', c.sesion_uuid).eq('client_id', caja.client_id)
    return
  }

  await db.from('caja_sesiones').upsert({
    sesion_uuid:      c.sesion_uuid,
    caja_id:          caja.caja_id,
    client_id:        caja.client_id,
    empresa_id:       caja.empresa_id,
    abierta_at:       c.abierta_at,
    cerrada_at:       c.cerrada_at ?? null,
    estado:           entrante,
    fondo_inicial:    c.fondo_inicial ?? {},
    efectivo_contado: c.efectivo_contado ?? {},
    // Quién abrió y quién cerró (mig. 208). Se guardan id Y nombre: el id sirve para
    // agrupar por persona; el nombre es la foto del día, y sobrevive al renombrado o
    // a la baja del cajero. Mismo criterio que el `salario_base` congelado de nómina.
    abierta_por:      c.abierta_por ?? null,
    abierta_por_id:   c.abierta_por_id ?? null,
    cerrada_por:      c.cerrada_por ?? null,
    cerrada_por_id:   c.cerrada_por_id ?? null,
    sincronizado_at:  new Date().toISOString(),
  }, { onConflict: 'sesion_uuid' })
}

/**
 * Contabiliza (o REINTENTA contabilizar) un cierre ya sincronizado.
 *
 * Existe porque la promesa que había escrita —«arreglar el mapeo y volver a sincronizar
 * recupera la moneda que faltaba»— **no se podía cumplir**: el dispositivo marca el cierre
 * como enviado y no lo reenvía nunca, así que un cierre con una moneda sin cuenta de
 * Tesorería se quedaba con su badge de «Pendiente» para siempre y sin ninguna salida.
 * Ahora la vuelta la da el portal.
 *
 * Es el MISMO camino que usa la ingesta, no una copia: idempotente, así que pulsarlo dos
 * veces no duplica nada y solo escribe lo que falte.
 */
export async function contabilizarCierre(
  db: Db, caja: CajaRow, sesionUuid: string,
): Promise<boolean> {
  const { data: cli } = await db.from('clients').select('modulos_activos').eq('client_id', caja.client_id).maybeSingle()
  return await postearResumenCierre(
    db, caja, sesionUuid,
    tieneModulo(cli?.modulos_activos, 'base'),
    tieneModulo(cli?.modulos_activos, 'inventario'),
  )
}

// Postea los resúmenes de un cierre a Tesorería/Inventario. Idempotente: solo
// postea cada efecto si su flag está null (no se re-postea al re-sincronizar).
// Devuelve true si aplicó algún resumen.
async function postearResumenCierre(
  db: Db, caja: CajaRow, sesionUuid: string, tieneBase: boolean, tieneInv: boolean,
): Promise<boolean> {
  const { data: ses } = await db.from('caja_sesiones')
    .select('tesoreria_movs, stock_movs, cerrada_at').eq('sesion_uuid', sesionUuid).maybeSingle()
  if (!ses) return false

  // **La fecha del apunte es el día del NEGOCIO, no el de UTC.** Con `split('T')[0]` un
  // turno cerrado a las 21:00 hora de Cuba se contabilizaba el día siguiente —y cerrado el
  // 31 a las 21:00, el MES siguiente—, así que el ingreso de la última noche del mes caía
  // fuera del período que el dueño estaba cerrando. Un restaurante cierra de noche: no era
  // un caso raro, era todos los días.
  const fecha = fechaEnTz(ses.cerrada_at ?? new Date().toISOString())
  let did = false

  // Totales por moneda desde los tickets sincronizados de este cierre. Los ANULADO
  // (rectificados) se excluyen → Tesorería e Inventario reciben el NETO corregido.
  const { data: tks } = await db.from('caja_tickets')
    .select('ticket_uuid, moneda, total, estado, medio_pago, cobrado_moneda, cobrado_importe, cambio_moneda, cambio_importe')
    .eq('sesion_uuid', sesionUuid)
  const vigentes = (tks ?? []).filter((t: { estado?: string }) => (t.estado ?? 'VIGENTE') !== 'ANULADO')
  const ticketUuids = vigentes.map((t: { ticket_uuid: string }) => t.ticket_uuid)

  // ── Dos preguntas distintas que hasta la mig. 209 eran el mismo número ──
  //
  //   INGRESO  (cuánto se VENDIÓ)      → moneda y total del ticket → `gastos_cobros`
  //   EFECTIVO (dónde ESTÁ el dinero)  → cobrado − cambio          → `movimientos_tesoreria`
  //
  // Con una venta en USD cobrada en CUP dejan de coincidir: se vendieron 15 USD y en la
  // gaveta hay 6.000 CUP menos 300 de vuelto. Es el mismo desdoblamiento que el repo ya
  // asumió en la mig. 144 (el gasto y la deuda dejan de ser el mismo número). Mientras
  // nadie use el vuelto cruzado, las dos preguntas dan la misma respuesta y no cambia nada.
  const porMoneda = new Map<string, number>()
  // El efectivo REAL de la gaveta, por moneda de venta y moneda de caja: el ingreso de
  // Tesorería se indexa por la moneda de la VENTA (es la que liquida el cierre y la que
  // mira la pantalla de Cierres para decir si quedó algo pendiente), pero el dinero entra
  // en la cuenta de la moneda en que se recibió.
  const efectivo = new Map<string, Map<string, number>>()
  const sumar = (venta: string, caja: string, imp: number) => {
    const fila = efectivo.get(venta) ?? new Map<string, number>()
    fila.set(caja, round2((fila.get(caja) ?? 0) + imp))
    efectivo.set(venta, fila)
  }
  // Lo cobrado por transferencia no entra en la gaveta, entra en el banco; todo lo demás va
  // al efectivo. El dispositivo aplica esta MISMA regla en su arqueo (`arqueoDe`), y no es
  // casualidad: preguntaba `!== 'Efectivo'` y por eso un ticket con el viejo medio «Otro»
  // —tercer botón retirado del TPV: nadie lo usó en 53 ventas y nadie sabía definirlo—
  // salía del arqueo del móvil pero entraba en el del cierre. Cualquier medio que se añada
  // en el futuro tiene que decidirse aquí y allí a la vez, o vuelve el descuadre fantasma.
  const porMonedaTransf = new Map<string, number>()
  for (const t of vigentes) {
    porMoneda.set(t.moneda, (porMoneda.get(t.moneda) ?? 0) + Number(t.total))
    if ((t.medio_pago ?? 'Efectivo') === 'Transferencia') {
      porMonedaTransf.set(t.moneda, (porMonedaTransf.get(t.moneda) ?? 0) + Number(t.total))
      continue   // una transferencia no lleva vuelto: el banco no da cambio
    }
    // Sin `cobrado_*` el ticket es de antes de la mig. 209 (o se pagó justo): el efectivo
    // es el total, en la moneda de la venta. Ahí la fórmula nueva ES la vieja.
    sumar(t.moneda, t.cobrado_moneda ?? t.moneda, round2(Number(t.cobrado_importe ?? t.total)))
    if (t.cambio_moneda && Number(t.cambio_importe) > 0) {
      sumar(t.moneda, t.cambio_moneda, -round2(Number(t.cambio_importe)))
    }
  }

  // ── Contabilidad: por moneda, un INGRESO de Tesorería y un COBRO de ventas ──
  // Lo ya posteado se pregunta a los MOVIMIENTOS, no al flag `tesoreria_movs`. Antes
  // el guardia era `tesoreria_movs == null` y el flag se escribía aunque una moneda se
  // hubiese saltado por no tener cuenta: quedaba a `{}` (o a medias), dejaba de ser
  // null y el cierre no se reintentaba NUNCA. Resultado: ventas que no llegaban a
  // Tesorería, sin forma de recuperarlas ni resincronizando, y con el badge del portal
  // en verde porque `{}` es truthy. Preguntando por los movimientos reales, arreglar la
  // configuración y volver a sincronizar recupera lo que faltaba, y lo ya posteado no
  // se duplica porque su moneda ya aparece.
  if (tieneBase && porMoneda.size > 0) {
    const { data: previos } = await db.from('movimientos_tesoreria')
      .select('movimiento_id, moneda, cuenta_id')
      .eq('client_id', caja.client_id).eq('origen', 'CAJA').eq('referencia_id', sesionUuid)
    // `movs` está indexado por la moneda de la VENTA, que es lo que compara la pantalla de
    // Cierres contra `total_por_moneda` para decir si quedó algo pendiente. **Ya no se
    // puede reconstruir desde los movimientos**: desde la mig. 209 el dinero de una venta
    // en USD puede haber entrado en la cuenta de CUP, así que un mapa hecho con la moneda
    // de los apuntes diría «hecho CUP, falta USD» para siempre. Se parte de lo ya guardado
    // en la sesión —que ya está en esta clave— y se completa con lo que se postee ahora.
    const movs: Record<string, string> = { ...((ses.tesoreria_movs ?? {}) as Record<string, string>) }
    // La idempotencia, en cambio, SÍ vive en los movimientos reales: un apunte se
    // identifica por su cuenta y su moneda de caja. Preguntando a los datos y no a un flag,
    // arreglar el mapeo y volver a contabilizar recupera lo que faltaba sin duplicar nada.
    const hechos = new Map<string, string>()
    for (const p of (previos ?? []) as { movimiento_id: string; moneda: string; cuenta_id: string }[]) {
      hechos.set(`${p.moneda}|${p.cuenta_id}`, p.movimiento_id)
    }

    // Lo ya CONTABILIZADO se pregunta igual, a los datos: una fila `COBRO` por moneda
    // del cierre en `gastos_cobros` (mig. 149). Sin ella las ventas de mostrador entran
    // en la caja pero NO en el estado de resultados: el renglón «Ventas» de un negocio
    // que solo vende por TPV se queda en blanco, y con él el dossier del asesor, el
    // dashboard y el contexto de la IA. Los cuatro leen `gastos_cobros`, así que una
    // fila los arregla a los cuatro en vez de parchear cuatro consumidores.
    const { data: regsPrevios } = await db.from('gastos_cobros')
      .select('moneda')
      .eq('client_id', caja.client_id)
      .eq('origen_tipo', ORIGEN_CIERRE_CAJA).eq('origen_id', sesionUuid)
    const contabilizadas = new Set(((regsPrevios ?? []) as { moneda: string }[]).map(r => r.moneda))
    const etiquetaCaja = (caja.nombre ?? '').trim()

    /** Las cuentas por las que el dinero de una moneda de venta tiene que pasar. Es lo que
     *  decide si esa moneda se puede contabilizar entera o hay que esperar al mapeo. */
    function cuentasDe(venta: string): (string | undefined)[] {
      const usadas: (string | undefined)[] = []
      for (const [mc, imp] of (efectivo.get(venta) ?? new Map<string, number>())) {
        if (Math.abs(imp) >= 0.005) usadas.push(caja.cuentas_moneda?.[mc])
      }
      if (round2(porMonedaTransf.get(venta) ?? 0) > 0) {
        // La transferencia cae en la cuenta de efectivo si no se configuró otra: así una
        // caja que nunca tocó esto se comporta exactamente igual que antes.
        usadas.push(caja.cuentas_transferencia?.[venta] || caja.cuentas_moneda?.[venta])
      }
      return usadas
    }
    const cuentasListas = (venta: string) => cuentasDe(venta).every(Boolean)

    // Los apuntes de Tesorería, acumulados por cuenta y moneda de caja antes de escribirse.
    const porCuenta = new Map<string, {
      cuenta: string; monedaCaja: string; monto: number; ventas: Set<string>; que: string
    }>()
    function apuntar(venta: string) {
      const anota = (cuenta: string | undefined, monedaCaja: string, monto: number, que: string) => {
        if (!cuenta || Math.abs(monto) < 0.005) return
        const k = `${monedaCaja}|${cuenta}`
        const prev = porCuenta.get(k)
        if (prev) { prev.monto = round2(prev.monto + monto); prev.ventas.add(venta) }
        else porCuenta.set(k, { cuenta, monedaCaja, monto: round2(monto), ventas: new Set([venta]), que })
      }
      for (const [mc, imp] of (efectivo.get(venta) ?? new Map<string, number>())) {
        anota(caja.cuentas_moneda?.[mc], mc, imp,
          mc === venta ? 'Ventas de caja' : `Ventas de caja (cobradas o devueltas en ${mc})`)
      }
      const enTransf = round2(porMonedaTransf.get(venta) ?? 0)
      if (enTransf > 0) {
        anota(caja.cuentas_transferencia?.[venta] || caja.cuentas_moneda?.[venta], venta, enTransf,
          'Ventas de caja (transferencia)')
      }
    }

    for (const [moneda, monto] of porMoneda) {
      // Sin cuenta mapeada NO se postea NADA de esta moneda —ni caja ni contabilidad— y
      // se reintenta en la próxima sincronización. Los dos efectos van juntos a
      // propósito: contabilizar la venta sin que su dinero entre en ninguna caja deja el
      // puente devengado↔caja con un hueco que nada explica, y el registro diciendo
      // «cobrado» un dinero que no está en ningún sitio. Con esto, arreglar el mapeo y
      // pulsar «Contabilizar» en el cierre recupera la moneda entera — resincronizar NO
      // bastaba: el dispositivo no reenvía un cierre que ya dio por enviado (Fase 2).
      //
      // Las cuentas que hacen falta son las de las monedas en que el dinero ENTRÓ de
      // verdad, no la de la moneda de la venta: desde la mig. 209 una venta en USD cobrada
      // en CUP no necesita cuenta en USD para nada.
      if (!movs[moneda] && !cuentasListas(moneda)) continue

      // 1) El registro contable (idempotente por moneda del cierre).
      if (!contabilizadas.has(moneda) && monto > 0) {
        const etiqueta = `Ventas de caja${etiquetaCaja ? ` ${etiquetaCaja}` : ''} — cierre ${sesionUuid.substring(0, 8)}`
        const { error } = await db.from('gastos_cobros').insert({
          registro_id:  generarRegistroId('COBRO'),
          client_id:    caja.client_id,
          empresa_id:   caja.empresa_id,
          tipo:         'COBRO',
          fecha,
          vencimiento:  null,                 // no hay nada que vencer: ya está cobrado
          tercero_id:   null,                 // el mostrador no tiene cliente
          categoria:    null,                 // un COBRO no lleva categoría
          categoria_id: null,
          descripcion:  etiqueta,
          concepto:     etiqueta,             // mig. 152: la columna que lee la tabla
          moneda,
          monto,
          notas:        'Resumen del cierre del punto de venta. El detalle, ticket a ticket, está en Caja.',
          origen_tipo:  ORIGEN_CIERRE_CAJA,
          origen_id:    sesionUuid,
          updated_at:   new Date().toISOString(),
        })
        if (error) throw new Error(`contabilidad ${moneda}: ${error.message}`)
        contabilizadas.add(moneda)
        did = true
      }

      // Los apuntes de Tesorería de esta moneda de venta se acumulan y se escriben abajo,
      // agrupados por cuenta: dos monedas de venta pueden acabar en la misma gaveta.
      apuntar(moneda)
    }

    // 2) Los movimientos de Tesorería, UNO POR CUENTA Y MONEDA DE CAJA.
    //
    // Agrupados y no uno por destino: con el vuelto cruzado, dos monedas de venta pueden
    // dejar dinero en la misma cuenta, y dos apuntes con la misma (cuenta, moneda) son
    // indistinguibles al reintentar —el segundo se tomaría por el primero y no se
    // escribiría—. Agrupar además arregla de paso el caso de siempre: sin cuenta de
    // transferencias configurada, la transferencia va a la MISMA cuenta que el efectivo, y
    // antes su importe se perdía por ese mismo choque de claves.
    for (const d of porCuenta.values()) {
      if (!d.cuenta || Math.abs(d.monto) < 0.005) continue
      const clave = `${d.monedaCaja}|${d.cuenta}`
      const yaHecho = hechos.get(clave)
      if (yaHecho) {
        // Ya estaba puesto: lo que falta es dejar dicho qué ventas liquida, que es lo que
        // mira la pantalla de Cierres.
        for (const v of d.ventas) movs[v] ??= yaHecho
        continue
      }
      const movId = generarMovId()
      // Con el vuelto cruzado el neto de una moneda puede ser NEGATIVO: se dio más cambio
      // en CUP del que entró en CUP. Eso no es un error, es lo que pasó, y la cuenta tiene
      // que reflejarlo o el saldo de Claux se separa del dinero real.
      const sale = d.monto < 0
      const { error } = await db.from('movimientos_tesoreria').insert({
        movimiento_id: movId,
        client_id:     caja.client_id,
        empresa_id:    caja.empresa_id,
        cuenta_id:     d.cuenta,
        fecha,
        tipo:          sale ? 'EGRESO' : 'INGRESO',
        monto:         Math.abs(d.monto),
        moneda:        d.monedaCaja,
        monto_ref:     Math.abs(d.monto),
        concepto:      `${d.que} — cierre ${sesionUuid.substring(0, 8)}`,
        origen:        'CAJA',
        referencia_id: sesionUuid,
      })
      if (error) throw new Error(`tesorería ${d.monedaCaja}: ${error.message}`)
      hechos.set(clave, movId)
      for (const v of d.ventas) movs[v] ??= movId
      did = true
    }
    // Se guarda el mapa real, sin el `.is(null)`: ese guardia era lo que congelaba el
    // cierre a medio postear. El mapa dice qué monedas están hechas, y la vista compara
    // sus claves con las de `total_por_moneda` para saber si queda algo pendiente.
    await db.from('caja_sesiones').update({ tesoreria_movs: movs }).eq('sesion_uuid', sesionUuid)
  }

  // ── Tesorería: las salidas y entradas de efectivo del turno ──
  //
  // Sacar dinero de la gaveta —pagarle al proveedor, la retirada del dueño— lo registra el
  // dispositivo y lo resta del efectivo esperado del arqueo, pero hasta aquí moría en
  // `caja_turno_movimientos`: el cierre posteaba el INGRESO de las ventas y ningún egreso,
  // así que **el saldo de la cuenta de caja en Claux quedaba inflado exactamente por lo que
  // había salido**. El arqueo del móvil cuadraba y la contabilidad no, sin que nada lo dijera.
  //
  // Un apunte por movimiento, no un resumen: cada uno lleva su motivo, y el motivo es lo
  // único que explica el descuadre tres semanas después.
  //
  // **No toca el estado de resultados**: aquí el dinero solo cambia de sitio. El gasto se
  // registra cuando llegue su factura; contabilizarlo también aquí lo contaría dos veces.
  // Va fuera del bloque de arriba a propósito: un turno puede tener una salida y ninguna
  // venta, y ese es justo el caso en el que el saldo se desviaba sin compensación.
  if (tieneBase) {
    const { data: turnoMovs } = await db.from('caja_turno_movimientos')
      .select('movimiento_uuid, tipo, moneda, importe, motivo, fecha').eq('sesion_uuid', sesionUuid)
    const lista = (turnoMovs ?? []) as {
      movimiento_uuid: string; tipo: string; moneda: string
      importe: number; motivo: string | null; fecha: string
    }[]

    if (lista.length > 0) {
      // Idempotencia por `referencia_id` = el uuid del movimiento, generado en el móvil
      // (misma idea que `ticket_uuid`). Los ingresos de las ventas usan el uuid de la
      // SESIÓN, así que las dos series no se pisan y re-sincronizar no duplica ninguna.
      const { data: yaHechos } = await db.from('movimientos_tesoreria')
        .select('referencia_id')
        .eq('client_id', caja.client_id).eq('origen', 'CAJA')
        .in('referencia_id', lista.map(m => m.movimiento_uuid))
      const posteados = new Set(((yaHechos ?? []) as { referencia_id: string }[]).map(r => r.referencia_id))

      for (const mv of lista) {
        if (posteados.has(mv.movimiento_uuid)) continue
        // El efectivo entra y sale de la GAVETA, nunca de la cuenta de transferencias.
        // Sin cuenta mapeada no se postea y se reintenta en la próxima ingesta, igual
        // que las ventas: el mismo criterio para el mismo problema.
        const cuentaId = caja.cuentas_moneda?.[mv.moneda]
        const importe = round2(Number(mv.importe) || 0)
        if (!cuentaId || importe <= 0) continue

        const esSalida = mv.tipo === 'SALIDA'
        const que = esSalida ? 'Salida de efectivo' : 'Entrada de efectivo'
        const { error } = await db.from('movimientos_tesoreria').insert({
          movimiento_id: generarMovId(),
          client_id:     caja.client_id,
          empresa_id:    caja.empresa_id,
          cuenta_id:     cuentaId,
          // La fecha es la del movimiento, no la del cierre: se sacó cuando se sacó, y en
          // el día del NEGOCIO (una salida de las 21:00 en Cuba no es de mañana).
          fecha:         fechaEnTz(mv.fecha),
          tipo:          esSalida ? 'EGRESO' : 'INGRESO',
          monto:         importe,
          moneda:        mv.moneda,
          monto_ref:     importe,
          concepto:      `${que} de caja${mv.motivo ? ` — ${mv.motivo}` : ''} — cierre ${sesionUuid.substring(0, 8)}`,
          origen:        'CAJA',
          referencia_id: mv.movimiento_uuid,
        })
        if (error) throw new Error(`tesorería movimiento de caja: ${error.message}`)
        did = true
      }
    }
  }

  // ── Inventario: un SALIDA resumen por producto ──
  if (tieneInv && caja.almacen_id && ses.stock_movs == null && ticketUuids.length > 0) {
    const { data: lineas } = await db.from('caja_ticket_lineas')
      .select('producto_id, cantidad').in('ticket_uuid', ticketUuids).not('producto_id', 'is', null)

    // Solo los FÍSICOS mueven existencias. Un servicio no tiene stock que sacar, y el
    // cierre lleva `permitir_negativo: true`, así que sin este filtro se creaba stock
    // negativo de un SRV- en silencio (pasó: mig. 157 limpió el resto). Se filtra AQUÍ
    // aunque la RPC ya tenga su propio candado: la RPC lanza, y un cierre de caja no
    // puede romperse entero porque un dispositivo con semilla vieja mande un servicio.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const idsLinea = [...new Set((lineas ?? []).map((l: any) => l.producto_id as string))]
    const fisicos = new Set<string>()
    if (idsLinea.length > 0) {
      const { data: prods } = await db.from('products')
        .select('producto_id').eq('client_id', caja.client_id)
        .in('producto_id', idsLinea).eq('tipo', 'PRODUCTO')
      for (const p of (prods ?? [])) fisicos.add(p.producto_id as string)
    }

    const porProd = new Map<string, number>()
    for (const l of (lineas ?? [])) {
      if (!fisicos.has(l.producto_id)) continue
      porProd.set(l.producto_id, (porProd.get(l.producto_id) ?? 0) + Number(l.cantidad))
    }

    const movs: Record<string, string> = {}
    for (const [producto_id, cantidad] of porProd) {
      if (cantidad <= 0) continue
      const r = await aplicarMovimiento(db, {
        client_id:  caja.client_id,
        empresa_id: caja.empresa_id,
        fecha,
        tipo:       'SALIDA',
        producto_id,
        almacen_id: caja.almacen_id,
        cantidad,
        motivo:     `Ventas de caja — cierre ${sesionUuid.substring(0, 8)}`,
        origen:     'VENTA',
        referencia_id: sesionUuid,
        permitir_negativo: true,
      })
      movs[producto_id] = r.movimiento_id
    }
    await db.from('caja_sesiones').update({ stock_movs: movs }).eq('sesion_uuid', sesionUuid).is('stock_movs', null)
    did = true
  }

  await db.from('caja_sesiones').update({
    total_por_moneda: Object.fromEntries(porMoneda),
    posted_at:        new Date().toISOString(),
  }).eq('sesion_uuid', sesionUuid)

  return did
}
