'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { hoyEnTz, ahoraEnTz } from '@/lib/fecha-tz'
import { transicionarEstado, notificarReservaNueva, CAMBIOS_VALIDOS, type EstadoReserva } from '@/lib/reservas/estado'
import { type BotConfig, parseBotConfig, guardarBotConfigCol, toggleActivoBotCol, eliminarBotConfigCol, guardarConfirmacionCol, guardarIaActivaCol } from '@/lib/reservas/bot-config'
import { etiquetasDe, etiquetasCliente, ETIQUETAS_DEFAULT, type EtiquetasSector } from '@/lib/sector'
import { rateLimitOk } from '@/lib/rate-limit'
import { tieneModulo, tieneAlgunModulo, MODULOS_CATALOGO } from '@/lib/modulos'
import { mapaTasas, monedaValida } from '@/lib/tasas'
import { notificarReservaEntrante } from '@/lib/notificaciones/eventos'
import { enviarMensaje } from '@/lib/telegram/enviar'
import { type Cierre, type ReglasReserva, type ResultadoAgenda } from './agenda-comun'
import { getPortalSession, puedeEditarModulo }  from './auth'
import {
  limiteDelFiltro, patronBusqueda, ordenDelRango, type FiltroListado,
} from '@/lib/listados'
import { sumarDias } from '@/lib/fecha-tz'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface Servicio {
  servicio_id:      string
  nombre:           string
  duracion_minutos: number
  /**
   * Minutos entre esta cita y la siguiente (limpiar, cobrar, despedir). Se suma a la
   * OCUPACIÓN, nunca a lo que ve el cliente («Corte · 30 min») ni al precio. 0 = sin margen.
   */
  margen_minutos:   number
  precio:           number | null
  /** Moneda del precio. NULL en fichas viejas sin precio (mig. 119). Nunca de una lista fija. */
  moneda:           string | null
  /** Vínculo BLANDO al catálogo (`products`). NULL = servicio suelto de Citas. */
  producto_id:      string | null
  activo:           boolean
}

/** Servicio del catálogo comercial, para el llenado rápido. Vacío si no hay módulo. */
export interface ServicioCatalogo {
  producto_id: string
  codigo:      string
  nombre:      string
  precios:     Record<string, number>
  /** Ya existe un servicio de Citas vinculado a él: no se vuelve a ofrecer para importar. */
  ya_importado: boolean
}

export interface RecursoHorario {
  dia_semana:  number
  hora_inicio: string  // HH:MM
  hora_fin:    string  // HH:MM
}

export interface Recurso {
  recurso_id:   string
  nombre:       string
  tipo:         string | null
  activo:       boolean
  empleado_id:  string | null  // vínculo opcional con un empleado de RRHH
  servicio_ids: string[]      // servicios que presta (vacío = todos)
  horarios:     RecursoHorario[]
  /** Días libres de ESTE profesional. Los cierres son del negocio entero (CIT-4). */
  ausencias:    Ausencia[]
}

export interface Ausencia {
  ausencia_id: string
  recurso_id:  string
  fecha_desde: string
  fecha_hasta: string
  motivo:      string | null
}

export interface EmpleadoRRHH {
  empleado_id:  string
  nombre:       string
  ya_importado: boolean
}

export interface Cita {
  reserva_id:     string
  client_id:      string
  recurso_id:     string | null
  servicio_id:    string | null
  fecha:          string
  hora:           string | null
  hora_fin:       string | null
  nombre_cliente: string
  telefono:       string | null
  notas:          string | null
  canal:          'web' | 'bot' | 'manual'
  estado:         EstadoReserva
  telegram_chat_id: string | null
  /** La metió el dueño saltándose una regla (horario, solape, antelación…). */
  forzada:        boolean
  /** ATENDIDA la puso el barrido diario, no el dueño. */
  cierre_auto:    boolean
  created_at:     string
}

export interface CitaConDetalle extends Cita {
  recurso_nombre:  string
  servicio_nombre: string
  servicio_duracion: number
}

export interface CitasPageData {
  client_id:   string
  /** Nombre del negocio, para redactar el aviso al cliente (fase 10). */
  negocio:     string
  citas:       CitaConDetalle[]
  recursos:    Recurso[]
  servicios:   Servicio[]
  slug:        string | null
  etiquetas:   EtiquetasSector
  bot_config:  BotConfig
  rrhh_activo: boolean
  empleados:   EmpleadoRRHH[]   // del módulo RRHH (vacío si no está activo)
  cierres:     Cierre[]         // festivos/cierres del negocio (compartidos con Reservas)
  reglas:      ReglasReserva    // antelación/ventana (compartidas con Reservas)
  tieneIa:     boolean          // addon asistente_ia contratado → toggle de IA del bot
  /** Tiene TAMBIÉN Reservas: solo entonces hace falta decir de quién es cada ajuste. */
  tieneAmbas:  boolean
  monedas:     string[]         // las del cliente (tabla `monedas`), nunca una lista fija
  tasas:       Record<string, number>   // "ORIGEN__DESTINO" → factor, para el atajo al cambiar de moneda
  catalogo:    ServicioCatalogo[]       // llenado rápido; vacío si no hay módulo de catálogo
  /**
   * ¿Tiene módulo de catálogo? NO es `catalogo.length > 0`: con Servicios contratado y
   * el catálogo aún vacío hay que ofrecer igualmente «crearlo también allí» — ese es
   * justo el primero. Sin módulo no se pinta nada y Citas sigue funcionando sola.
   */
  catalogo_activo: boolean
  /** Rango aplicado EN LA CONSULTA. Viaja a la vista para pintar el botón de rango. */
  rango:      { desde: string; hasta: string }
  /** Texto buscado, aplicado en la consulta. */
  q:          string
  /** El techo recortó: hay citas del rango que no se han traído. */
  hay_mas:    boolean
  /** Cuántas cumplen el filtro DE VERDAD (`count: 'exact'`). */
  total:      number
  /** Techo con el que se consultó, para que «Ver más» sepa desde dónde subir. */
  limite:     number
  /**
   * Lo de HOY, contado aparte (U3). La cabecera se calculaba sobre `citas`, que es el
   * rango cargado: poner «Mes pasado» en la barra la dejaba a cero.
   */
  hoy:        { pendientes: number; confirmadas: number; total: number }
  /** Confirmadas de días pasados que nadie ha cerrado (ni «vino» ni «no vino»). */
  por_cerrar: number
}

function reglasDe(c: Record<string, unknown> | null | undefined): ReglasReserva {
  return {
    antelacion_min_horas: Number(c?.reserva_antelacion_min_horas ?? 0) || 0,
    ventana_max_dias:     Number(c?.reserva_ventana_max_dias ?? 0) || 0,
    max_personas:         Number(c?.reserva_max_personas ?? 0) || 0,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function corto(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()
}
function generarRecursoId():  string { return `REC-${corto()}` }
function generarServicioId(): string { return `SER-${corto()}` }
function generarHorarioId():  string { return `RHO-${corto()}` }
function generarReservaId():  string { return `RES-${corto()}` }
function generarAusenciaId(): string { return `AUS-${corto()}` }

function hoy(): string { return hoyEnTz() }
function horaAhora(): string { return ahoraEnTz() }

// Validación básica de correo (el navegador ya aplica type="email").
function emailValido(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

function hhmm(t: string | null): string { return t ? t.substring(0, 5) : '' }

/**
 * CIT-9: la cascada completa **override del cliente → sector → genérico**.
 *
 * Esto leía SOLO `plantillas_sector` e ignoraba `clients.etiquetas` (mig. 164), que
 * sí usa el sidebar: el menú podía decir «Profesional» y la página «Personal». Y
 * encima forzaba siempre el genérico, así que el override del cliente no llegaba nunca.
 * El forzado se conserva solo como salvavidas cuando el sector trae una palabra que
 * en una agenda no significa nada («Mesa»), y siempre por debajo del override.
 */
async function etiquetasDeSector(
  db: ReturnType<typeof createAdminClient>, sector: string | null, override?: unknown,
): Promise<EtiquetasSector> {
  let base: EtiquetasSector = { ...ETIQUETAS_DEFAULT }
  if (sector) {
    const { data: pl } = await db.from('plantillas_sector').select('etiquetas').eq('sector', sector).maybeSingle()
    base = etiquetasDe(pl?.etiquetas)
  }
  // Del sector no se hereda «Mesa»/«Cabina» como recurso de una agenda.
  const heredado = /mesa/i.test(base.recurso) ? ETIQUETAS_DEFAULT.recurso : base.recurso
  const heredadoPl = /mesa/i.test(base.recurso_pl) ? ETIQUETAS_DEFAULT.recurso_pl : base.recurso_pl
  const conSector: EtiquetasSector = { ...base, recurso: heredado, recurso_pl: heredadoPl }

  // El override del cliente manda sobre todo lo anterior.
  return etiquetasCliente(conSector, override)
}

// ── Datos del portal ───────────────────────────────────────────────────────────

/**
 * Rango por defecto de Citas: **los próximos 30 días**.
 *
 * Una cita es un compromiso de FUTURO, así que el defecto histórico de los listados de
 * Contabilidad no vale aquí. Y tiene que ser un rango de verdad: la pantalla se traía la
 * agenda ENTERA y escondía en el navegador todo salvo el día de hoy.
 */
function rangoPorDefecto(): { desde: string; hasta: string } {
  const hoyIso = hoyEnTz()
  return { desde: hoyIso, hasta: sumarDias(hoyIso, 30) }
}

export async function obtenerCitasData(filtro?: FiltroListado): Promise<CitasPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const cid = session.client_id

  const porDefecto = rangoPorDefecto()
  const desde  = filtro?.desde ?? porDefecto.desde
  const hasta  = filtro?.hasta ?? porDefecto.hasta
  const q      = (filtro?.q ?? '').trim()
  const limite = limiteDelFiltro(filtro)
  const patron = patronBusqueda(q)

  // `count: 'exact'` en la MISMA consulta: las filas del techo y, aparte, cuántas cumplen
  // el filtro. Sin él el aviso del techo diría «500 de 500» sobre el conjunto ya recortado.
  let citasQuery = db.from('reservas').select('*', { count: 'exact' })
    .eq('client_id', cid).not('recurso_id', 'is', null)
  // Los filtros de la barra cuando la vista los ESCALA (`?srv=1`): mientras el listado cabe
  // entero el navegador da el mismo resultado sin gastar un viaje.
  if (filtro?.estado)    citasQuery = citasQuery.eq('estado', filtro.estado)
  if (filtro?.categoria) citasQuery = citasQuery.eq('recurso_id', filtro.categoria)
  if (desde) citasQuery = citasQuery.gte('fecha', desde)
  if (hasta) citasQuery = citasQuery.lte('fecha', hasta)
  if (patron) {
    citasQuery = citasQuery.or([
      `nombre_cliente.ilike.${patron}`,
      `telefono.ilike.${patron}`,
      `notas.ilike.${patron}`,
    ].join(','))
  }
  // El orden sigue al rango (ver `ordenDelRango`): la agenda de mañana arriba cuando se
  // mira hacia delante; lo más reciente primero cuando se repasa un mes cerrado.
  const { ascendente } = ordenDelRango(desde, hasta)
  citasQuery = citasQuery
    .order('fecha', { ascending: ascendente })
    .order('hora',  { ascending: ascendente, nullsFirst: ascendente })
    .limit(limite)

  // `recurso_servicios` NO tiene columna `client_id` (es una tabla puente pura), así que
  // una consulta sin filtro barría la tabla de TODOS los inquilinos para luego descartar
  // lo ajeno al indexar por recurso. No era una fuga —el mapa solo se consulta con los
  // recursos de este cliente— pero sí una lectura que crece con el negocio de los demás,
  // y el aislamiento por `client_id` aquí lo hace la aplicación, no RLS (CONTEXTO §2 ›
  // Esquema y datos). Se acota por los recursos propios, que hay que leer igualmente.
  const { data: recData } = await db.from('recursos').select('*').eq('client_id', cid).order('nombre')
  const recursoIds = ((recData ?? []) as { recurso_id: string }[]).map(r => r.recurso_id)

  // Lo de hoy, contado en la base: la cabecera no puede depender del rango de la barra.
  const deHoy = (estado: EstadoReserva) => db.from('reservas')
    .select('reserva_id', { count: 'exact', head: true })
    .eq('client_id', cid).not('recurso_id', 'is', null)
    .eq('fecha', hoy()).eq('estado', estado)

  const [srvRes, rsRes, rhRes, citasRes, cliRes, pendHoy, confHoy, porCerrar] = await Promise.all([
    db.from('servicios').select('*').eq('client_id', cid).order('nombre'),
    db.from('recurso_servicios').select('recurso_id, servicio_id')
      .in('recurso_id', recursoIds.length ? recursoIds : ['__none__']),
    db.from('recurso_horarios').select('recurso_id, dia_semana, hora_inicio, hora_fin').eq('client_id', cid),
    citasQuery,
    db.from('clients').select('slug, sector, nombre_empresa, etiquetas, bot_config_citas, modulos_activos, reserva_antelacion_min_horas, reserva_ventana_max_dias, reserva_max_personas').eq('client_id', cid).single(),
    deHoy('PENDIENTE'),
    deHoy('CONFIRMADA'),
    db.from('reservas').select('reserva_id', { count: 'exact', head: true })
      .eq('client_id', cid).not('recurso_id', 'is', null)
      .eq('estado', 'CONFIRMADA').lt('fecha', hoy()),
  ])

  const servicios: Servicio[] = ((srvRes.data ?? []) as Servicio[]).map(s => ({
    ...s, duracion_minutos: Number(s.duracion_minutos), margen_minutos: Number(s.margen_minutos ?? 0),
    precio: s.precio == null ? null : Number(s.precio),
    moneda: s.moneda ?? null, producto_id: s.producto_id ?? null,
  }))
  const srvPorId = new Map(servicios.map(s => [s.servicio_id, s]))

  const linkPorRecurso = new Map<string, string[]>()
  for (const row of (rsRes.data ?? []) as { recurso_id: string; servicio_id: string }[]) {
    const arr = linkPorRecurso.get(row.recurso_id) ?? []
    arr.push(row.servicio_id)
    linkPorRecurso.set(row.recurso_id, arr)
  }

  const horPorRecurso = new Map<string, RecursoHorario[]>()
  for (const row of (rhRes.data ?? []) as { recurso_id: string; dia_semana: number; hora_inicio: string; hora_fin: string }[]) {
    const arr = horPorRecurso.get(row.recurso_id) ?? []
    arr.push({ dia_semana: Number(row.dia_semana), hora_inicio: hhmm(row.hora_inicio), hora_fin: hhmm(row.hora_fin) })
    horPorRecurso.set(row.recurso_id, arr)
  }

  // Ausencias vigentes (de hoy en adelante): las pasadas ya no dicen nada.
  const { data: ausData } = await db.from('recurso_ausencias')
    .select('ausencia_id, recurso_id, fecha_desde, fecha_hasta, motivo')
    .eq('client_id', cid).gte('fecha_hasta', hoy()).order('fecha_desde')
  const ausPorRecurso = new Map<string, Ausencia[]>()
  for (const a of (ausData ?? []) as Ausencia[]) {
    const arr = ausPorRecurso.get(a.recurso_id) ?? []
    arr.push(a)
    ausPorRecurso.set(a.recurso_id, arr)
  }

  const recursos: Recurso[] = ((recData ?? []) as { recurso_id: string; nombre: string; tipo: string | null; activo: boolean; empleado_id: string | null }[]).map(r => ({
    recurso_id:   r.recurso_id,
    nombre:       r.nombre,
    tipo:         r.tipo,
    activo:       r.activo,
    empleado_id:  r.empleado_id ?? null,
    servicio_ids: linkPorRecurso.get(r.recurso_id) ?? [],
    horarios:     (horPorRecurso.get(r.recurso_id) ?? []).sort((a, b) => a.dia_semana - b.dia_semana || a.hora_inicio.localeCompare(b.hora_inicio)),
    ausencias:    ausPorRecurso.get(r.recurso_id) ?? [],
  }))
  const recPorId = new Map(recursos.map(r => [r.recurso_id, r]))

  const citas: CitaConDetalle[] = ((citasRes.data ?? []) as Cita[]).map(c => {
    const srv = c.servicio_id ? srvPorId.get(c.servicio_id) : undefined
    return {
      ...c,
      recurso_nombre:    (c.recurso_id ? recPorId.get(c.recurso_id)?.nombre : undefined) ?? '—',
      servicio_nombre:   srv?.nombre ?? '—',
      servicio_duracion: srv?.duracion_minutos ?? 0,
    }
  })

  // RRHH (llenado rápido): si el módulo está activo, ofrecemos su lista de empleados
  // para importarlos como personal. Citas no depende de RRHH (sigue funcionando manual).
  const rrhh_activo = tieneModulo(cliRes.data?.modulos_activos, 'rrhh')
  let empleados: EmpleadoRRHH[] = []
  if (rrhh_activo) {
    const yaLinked = new Set(recursos.map(r => r.empleado_id).filter(Boolean) as string[])
    const { data: emps } = await db.from('empleados')
      .select('empleado_id, nombre, apellidos')
      .eq('client_id', cid).is('fecha_baja', null).order('nombre')
    empleados = ((emps ?? []) as { empleado_id: string; nombre: string; apellidos: string | null }[]).map(e => ({
      empleado_id:  e.empleado_id,
      nombre:       [e.nombre, e.apellidos].filter(Boolean).join(' '),
      ya_importado: yaLinked.has(e.empleado_id),
    }))
  }

  // Catálogo comercial (llenado rápido, mismo patrón que RRHH arriba): si el cliente
  // tiene Servicios o Inventario, ofrecemos sus servicios de `products` para crear el de
  // Citas sin teclear el nombre y el precio dos veces. **Citas no depende de esto**: sin
  // módulo la lista viene vacía y todo se sigue creando a mano.
  const catalogo_activo = tieneAlgunModulo(cliRes.data?.modulos_activos, MODULOS_CATALOGO)
  let catalogo: ServicioCatalogo[] = []
  if (catalogo_activo) {
    const { data: prods } = await db.from('products')
      .select('producto_id, codigo, nombre, precios')
      .eq('client_id', cid).eq('tipo', 'SERVICIO').eq('estado', 'ACTIVO').order('nombre')
    // Lo ya traído se marca, no se esconde: el importador enseña la lista entera con
    // los importados en gris, que es como se ve de un vistazo qué falta por traer.
    const yaLinked = new Set(servicios.map(s => s.producto_id).filter(Boolean) as string[])
    catalogo = ((prods ?? []) as ServicioCatalogo[]).map(p => ({
      producto_id: p.producto_id, codigo: p.codigo, nombre: p.nombre,
      precios: (p.precios ?? {}) as Record<string, number>,
      ya_importado: yaLinked.has(p.producto_id),
    }))
  }

  const [{ data: cierresData }, { data: monedasData }] = await Promise.all([
    db.from('reserva_cierres')
      .select('cierre_id, fecha_desde, fecha_hasta, motivo')
      .eq('client_id', cid).gte('fecha_hasta', hoy()).order('fecha_desde'),
    db.from('monedas').select('codigo').eq('client_id', cid).eq('activa', true).order('codigo'),
  ])
  const monedas = ((monedasData ?? []) as { codigo: string }[]).map(m => m.codigo)

  return {
    client_id:   cid,
    citas,
    recursos,
    servicios,
    negocio:     (cliRes.data?.nombre_empresa as string) ?? 'Tu negocio',
    slug:        (cliRes.data?.slug as string) ?? null,
    etiquetas:   await etiquetasDeSector(db, (cliRes.data?.sector as string) ?? null, cliRes.data?.etiquetas),
    bot_config:  parseBotConfig(cliRes.data?.bot_config_citas),
    rrhh_activo,
    empleados,
    cierres:     (cierresData ?? []) as Cierre[],
    reglas:      reglasDe(cliRes.data as Record<string, unknown> | null),
    tieneIa:     tieneModulo(cliRes.data?.modulos_activos, 'asistente_ia'),
    tieneAmbas:  tieneModulo(cliRes.data?.modulos_activos, 'reservas_citas'),
    monedas,
    tasas:       await mapaTasas(db, cid, monedas),
    catalogo,
    catalogo_activo,
    rango:   { desde, hasta },
    q,
    hay_mas: citas.length >= limite,
    total:   citasRes.count ?? citas.length,
    limite,
    hoy: {
      pendientes:  pendHoy.count ?? 0,
      confirmadas: confHoy.count ?? 0,
      total:      (pendHoy.count ?? 0) + (confHoy.count ?? 0),
    },
    por_cerrar: porCerrar.count ?? 0,
  }
}

// ── Servicios (CRUD) ─────────────────────────────────────────────────────────

export async function guardarServicio(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; aviso?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('agenda'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const servicio_id = (formData.get('servicio_id') as string)?.trim()
  const nombre      = (formData.get('nombre')      as string)?.trim()
  const duracionRaw = parseInt(formData.get('duracion_minutos') as string, 10)
  const margenRaw   = parseInt(formData.get('margen_minutos') as string, 10)
  const precioRaw   = (formData.get('precio') as string)?.trim()
  const monedaRaw   = (formData.get('moneda') as string)?.trim() || null
  const productoRaw = (formData.get('producto_id') as string)?.trim() || null
  const activo      = formData.get('activo') === 'true'

  if (!nombre) return { ok: false, error: 'El nombre del servicio es obligatorio.' }
  const duracion = isNaN(duracionRaw) || duracionRaw < 5 ? 30 : duracionRaw
  const margen   = isNaN(margenRaw) || margenRaw < 0 ? 0 : margenRaw
  const precio   = precioRaw ? Number(precioRaw) : null
  if (precio != null && (isNaN(precio) || precio < 0)) return { ok: false, error: 'Precio no válido.' }

  const db = createAdminClient()

  // Un precio sin moneda es justo lo que rompía esto: la UI lo pintaba «$» y el bot se lo
  // anunciaba al cliente final como dólares. Con precio hay que decir en qué moneda, y
  // tiene que ser una del cliente (guardia de servidor, no confianza en el desplegable).
  const moneda = precio == null ? null : monedaRaw
  if (precio != null) {
    if (!moneda) return { ok: false, error: 'Elige la moneda del precio.' }
    if (!(await monedaValida(db, session.client_id, moneda))) {
      return { ok: false, error: `La moneda "${moneda}" no está configurada.` }
    }
  }

  // Vínculo blando con el catálogo: se acepta solo si ese servicio existe y es del
  // cliente. Si no, se guarda suelto — Citas funciona sin catálogo.
  let producto_id: string | null = null
  if (productoRaw) {
    const { data: prod } = await db.from('products')
      .select('producto_id').eq('client_id', session.client_id)
      .eq('producto_id', productoRaw).eq('tipo', 'SERVICIO').maybeSingle()
    producto_id = prod ? productoRaw : null
  }

  // Crear también la ficha del catálogo, si lo pidió la casilla. Es la respuesta al
  // problema de tener el módulo Servicios y acabar con dos listas que se separan: en vez
  // de prohibir crear aquí (Citas no puede depender de otro módulo), se crea EN LOS DOS
  // y queda vinculado. El candado es el de Servicios, no el de Citas: escribir en
  // `products` es escribir en el módulo del vecino, y la casilla de la UI no es control
  // de acceso. Si no se puede, se guarda igual el servicio de Citas y se avisa.
  let avisoCatalogo: string | undefined
  if (!producto_id && (formData.get('crear_en_catalogo') as string) === '1') {
    if (!(await puedeEditarModulo('servicios'))) {
      avisoCatalogo = 'No se pudo añadir al catálogo (sin permiso en Servicios).'
    } else {
      const { data: srvs } = await db.from('products')
        .select('producto_id, codigo, nombre')
        .eq('client_id', session.client_id).eq('tipo', 'SERVICIO')

      const existentes = (srvs ?? []) as { producto_id: string; codigo: string; nombre: string }[]

      // Si ya hay uno con ese nombre, se VINCULA en vez de crear otro: el objetivo de la
      // casilla es no llevar dos listas, y crear un «jjj» al lado del «jjj» que ya existe
      // sería exactamente el problema que viene a resolver. La comparación es sin
      // may/min y sin acentos, que es como el dueño ve que son «el mismo».
      const igual = (a: string, b: string) =>
        a.localeCompare(b, 'es', { sensitivity: 'base' }) === 0
      const yaExiste = existentes.find(p => igual(p.nombre.trim(), nombre))

      if (yaExiste) {
        producto_id = yaExiste.producto_id
      } else {
        const n = existentes.reduce((max, p) => {
          const m = /^SRV-(\d+)$/.exec(p.codigo)
          return m ? Math.max(max, parseInt(m[1], 10)) : max
        }, 0) + 1
        const nuevoId = `SRV-${corto()}`
        const { error } = await db.from('products').insert({
          producto_id:  nuevoId,
          client_id:    session.client_id,
          codigo:       `SRV-${String(n).padStart(4, '0')}`,
          nombre,
          tipo:         'SERVICIO',
          unidad:       'servicio',
          estado:       'ACTIVO',
          // Un precio por moneda, como en el catálogo: aquí solo hay uno y es el suyo.
          precios:      precio != null && moneda ? { [moneda]: precio } : {},
          costos:       {},
          stock_actual: 0,
          stock_minimo: 0,
          created_at:   new Date().toISOString(),
          updated_at:   new Date().toISOString(),
        })
        if (error) {
          console.error('[citas] alta en catálogo:', error)
          avisoCatalogo = 'El servicio se guardó, pero no se pudo añadir al catálogo.'
        } else {
          producto_id = nuevoId
        }
      }
    }
  }

  if (!servicio_id) {
    const { error } = await db.from('servicios').insert({
      servicio_id: generarServicioId(), client_id: session.client_id,
      nombre, duracion_minutos: duracion, margen_minutos: margen, precio, moneda, producto_id, activo,
    })
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await db.from('servicios')
      .update({ nombre, duracion_minutos: duracion, margen_minutos: margen, precio, moneda, producto_id, activo, updated_at: new Date().toISOString() })
      .eq('servicio_id', servicio_id).eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/portal/citas')
  if (producto_id) revalidatePath('/portal/servicios')
  return { ok: true, aviso: avisoCatalogo }
}

export async function eliminarServicio(servicio_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('agenda'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const { count } = await db.from('reservas')
    .select('reserva_id', { count: 'exact', head: true })
    .eq('client_id', session.client_id).eq('servicio_id', servicio_id)
    .gte('fecha', hoy()).in('estado', ['PENDIENTE', 'CONFIRMADA'])
  if ((count ?? 0) > 0) return { ok: false, error: 'El servicio tiene citas pendientes o confirmadas. Cancélalas antes de eliminarlo.' }

  await db.from('recurso_servicios').delete().eq('servicio_id', servicio_id)
  const { error } = await db.from('servicios').delete()
    .eq('servicio_id', servicio_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/citas')
  return { ok: true }
}

// ── Recursos / profesionales (CRUD + servicios + horarios) ─────────────────────

export async function guardarRecurso(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('agenda'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const recurso_id  = (formData.get('recurso_id')  as string)?.trim()
  const nombre      = (formData.get('nombre')      as string)?.trim()
  const tipo        = (formData.get('tipo')        as string)?.trim() || null
  const empleado_id = (formData.get('empleado_id') as string)?.trim() || null
  const activo      = formData.get('activo') === 'true'

  if (!nombre) return { ok: false, error: 'El nombre es obligatorio.' }

  // Servicios que presta (sin selección = presta todos)
  const servicioIds = formData.getAll('servicio_ids').map(v => (v as string).trim()).filter(Boolean)

  // Horarios: DOS tramos por día (CIT-3, jornada partida). `recurso_horarios` siempre
  // admitió varias filas por día y `res_slots_cita` las recorre todas; el formulario
  // guardaba una sola, así que no había forma de cerrar a la hora de comer: o se
  // ofrecían citas a las 13:30 o se cerraba el negocio entero. Campos:
  // hor_<dia>_inicio / hor_<dia>_fin y hor_<dia>_inicio2 / hor_<dia>_fin2.
  const horarios: { dia: number; inicio: string; fin: string }[] = []
  for (let d = 1; d <= 7; d++) {
    const tramos: { inicio: string; fin: string }[] = []
    for (const suf of ['', '2']) {
      const ini = (formData.get(`hor_${d}_inicio${suf}`) as string)?.trim()
      const fin = (formData.get(`hor_${d}_fin${suf}`)    as string)?.trim()
      if (!ini || !fin) continue
      if (ini >= fin) return { ok: false, error: 'En cada tramo la hora de fin debe ser posterior a la de inicio.' }
      tramos.push({ inicio: ini, fin })
    }
    // El segundo tramo empieza después de que acabe el primero: si se pisan, no son
    // dos tramos sino uno mal escrito, y en la agenda saldrían huecos duplicados.
    if (tramos.length === 2 && tramos[1].inicio < tramos[0].fin) {
      return { ok: false, error: 'El segundo tramo del día tiene que empezar después de que acabe el primero.' }
    }
    for (const t of tramos) horarios.push({ dia: d, inicio: t.inicio, fin: t.fin })
  }

  const db = createAdminClient()
  const id = recurso_id || generarRecursoId()

  if (!recurso_id) {
    const { error } = await db.from('recursos').insert({ recurso_id: id, client_id: session.client_id, nombre, tipo, activo, empleado_id })
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await db.from('recursos')
      .update({ nombre, tipo, activo, empleado_id, updated_at: new Date().toISOString() })
      .eq('recurso_id', id).eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
  }

  // Reemplazar servicios asignados
  await db.from('recurso_servicios').delete().eq('recurso_id', id)
  if (servicioIds.length > 0) {
    await db.from('recurso_servicios').insert(servicioIds.map(sid => ({ recurso_id: id, servicio_id: sid })))
  }

  // Reemplazar horarios
  await db.from('recurso_horarios').delete().eq('recurso_id', id).eq('client_id', session.client_id)
  if (horarios.length > 0) {
    await db.from('recurso_horarios').insert(horarios.map(h => ({
      horario_id: generarHorarioId(), recurso_id: id, client_id: session.client_id,
      dia_semana: h.dia, hora_inicio: h.inicio, hora_fin: h.fin,
    })))
  }

  revalidatePath('/portal/citas')
  return { ok: true }
}

export async function eliminarRecurso(recurso_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('agenda'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const { count } = await db.from('reservas')
    .select('reserva_id', { count: 'exact', head: true })
    .eq('client_id', session.client_id).eq('recurso_id', recurso_id)
    .gte('fecha', hoy()).in('estado', ['PENDIENTE', 'CONFIRMADA'])
  if ((count ?? 0) > 0) return { ok: false, error: 'Tiene citas pendientes o confirmadas. Cancélalas antes de eliminarlo.' }

  await db.from('recurso_servicios').delete().eq('recurso_id', recurso_id)
  await db.from('recurso_horarios').delete().eq('recurso_id', recurso_id).eq('client_id', session.client_id)
  await db.from('recurso_ausencias').delete().eq('recurso_id', recurso_id).eq('client_id', session.client_id)
  const { error } = await db.from('recursos').delete()
    .eq('recurso_id', recurso_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/citas')
  return { ok: true }
}

// ── Ausencias del profesional (CIT-4) ──────────────────────────────────────────
//
// `reserva_cierres` es del NEGOCIO: que un barbero libre el martes obligaba a cerrar
// la barbería entera. Esto es del profesional, y vive en su ficha — no en la pantalla
// de cierres, que es justo la confusión que se está corrigiendo.

export async function guardarAusencia(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('agenda'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const recurso_id = (formData.get('recurso_id')  as string)?.trim()
  const desde      = (formData.get('fecha_desde') as string)?.trim()
  const hastaRaw   = (formData.get('fecha_hasta') as string)?.trim()
  const motivo     = (formData.get('motivo')      as string)?.trim() || null

  if (!recurso_id) return { ok: false, error: 'Falta el profesional.' }
  if (!desde)      return { ok: false, error: 'La fecha es obligatoria.' }
  const hasta = hastaRaw || desde
  if (hasta < desde) return { ok: false, error: 'La fecha final no puede ser anterior a la inicial.' }

  const db = createAdminClient()
  // El recurso tiene que ser suyo: el id viene del navegador.
  const { data: rec } = await db.from('recursos').select('recurso_id')
    .eq('recurso_id', recurso_id).eq('client_id', session.client_id).maybeSingle()
  if (!rec) return { ok: false, error: 'Profesional no encontrado.' }

  const { error } = await db.from('recurso_ausencias').insert({
    ausencia_id: generarAusenciaId(), client_id: session.client_id,
    recurso_id, fecha_desde: desde, fecha_hasta: hasta, motivo,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/citas')
  return { ok: true }
}

export async function eliminarAusencia(ausencia_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('agenda'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { error } = await db.from('recurso_ausencias').delete()
    .eq('ausencia_id', ausencia_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/citas')
  return { ok: true }
}

// ── Importar personal desde RRHH (llenado rápido; módulo independiente) ─────────

export async function importarPersonalRRHH(): Promise<{ ok: boolean; error?: string; importados?: number }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('agenda'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  // Gating: solo si el negocio tiene el módulo RRHH contratado
  const { data: cli } = await db.from('clients').select('modulos_activos').eq('client_id', session.client_id).single()
  if (!tieneModulo(cli?.modulos_activos, 'rrhh')) return { ok: false, error: 'El módulo de RRHH no está activo.' }

  // Empleados activos (fecha_baja IS NULL) que aún no estén vinculados a un recurso
  const [{ data: emps }, { data: recs }] = await Promise.all([
    db.from('empleados').select('empleado_id, nombre, apellidos, cargo').eq('client_id', session.client_id).is('fecha_baja', null),
    db.from('recursos').select('empleado_id').eq('client_id', session.client_id).not('empleado_id', 'is', null),
  ])
  const yaLinked = new Set(((recs ?? []) as { empleado_id: string }[]).map(r => r.empleado_id))
  const nuevos = ((emps ?? []) as { empleado_id: string; nombre: string; apellidos: string | null; cargo: string | null }[])
    .filter(e => !yaLinked.has(e.empleado_id))

  if (nuevos.length === 0) return { ok: true, importados: 0 }

  const rows = nuevos.map(e => ({
    recurso_id:  generarRecursoId(),
    client_id:   session.client_id,
    nombre:      [e.nombre, e.apellidos].filter(Boolean).join(' '),
    tipo:        e.cargo ?? null,
    activo:      true,
    empleado_id: e.empleado_id,
  }))
  const { error } = await db.from('recursos').insert(rows)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/citas')
  return { ok: true, importados: nuevos.length }
}

// ── Importar servicios del catálogo (llenado rápido; módulo independiente) ──────

/** Lo que se trae de cada servicio elegido. La duración la pone el dueño, no el sistema. */
export interface ImportarServicioItem {
  producto_id:      string
  duracion_minutos: number
}

/**
 * Trae al catálogo de Citas los servicios elegidos del catálogo comercial.
 *
 * Se importa **lo que se marca**, no todo: un negocio puede facturar veinte servicios y
 * agendar solo tres. Y la **duración se pide** — `products` no la tiene, así que
 * inventarle 30 minutos a todos era agendar mal en silencio (una sesión de 90 min
 * ocupando media hora solapa al profesional).
 */
export async function importarServiciosCatalogo(
  items: ImportarServicioItem[],
): Promise<{ ok: boolean; error?: string; importados?: number }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('agenda'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  if (!Array.isArray(items) || items.length === 0) return { ok: true, importados: 0 }

  const db = createAdminClient()

  // Gating: solo si el negocio tiene contratado algún módulo de catálogo.
  const { data: cli } = await db.from('clients').select('modulos_activos').eq('client_id', session.client_id).single()
  if (!tieneAlgunModulo(cli?.modulos_activos, MODULOS_CATALOGO))
    return { ok: false, error: 'No tienes un catálogo de servicios contratado.' }

  const pedidos = new Map(items.map(i => [i.producto_id, i.duracion_minutos]))

  // Los servicios pedidos que de verdad son suyos, y los que ya están traídos.
  const [{ data: prods }, { data: yaHay }] = await Promise.all([
    db.from('products').select('producto_id, nombre, precios')
      .eq('client_id', session.client_id).eq('tipo', 'SERVICIO').eq('estado', 'ACTIVO')
      .in('producto_id', [...pedidos.keys()]),
    db.from('servicios').select('producto_id')
      .eq('client_id', session.client_id).not('producto_id', 'is', null),
  ])
  const yaLinked = new Set(((yaHay ?? []) as { producto_id: string }[]).map(s => s.producto_id))

  // Moneda de las tarifas: se coge la del catálogo tal cual (la primera con importe).
  // No se convierte nada — el precio del catálogo es un dato, una conversión sería un
  // invento, y aquí el precio es opcional.
  const nuevos = ((prods ?? []) as { producto_id: string; nombre: string; precios: Record<string, number> | null }[])
    .filter(p => !yaLinked.has(p.producto_id))
    .map(p => {
      const tarifa = Object.entries(p.precios ?? {}).find(([, v]) => v != null && Number(v) > 0)
      const dur    = Number(pedidos.get(p.producto_id))
      return {
        servicio_id:      generarServicioId(),
        client_id:        session.client_id,
        nombre:           p.nombre,
        duracion_minutos: !isFinite(dur) || dur < 5 ? 30 : Math.round(dur),
        precio:           tarifa ? Number(tarifa[1]) : null,
        moneda:           tarifa ? tarifa[0] : null,
        producto_id:      p.producto_id,
        activo:           true,
      }
    })

  if (nuevos.length === 0) return { ok: true, importados: 0 }

  const { error } = await db.from('servicios').insert(nuevos)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/citas')
  return { ok: true, importados: nuevos.length }
}

// ── Crear cita (manual, desde el panel) ────────────────────────────────────────

export async function crearCitaManual(formData: FormData, forzar = false): Promise<ResultadoAgenda> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('agenda'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const recurso_id     = (formData.get('recurso_id')     as string)?.trim()
  const servicio_id    = (formData.get('servicio_id')    as string)?.trim()
  const fecha          = (formData.get('fecha')          as string)?.trim()
  const horaRaw        = (formData.get('hora')           as string)?.trim()
  const nombre_cliente = (formData.get('nombre_cliente') as string)?.trim()
  const telefono       = (formData.get('telefono')       as string)?.trim() || null
  const notas          = (formData.get('notas')          as string)?.trim() || null

  if (!recurso_id)     return { ok: false, error: 'Selecciona un recurso o profesional.' }
  if (!servicio_id)    return { ok: false, error: 'Selecciona un servicio.' }
  if (!fecha)          return { ok: false, error: 'La fecha es obligatoria.' }
  if (!horaRaw)        return { ok: false, error: 'La hora es obligatoria.' }
  if (!nombre_cliente) return { ok: false, error: 'El nombre del cliente es obligatorio.' }
  if (fecha < hoy())   return { ok: false, error: 'No se puede crear una cita en una fecha pasada.' }
  if (fecha === hoy() && horaRaw <= horaAhora()) return { ok: false, error: 'Esa hora ya pasó. Elige una hora futura.' }

  const db = createAdminClient()
  const { data: cli } = await db.from('clients').select('bot_config_citas, nombre_empresa').eq('client_id', session.client_id).single()
  const bot = parseBotConfig(cli?.bot_config_citas)
  const reservaId = generarReservaId()

  const { data, error } = await db.rpc('res_crear_cita', {
    p_client_id: session.client_id, p_recurso_id: recurso_id, p_servicio_id: servicio_id,
    p_fecha: fecha, p_hora: horaRaw, p_nombre_cliente: nombre_cliente, p_telefono: telefono, p_notas: notas,
    p_canal: 'manual', p_confirmacion_automatica: bot.confirmacion_automatica, p_reserva_id: reservaId,
    p_forzar: forzar,
  })
  if (error) return { ok: false, error: error.message }
  const result = data as ResultadoAgenda
  if (!result.ok) {
    return { ok: false, error: result.error ?? 'Error al crear la cita.', forzable: result.forzable }
  }

  // CIT-6: aquí se llamaba a `notificarReservaNueva`, así que el dueño recibía en su
  // Telegram —con botones de confirmar/rechazar— un aviso de la cita que acababa de
  // escribir él mismo. Reservas nunca lo hizo. Fuera.

  revalidatePath('/portal/citas')
  return { ok: true, avisos: result.avisos ?? [] }
}

// ── Modificar cita (CIT-1) ─────────────────────────────────────────────────────
//
// No existía. El caso más frecuente de una peluquería —«¿me lo pasas a las 5?»—
// obligaba a CANCELAR (con su aviso de cancelación al cliente, que es un mensaje
// equivocado: no se ha cancelado nada, se ha movido) y crear otra cita.

export async function modificarCita(
  reserva_id: string,
  formData: FormData,
  forzar = false,
): Promise<ResultadoAgenda> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('agenda'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const recurso_id     = (formData.get('recurso_id')     as string)?.trim()
  const servicio_id    = (formData.get('servicio_id')    as string)?.trim()
  const fecha          = (formData.get('fecha')          as string)?.trim()
  const horaRaw        = (formData.get('hora')           as string)?.trim()
  const nombre_cliente = (formData.get('nombre_cliente') as string)?.trim()
  const telefono       = (formData.get('telefono')       as string)?.trim() || null
  const notas          = (formData.get('notas')          as string)?.trim() || null

  if (!recurso_id)     return { ok: false, error: 'Selecciona un recurso o profesional.' }
  if (!servicio_id)    return { ok: false, error: 'Selecciona un servicio.' }
  if (!fecha)          return { ok: false, error: 'La fecha es obligatoria.' }
  if (!horaRaw)        return { ok: false, error: 'La hora es obligatoria.' }
  if (!nombre_cliente) return { ok: false, error: 'El nombre del cliente es obligatorio.' }
  if (fecha < hoy())   return { ok: false, error: 'No se puede mover una cita a una fecha pasada.' }

  const db = createAdminClient()
  const { data, error } = await db.rpc('res_modificar_cita', {
    p_client_id: session.client_id, p_reserva_id: reserva_id,
    p_recurso_id: recurso_id, p_servicio_id: servicio_id,
    p_fecha: fecha, p_hora: horaRaw,
    p_nombre_cliente: nombre_cliente, p_telefono: telefono, p_notas: notas,
    p_forzar: forzar,
  })
  if (error) return { ok: false, error: error.message }
  const result = data as ResultadoAgenda
  if (!result.ok) {
    return { ok: false, error: result.error ?? 'Error al modificar la cita.', forzable: result.forzable }
  }

  // U8: mover una cita no avisaba a nadie. Si el cliente vino por el bot, tiene chat y
  // se le dice; si no, el dueño lo hace con un clic (Fase 10). Nunca correo.
  const { data: cita } = await db.from('reservas')
    .select('telegram_chat_id, personas').eq('reserva_id', reserva_id).eq('client_id', session.client_id).maybeSingle()
  if (cita?.telegram_chat_id) {
    const { data: cli } = await db.from('clients')
      .select('bot_config_citas, nombre_empresa').eq('client_id', session.client_id).single()
    const bot = parseBotConfig(cli?.bot_config_citas)
    if (bot.token && bot.activo) {
      await enviarMensaje(bot.token, cita.telegram_chat_id as string, [
        `🔄 Tu cita ha cambiado — ${(cli?.nombre_empresa as string) ?? 'el negocio'}`,
        `📅 ${fecha}  🕐 ${horaRaw.substring(0, 5)}`,
        'Si no te viene bien, respóndenos.',
      ].join('\n'))
    }
  }

  revalidatePath('/portal/citas')
  return { ok: true, avisos: result.avisos ?? [] }
}

// ── Cambiar estado de una cita ─────────────────────────────────────────────────

export async function cambiarEstadoCita(reserva_id: string, nuevoEstado: EstadoReserva): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('agenda'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: cli } = await db.from('clients').select('bot_config_citas, nombre_empresa').eq('client_id', session.client_id).single()
  const bot = parseBotConfig(cli?.bot_config_citas)

  const r = await transicionarEstado(
    db, session.client_id, reserva_id, nuevoEstado,
    (cli?.nombre_empresa as string) ?? 'Tu cita',
    { token: bot.token, activo: bot.activo, clientId: session.client_id, columna: 'bot_config_citas' },
  )
  if (!r.ok) return r

  revalidatePath('/portal/citas')
  return { ok: true }
}

// ── Cambiar estado en lote (Fase 2) ───────────────────────────────────────────
// Candado `agenda` inline. SECUENCIAL: reutiliza la individual (valida transición
// y avisa al cliente por Telegram). Elegibilidad por CAMBIOS_VALIDOS.

export interface ResultadoLote {
  hechas:   number
  omitidas: { etiqueta: string; motivo: string }[]
  errores:  { etiqueta: string; error: string }[]
  error?:   string
}
const loteVacio = (error?: string): ResultadoLote => ({ hechas: 0, omitidas: [], errores: [], error })

export async function cambiarEstadoCitasEnLote(
  ids: string[], nuevoEstado: EstadoReserva,
): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session)             return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('agenda'))) return loteVacio('No tienes permiso para editar en este módulo.')
  if (!ids.length) return loteVacio()

  const db = createAdminClient()
  const { data: rows } = await db.from('reservas')
    .select('reserva_id, estado, nombre_cliente')
    .eq('client_id', session.client_id).in('reserva_id', ids)

  const res = loteVacio()
  for (const row of (rows ?? []) as { reserva_id: string; estado: EstadoReserva; nombre_cliente: string }[]) {
    const etiqueta = row.nombre_cliente || row.reserva_id
    if (!CAMBIOS_VALIDOS[row.estado]?.includes(nuevoEstado)) {
      res.omitidas.push({ etiqueta, motivo: `no se puede pasar de ${row.estado} a ${nuevoEstado}` }); continue
    }
    const r = await cambiarEstadoCita(row.reserva_id, nuevoEstado)   // secuencial: avisa por Telegram
    if (r.ok) res.hechas++
    else res.errores.push({ etiqueta, error: r.error ?? 'Error' })
  }
  revalidatePath('/portal/citas')
  return res
}

// ── Público: datos de la mini-web de citas ─────────────────────────────────────

export interface ServicioPublico {
  servicio_id: string
  nombre: string
  duracion_minutos: number
  precio: number | null
  moneda: string | null   // sin ella, un precio en CUP se lee como dólares
}
export interface RecursoPublico {
  recurso_id: string
  nombre: string
  servicio_ids: string[]
}
export interface SlotCita {
  recurso_id: string
  recurso_nombre: string
  hora: string  // HH:MM
}
export interface DiaDisponible {
  fecha:        string  // YYYY-MM-DD
  primera_hora: string  // HH:MM — primer hueco del día
  huecos:       number  // nº de horas libres ese día
}

export async function obtenerCitasPublicas(slug: string): Promise<{
  negocio: { nombre: string; logo_url: string | null } | null
  servicios: ServicioPublico[]
  recursos:  RecursoPublico[]
  etiquetas: EtiquetasSector
  client_id: string | null
  reglas:    ReglasReserva
}> {
  const db = createAdminClient()

  const { data: cli } = await db.from('clients')
    .select('client_id, nombre_empresa, sector, etiquetas, modulos_activos, reserva_antelacion_min_horas, reserva_ventana_max_dias, reserva_max_personas')
    .eq('slug', slug).single()

  if (!cli) return { negocio: null, servicios: [], recursos: [], etiquetas: { ...ETIQUETAS_DEFAULT }, client_id: null, reglas: reglasDe(null) }

  // Gating: el negocio debe tener la funcionalidad de citas contratada
  const modulos = Array.isArray(cli.modulos_activos) ? cli.modulos_activos as string[] : []
  if (!modulos.includes('agenda')) {
    return { negocio: null, servicios: [], recursos: [], etiquetas: { ...ETIQUETAS_DEFAULT }, client_id: null, reglas: reglasDe(null) }
  }

  const [srvRes, recRes, empRes] = await Promise.all([
    db.from('servicios').select('servicio_id, nombre, duracion_minutos, precio, moneda').eq('client_id', cli.client_id).eq('activo', true).order('nombre'),
    db.from('recursos').select('recurso_id, nombre').eq('client_id', cli.client_id).eq('activo', true).order('nombre'),
    // COM-5: el enlace compartido es del NEGOCIO. Mismo criterio que el catálogo.
    db.from('empresas').select('logo_url, mostrar_logo').eq('client_id', cli.client_id).limit(1).maybeSingle(),
  ])
  // `recurso_servicios` no tiene `client_id` (tabla puente pura), así que sin acotar se
  // leía la de TODOS los inquilinos — y esta es una ruta PÚBLICA, la frontera dura de
  // rendimiento de Cuba (CONTEXTO §3). Se acota por los recursos de este negocio, que ya
  // están leídos. Va en un segundo viaje a propósito: un viaje acotado es más barato que
  // uno paralelo que crece con el negocio de los demás.
  const recIds = ((recRes.data ?? []) as { recurso_id: string }[]).map(r => r.recurso_id)
  const rsRes = await db.from('recurso_servicios').select('recurso_id, servicio_id')
    .in('recurso_id', recIds.length ? recIds : ['__none__'])

  const linkPorRecurso = new Map<string, string[]>()
  for (const row of (rsRes.data ?? []) as { recurso_id: string; servicio_id: string }[]) {
    const arr = linkPorRecurso.get(row.recurso_id) ?? []
    arr.push(row.servicio_id); linkPorRecurso.set(row.recurso_id, arr)
  }

  return {
    negocio:   {
      nombre:   cli.nombre_empresa as string,
      logo_url: empRes.data?.mostrar_logo ? ((empRes.data?.logo_url as string | null) ?? null) : null,
    },
    servicios: ((srvRes.data ?? []) as ServicioPublico[]).map(s => ({ ...s, duracion_minutos: Number(s.duracion_minutos), precio: s.precio == null ? null : Number(s.precio) })),
    recursos:  ((recRes.data ?? []) as { recurso_id: string; nombre: string }[]).map(r => ({ recurso_id: r.recurso_id, nombre: r.nombre, servicio_ids: linkPorRecurso.get(r.recurso_id) ?? [] })),
    etiquetas: await etiquetasDeSector(db, (cli.sector as string) ?? null, cli.etiquetas),
    client_id: cli.client_id,
    reglas:    reglasDe(cli as Record<string, unknown>),
  }
}

export async function obtenerSlotsCita(
  client_id: string, servicio_id: string, recurso_id: string | null, fecha: string,
): Promise<SlotCita[]> {
  if (!await rateLimitOk('slots_cita', 90, 60)) return []
  const db = createAdminClient()
  const { data, error } = await db.rpc('res_slots_cita', {
    p_client_id: client_id, p_servicio_id: servicio_id, p_recurso_id: recurso_id, p_fecha: fecha,
  })
  if (error || !Array.isArray(data)) return []
  return data as SlotCita[]
}

// Próximos días con hueco para un servicio (+recurso opcional). Una sola llamada
// devuelve hasta ~10 días disponibles, para saltar al primero y pintar la tira
// de fechas — el cliente no adivina cuándo hay sitio.
export async function obtenerDiasDisponiblesCita(
  client_id: string, servicio_id: string, recurso_id: string | null, desde?: string,
): Promise<DiaDisponible[]> {
  if (!await rateLimitOk('dias_cita', 60, 60)) return []
  const db = createAdminClient()
  const { data, error } = await db.rpc('res_dias_disponibles_cita', {
    p_client_id: client_id, p_servicio_id: servicio_id, p_recurso_id: recurso_id,
    p_desde: desde ?? hoy(), p_max_dias: 30,
  })
  if (error || !Array.isArray(data)) return []
  return data as DiaDisponible[]
}

export async function crearCitaPublica(formData: FormData): Promise<{ ok: boolean; error?: string; token?: string; estado?: EstadoReserva }> {
  // Honeypot: campo oculto que solo rellenan los bots → fingir éxito sin crear nada
  if ((formData.get('hp') as string)?.trim()) return { ok: true }

  // Rate limit por IP (anti-spam de citas)
  if (!await rateLimitOk('cita_crear', 5, 300)) {
    return { ok: false, error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }
  }

  const client_id      = (formData.get('client_id')   as string)?.trim()
  const servicio_id    = (formData.get('servicio_id') as string)?.trim()
  const recurso_id     = (formData.get('recurso_id')  as string)?.trim()
  const fecha          = (formData.get('fecha')       as string)?.trim()
  const hora           = (formData.get('hora')        as string)?.trim()
  const nombre_cliente = (formData.get('nombre')      as string)?.trim()
  const telefono       = (formData.get('telefono')    as string)?.trim() || null
  const email          = (formData.get('email')       as string)?.trim() || ''
  const notas          = (formData.get('notas')       as string)?.trim() || null

  if (!client_id)      return { ok: false, error: 'Negocio no identificado.' }
  if (!servicio_id)    return { ok: false, error: 'Selecciona un servicio.' }
  if (!recurso_id)     return { ok: false, error: 'Selecciona un horario.' }
  if (!fecha)          return { ok: false, error: 'Fecha obligatoria.' }
  if (!hora)           return { ok: false, error: 'Hora obligatoria.' }
  if (!nombre_cliente) return { ok: false, error: 'Nombre obligatorio.' }
  // Decisión 1 del plan: CLAUX no escribe al cliente final, así que el correo no puede
  // ser obligatorio (pedía un dato para un canal que no existe). El TELÉFONO sí, que es
  // por donde el negocio le va a llamar — y se exige aquí, no solo en el formulario.
  if (!telefono)       return { ok: false, error: 'Teléfono obligatorio.' }
  if (email && !emailValido(email)) return { ok: false, error: 'Correo no válido.' }
  if (fecha < hoy())   return { ok: false, error: 'No se puede reservar en una fecha pasada.' }
  if (fecha === hoy() && hora <= horaAhora()) return { ok: false, error: 'Esa hora ya pasó. Elige otra.' }

  const db = createAdminClient()
  const { data: cli } = await db.from('clients').select('bot_config_citas, nombre_empresa, modulos_activos').eq('client_id', client_id).single()
  const modulos = Array.isArray(cli?.modulos_activos) ? cli!.modulos_activos as string[] : []
  if (!modulos.includes('agenda')) return { ok: false, error: 'Este negocio no acepta citas en línea.' }

  const bot = parseBotConfig(cli?.bot_config_citas)
  const reservaId = generarReservaId()

  const { data, error } = await db.rpc('res_crear_cita', {
    p_client_id: client_id, p_recurso_id: recurso_id, p_servicio_id: servicio_id,
    p_fecha: fecha, p_hora: hora, p_nombre_cliente: nombre_cliente, p_telefono: telefono, p_notas: notas,
    p_canal: 'web', p_confirmacion_automatica: bot.confirmacion_automatica, p_reserva_id: reservaId,
  })
  if (error) return { ok: false, error: error.message }
  const result = data as { ok: boolean; error?: string }
  if (!result.ok) return { ok: false, error: result.error ?? 'Error al reservar la cita.' }

  // Correo del cliente: se guarda tras la inserción atómica (no es columna de la RPC).
  await db.from('reservas').update({ email }).eq('reserva_id', reservaId)

  await notificarReservaNueva(
    { token: bot.token, activo: bot.activo, notificar_owner_chat_id: bot.notificar_owner_chat_id,
      clientId: client_id, columna: 'bot_config_citas' },
    { reserva_id: reservaId, fecha, hora, personas: 1, nombre_cliente, telefono, notas,
      estado: bot.confirmacion_automatica ? 'CONFIRMADA' : 'PENDIENTE', telegram_chat_id: null },
    (cli?.nombre_empresa as string) ?? 'Tu negocio',
  )

  // Bandeja interna del portal (además del aviso de Telegram, que exige bot).
  await notificarReservaEntrante({
    clientId: client_id, reservaId, modo: 'cita',
    nombreCliente: nombre_cliente, fecha, hora,
    pendiente: !bot.confirmacion_automatica,
  })

  // Token público para que el cliente pueda gestionar/cancelar su cita
  const { data: tk } = await db.from('reservas').select('token').eq('reserva_id', reservaId).single()

  return {
    ok: true,
    token: (tk?.token as string) ?? undefined,
    estado: bot.confirmacion_automatica ? 'CONFIRMADA' : 'PENDIENTE',
  }
}

// ── Bot de Telegram de Citas (independiente del de Reservas) ───────────────────

export async function guardarBotConfigCitas(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('agenda'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const r = await guardarBotConfigCol(createAdminClient(), session.client_id, 'bot_config_citas', {
    token:                  (formData.get('token')  as string)?.trim() || null,
    nombre:                 (formData.get('nombre') as string)?.trim() || null,
    activo:                 formData.get('activo') === 'true',
    confirmacionAutomatica: formData.get('confirmacion_automatica') === 'true',
  })
  if (!r.ok) return r
  revalidatePath('/portal/citas')
  return { ok: true }
}

export async function guardarConfirmacionCitas(activa: boolean): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('agenda'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const r = await guardarConfirmacionCol(createAdminClient(), session.client_id, 'bot_config_citas', activa)
  if (!r.ok) return r
  revalidatePath('/portal/citas')
  return { ok: true }
}

export async function toggleActivoBotCitas(activo: boolean): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('agenda'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const r = await toggleActivoBotCol(createAdminClient(), session.client_id, 'bot_config_citas', activo)
  if (!r.ok) return r
  revalidatePath('/portal/citas')
  return { ok: true }
}

export async function toggleIaBotCitas(activa: boolean): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('agenda'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: cli } = await db.from('clients').select('modulos_activos').eq('client_id', session.client_id).single()
  if (!tieneModulo(cli?.modulos_activos, 'asistente_ia')) return { ok: false, error: 'El asistente IA no está contratado.' }

  const r = await guardarIaActivaCol(db, session.client_id, 'bot_config_citas', activa)
  if (!r.ok) return r
  revalidatePath('/portal/citas')
  return { ok: true }
}

export async function eliminarBotConfigCitas(): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('agenda'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const r = await eliminarBotConfigCol(createAdminClient(), session.client_id, 'bot_config_citas')
  if (!r.ok) return r
  revalidatePath('/portal/citas')
  return { ok: true }
}
