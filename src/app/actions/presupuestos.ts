'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { TOPE_VER_MAS } from '@/lib/listados'
import { requirePermiso } from '@/lib/admin-guard'
import { logActividad } from '@/lib/audit'
import { revalidatePath } from 'next/cache'
import { calcularInstalacion } from '@/lib/presupuesto/calculo'
import { cargarParametros } from '@/lib/presupuesto/parametros'
import { FORMATOS, etiquetaFase, numeroPresupuesto, type FormatoDatos, type NumeroFase } from '@/lib/presupuesto/config'
import { COLUMNAS_PRECIO, normalizarNivel, sumarModulos, type Nivel, type ModuloPrecios } from '@/lib/niveles'
import { importeClaux, normalizarMonedaClaux, type MonedaClaux } from '@/lib/moneda-claux'
import { hoyEnTz } from '@/lib/fecha-tz'
import { avisoPropuestas, propuestasDe, refrescarPropuestas, refrescarPropuestasDe } from '@/lib/propuesta/refrescar'
import { obtenerCatalogoPublico } from '@/lib/publico/catalogo'
import { tamanoComoTexto } from '@/lib/publico/tamano'
import { etiquetaModo } from '@/lib/publico/modos'
import {
  proponerEntradasLead, revisarPresupuesto,
  type CasoCerrado, type EntradaLead, type RevisionPresupuesto,
} from '@/lib/ia/equipo'
import { IaApagada, IaBolsaAgotada } from '@/lib/ia/interna'
import type { PropuestaIa } from '@/lib/ia/propuesta'

export interface ModuloPresupuesto extends ModuloPrecios {
  clave:   string
  nombre:  string
  tipo:    string
  es_base: boolean
}

export interface Comercial {
  email:  string
  nombre: string
}

export interface MigracionInput {
  desea:       boolean
  desde?:      string | null
  hasta?:      string | null
  volumen?:    number | null
  horasManual?: number | null
}

export interface CrearPresupuestoInput {
  diagnosticoId?:     number | null
  clientId?:          string | null
  comercialEmail?:    string
  comercialNombre?:   string
  nombreNegocio:      string
  nombreResponsable?: string
  contacto?:          string
  /** Solo elige el precio de los MÓDULOS (cuota mensual). La hora de instalación tiene
   *  tarifa/hora única, configurable y negociable por cliente. */
  nivel:              Nivel
  /** En qué moneda se emite. Es una decisión comercial del presupuesto, no del cliente:
   *  el mismo negocio puede tener uno en euros y otro en dólares (y elegir después). */
  moneda:             MonedaClaux
  modulos:            string[]
  volumenes:          Record<string, number>
  formato:            FormatoDatos
  migracion:          MigracionInput
  /** Tarifa/hora pactada con este cliente; si falta, la base de configuración. */
  tarifaHora?:        number
  descuentoPct?:      number
  descuentoMotivo?:   string
  /** Fases que este cliente no contrata (1-4). Vacío = las cuatro. */
  fasesExcluidas?:    number[]
}

export interface PresupuestoRow {
  id:                    number
  created_at:            string
  comercial_nombre:      string | null
  nombre_negocio:        string
  contacto:              string | null
  nivel:             string
  moneda:            MonedaClaux
  horas_total:       number
  coste_instalacion: number
  cuota_mensual:     number
  horas_reales:      number | null
  estado:            string
  client_id:         string | null
  tarifa_hora:       number
  descuento_pct:     number
  total_final:       number
}

// Las columnas del listado, en un sitio: la ficha del cliente y el listado general
// leen lo mismo y se desincronizaban a mano cada vez que aparecía una columna.
const COLUMNAS_LISTADO =
  'id, created_at, comercial_nombre, nombre_negocio, contacto, nivel, moneda, horas_total, '
  + 'coste_instalacion, cuota_mensual, horas_reales, estado, client_id, tarifa_hora, '
  + 'descuento_pct, total_final'

// ── Catálogo de módulos activos (en vivo) para el formulario ──
export async function listarModulosParaPresupuesto(): Promise<ModuloPresupuesto[]> {
  await requirePermiso('presupuestos')
  const db = createAdminClient()
  const { data } = await db
    .from('modulos_catalogo')
    .select(`clave, nombre, tipo, es_base, ${COLUMNAS_PRECIO}`)
    .eq('activo', true)
    .order('orden')
  return (data ?? []) as ModuloPresupuesto[]
}

// ── Lista de comerciales (usuarios internos activos ∪ super admins bootstrap) ──
export async function listarComerciales(): Promise<Comercial[]> {
  await requirePermiso('presupuestos')
  const db = createAdminClient()
  const { data } = await db
    .from('admin_users')
    .select('email, nombre, activo')
    .eq('activo', true)

  const mapa = new Map<string, Comercial>()
  for (const u of data ?? []) {
    mapa.set(u.email, { email: u.email, nombre: u.nombre || u.email })
  }
  // Super admins de bootstrap (ADMIN_EMAILS) que quizá no tengan fila.
  const raw = process.env.ADMIN_EMAILS?.trim()
  if (raw) {
    for (const e of raw.split(',').map(x => x.trim().toLowerCase()).filter(Boolean)) {
      if (!mapa.has(e)) mapa.set(e, { email: e, nombre: e.split('@')[0] })
    }
  }
  return Array.from(mapa.values()).sort((a, b) => a.nombre.localeCompare(b.nombre))
}

// ── Cuota mensual (Σ precios de módulos contratados por la columna del nivel, en vivo) ──
async function calcularCuotaMensual(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, modulos: string[], nivel: Nivel, moneda: MonedaClaux,
): Promise<number> {
  const { data } = await db
    .from('modulos_catalogo')
    .select(`clave, ${COLUMNAS_PRECIO}`)
    .eq('activo', true)
  return sumarModulos((data ?? []) as ModuloPrecios[], modulos, nivel, moneda)
}

// ── Listar presupuestos guardados ──
export async function listarPresupuestos(): Promise<PresupuestoRow[]> {
  await requirePermiso('presupuestos')
  const db = createAdminClient()
  const { data } = await db
    .from('presupuestos_instalacion')
    .select(COLUMNAS_LISTADO)
    // TECHO EXPLÍCITO: sin `.limit()` lo pone PostgREST por su cuenta y recorta sin
    // decir nada. Escrito aquí, el día que la cifra se acerque se ve en el código y no
    // en una lista a la que le faltan filas.
    .order('created_at', { ascending: false })
    .limit(TOPE_VER_MAS)
  return (data ?? []) as unknown as PresupuestoRow[]
}

/**
 * Presupuestos de UN cliente, para su ficha.
 *
 * El enlace `presupuestos_instalacion.client_id` existía y se escribía desde el alta, pero no
 * se veía desde el cliente: se podía ir del presupuesto a la ficha y no al revés. Y sin la
 * vuelta no hay forma de contrastar lo cotizado con lo que costó de verdad.
 */
export async function listarPresupuestosDeCliente(clientId: string): Promise<PresupuestoRow[]> {
  await requirePermiso('presupuestos')
  const db = createAdminClient()
  const { data } = await db
    .from('presupuestos_instalacion')
    .select(COLUMNAS_LISTADO)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(TOPE_VER_MAS)
  return (data ?? []) as unknown as PresupuestoRow[]
}

// ── Detalle completo de un presupuesto ──
export async function obtenerPresupuesto(id: number) {
  await requirePermiso('presupuestos')
  const db = createAdminClient()
  const { data } = await db
    .from('presupuestos_instalacion')
    // Traemos el diagnóstico de origen: el correo (contacto principal) y el sector
    // solo viven ahí, y son los que precargan el alta de cliente.
    .select('*, diagnosticos ( email, sector )')
    .eq('id', id)
    .maybeSingle()
  return data
}

// ── Validación + recálculo autoritativo, compartido por crear y actualizar ──
//
// RECÁLCULO AUTORITATIVO con los parámetros del servidor: lo que llegue del navegador es una
// propuesta, no el precio. El nivel pactado sí se respeta —es la palanca comercial—, pero las
// horas se vuelven a calcular aquí. Las fases excluidas viajan con el resto: si el recálculo
// del servidor las ignorara, guardaría un presupuesto más caro que el que el comercial acaba de
// enseñar en pantalla.
type SnapshotPresupuesto = {
  nivel:           Nivel
  moneda:          MonedaClaux
  nombreNegocio:   string
  descuentoPct:    number
  descuentoMotivo: string
  cuotaMensual:    number
  resultado:       ReturnType<typeof calcularInstalacion>
}

async function calcularSnapshotPresupuesto(
  db: ReturnType<typeof createAdminClient>,
  input: CrearPresupuestoInput,
): Promise<{ ok: false; error: string } | { ok: true; snap: SnapshotPresupuesto }> {
  const nombreNegocio = (input.nombreNegocio || '').trim()
  if (!nombreNegocio) return { ok: false, error: 'El nombre del negocio es obligatorio.' }
  const nivel: Nivel = normalizarNivel(input.nivel)
  const moneda = normalizarMonedaClaux(input.moneda)

  // Un descuento sin motivo es un descuento que dentro de tres meses nadie sabe explicar:
  // por qué ESTE cliente pagó $700 y no $1.000 es justo lo que hay que poder mirar después.
  const descuentoPct = Math.min(100, Math.max(0, Number(input.descuentoPct) || 0))
  const descuentoMotivo = (input.descuentoMotivo || '').trim()
  if (descuentoPct > 0 && !descuentoMotivo) {
    return { ok: false, error: 'Un descuento necesita su motivo.' }
  }

  const historicoHorasManual = input.migracion?.desea ? Number(input.migracion?.horasManual ?? 0) || 0 : 0
  const fasesExcluidas = (input.fasesExcluidas ?? [])
    .map(Number)
    .filter(n => n >= 1 && n <= 4)

  const parametros = await cargarParametros()
  const resultado = calcularInstalacion({
    modulos:   input.modulos ?? [],
    volumenes: input.volumenes ?? {},
    formato:   input.formato,
    moneda,
    historicoHorasManual,
    tarifaHoraOverride: Number(input.tarifaHora) || 0,
    descuentoPct,
    fasesExcluidas,
  }, parametros)

  const cuotaMensual = await calcularCuotaMensual(db, input.modulos ?? [], nivel, moneda)

  return { ok: true, snap: { nivel, moneda, nombreNegocio, descuentoPct, descuentoMotivo, cuotaMensual, resultado } }
}

// ── El cobro de configuración sigue a su presupuesto ─────────────────────────
//
// El pago único de instalación se creaba en el alta con la cifra que tenía el
// presupuesto ESE día y ahí se quedaba: editar el borrador o aprobar otro
// presupuesto no lo movía, así que al cliente le llegaba —en su panel, en
// Suscripción— el número viejo. La regla que cierra el agujero:
//
//   un cobro de configuración POR CONFIRMAR ligado a un presupuesto vale
//   siempre lo que vale ese presupuesto; en cuanto se CONFIRMA (el dinero
//   entró) se congela y no lo toca nadie.
//
// Solo actúa sobre presupuestos que ya tienen cliente: antes del alta no hay a
// quién cobrarle.
type AccionCobro = 'ninguna' | 'creado' | 'actualizado' | 'eliminado' | 'congelado'

interface ResultadoCobro {
  accion:  AccionCobro
  /** Importe que ha quedado (o el del cobro congelado, para poder avisar). */
  monto?:  number
  moneda?: MonedaClaux
  pagoId?: string
}

/** Lo que le pasó al cobro, en una frase para el toast (null = no pasó nada que contar). */
function avisoCobro(r: ResultadoCobro): string | null {
  const imp = (n?: number) => importeClaux(n ?? 0, r.moneda)
  if (r.accion === 'actualizado') return `El cobro de configuración pasa a ${imp(r.monto)}.`
  if (r.accion === 'creado')      return `Se creó el cobro de configuración ${r.pagoId} por ${imp(r.monto)} (por confirmar).`
  if (r.accion === 'eliminado')   return `Se retiró el cobro de configuración: el presupuesto queda en ${imp(0)}.`
  if (r.accion === 'congelado')   return `El cobro de configuración (${imp(r.monto)}) ya está confirmado y no se modifica. Si procede, se ajusta manualmente.`
  return null
}

/** Un cobro ya confirmado que deja de cuadrar es lo único que exige mano humana. */
function tonoCobro(r: ResultadoCobro): 'info' | 'warning' {
  return r.accion === 'congelado' ? 'warning' : 'info'
}

/** Los avisos del guardado en una sola línea. El del cobro va primero: toca dinero. */
function juntar(...avisos: (string | null)[]): string | null {
  const vivos = avisos.filter((a): a is string => !!a)
  return vivos.length > 0 ? vivos.join(' ') : null
}

/** Siguiente `pago_id` correlativo (PAG-0001, PAG-0002…). */
async function siguientePagoId(db: ReturnType<typeof createAdminClient>): Promise<string> {
  const { data } = await db
    .from('payments').select('pago_id').order('pago_id', { ascending: false }).limit(1).maybeSingle()
  const m = data?.pago_id?.match(/PAG-(\d+)/)
  const n = m ? parseInt(m[1], 10) + 1 : 1
  return `PAG-${String(n).padStart(4, '0')}`
}

async function sincronizarCobroConfiguracion(
  db: ReturnType<typeof createAdminClient>,
  presupuestoId: number,
  ctx: { email: string },
): Promise<ResultadoCobro> {
  const { data: pres } = await db
    .from('presupuestos_instalacion')
    .select('id, client_id, estado, total_final, moneda, nombre_negocio')
    .eq('id', presupuestoId)
    .maybeSingle()
  if (!pres?.client_id) return { accion: 'ninguna' }

  const total = Number(pres.total_final) || 0
  // El cobro hereda la moneda DEL PRESUPUESTO, no la de facturación del cliente:
  // la instalación se pactó en una cifra concreta y esa cifra no se reetiqueta
  // porque el cliente decida pagar la cuota en la otra moneda (decisión del dueño:
  // puede tener presupuestos en las dos a la vez).
  const moneda = normalizarMonedaClaux(pres.moneda)
  // Un BORRADOR no es un compromiso: puede mover el cobro que ya es suyo, pero no
  // adoptar uno suelto ni inventarse uno nuevo. Si no, editar un presupuesto en
  // negociación le dejaría al cliente un «pendiente» en su panel —o peor, le
  // robaría al cobro vivo la cifra del presupuesto que sí está aprobado.
  const esCompromiso = pres.estado === 'aprobado' || pres.estado === 'instalado'

  // El cobro de ESTE presupuesto. Si no lo hay, se adopta el que dejó el alta
  // sin ligar (dato anterior a la mig. 204): es el mismo cobro, sin etiqueta.
  const { data: propio } = await db
    .from('payments')
    .select('pago_id, estado, monto, moneda')
    .eq('presupuesto_id', presupuestoId)
    .eq('concepto', 'configuracion')
    // Si por lo que sea hubiera dos, manda el confirmado ('confirmado' < 'por_confirmar'):
    // ante la duda se congela y se avisa, nunca se crea un cobro de más.
    .order('estado', { ascending: true })
    .limit(1)
    .maybeSingle()

  let cobro = propio
  if (!cobro && esCompromiso) {
    const { data: suelto } = await db
      .from('payments')
      .select('pago_id, estado, monto, moneda')
      .eq('client_id', pres.client_id)
      .eq('concepto', 'configuracion')
      .eq('estado', 'por_confirmar')
      .is('presupuesto_id', null)
      .order('fecha', { ascending: true })
      .limit(1)
      .maybeSingle()
    cobro = suelto
  }

  // Confirmado = dinero cobrado: es un hecho, no una previsión. Se devuelve para
  // que quien llame pueda avisar de que la cifra ya no cuadra con el presupuesto.
  if (cobro && cobro.estado !== 'por_confirmar') {
    return { accion: 'congelado', monto: Number(cobro.monto) || 0, moneda: normalizarMonedaClaux(cobro.moneda), pagoId: cobro.pago_id }
  }

  // Presupuesto a cero (100% de descuento, cortesía): no hay nada que cobrar, y
  // un cobro de $0 en la ficha del cliente es ruido que alguien tendría que ir
  // tachando a mano.
  if (total <= 0) {
    if (!cobro) return { accion: 'ninguna' }
    await db.from('payments').delete().eq('pago_id', cobro.pago_id)
    await logActividad(db, {
      user_email: ctx.email, entity: 'pago', entity_id: cobro.pago_id, action: 'eliminar',
      description: `Eliminó el cobro de configuración ${cobro.pago_id} — el presupuesto de ${pres.nombre_negocio} queda en ${importeClaux(0, moneda)}`,
    })
    return { accion: 'eliminado', moneda, pagoId: cobro.pago_id }
  }

  if (cobro) {
    const antes       = Number(cobro.monto) || 0
    const monedaAntes = normalizarMonedaClaux(cobro.moneda)
    await db.from('payments')
      .update({ monto: total, moneda, presupuesto_id: presupuestoId })
      .eq('pago_id', cobro.pago_id)
    // Mismo importe en otra moneda NO es «sin cambios»: $700 y €700 son cifras
    // distintas aunque el número coincida, y con la siembra a la par coinciden mucho.
    if (monedaAntes === moneda && Math.abs(antes - total) < 0.005) {
      return { accion: 'ninguna', monto: total, moneda, pagoId: cobro.pago_id }
    }
    await logActividad(db, {
      user_email: ctx.email, entity: 'pago', entity_id: cobro.pago_id, action: 'editar',
      description: `Ajustó el cobro de configuración ${cobro.pago_id} de ${importeClaux(antes, monedaAntes)} a ${importeClaux(total, moneda)} — presupuesto de ${pres.nombre_negocio}`,
    })
    return { accion: 'actualizado', monto: total, moneda, pagoId: cobro.pago_id }
  }

  // No hay cobro que ajustar: se crea, y solo si el presupuesto ya es un
  // compromiso (aprobado). Al cliente de PRUEBA tampoco, que no es una venta
  // — igual que en el alta (`crearCliente`), para no dejarle una deuda eterna
  // en cuentas por cobrar.
  if (!esCompromiso) return { accion: 'ninguna' }

  const { data: cli } = await db
    .from('clients').select('es_prueba').eq('client_id', pres.client_id).maybeSingle()
  if (cli?.es_prueba) return { accion: 'ninguna' }

  const pagoId = await siguientePagoId(db)
  const { error } = await db.from('payments').insert({
    pago_id:        pagoId,
    client_id:      pres.client_id,
    presupuesto_id: presupuestoId,
    concepto:       'configuracion',
    estado:         'por_confirmar',
    monto:          total,
    moneda,
    metodo:         'transferencia',
    fecha:          hoyEnTz(),
    notas:          'Pago único de configuración inicial',
  })
  if (error) return { accion: 'ninguna' }

  await logActividad(db, {
    user_email: ctx.email, entity: 'pago', entity_id: pagoId, action: 'registrar',
    description: `Pre-creó el cobro de configuración ${pagoId} (por confirmar) — ${importeClaux(total, moneda)} del presupuesto de ${pres.nombre_negocio}`,
  })
  return { accion: 'creado', monto: total, moneda, pagoId }
}

// ── Crear (guardar) un presupuesto: recálculo autoritativo en servidor ──
export async function crearPresupuesto(
  input: CrearPresupuestoInput,
): Promise<{ ok: boolean; id?: number; error?: string }> {
  const ctx = await requirePermiso('presupuestos')
  const db = createAdminClient()

  const calc = await calcularSnapshotPresupuesto(db, input)
  if (!calc.ok) return { ok: false, error: calc.error }
  const { nivel, moneda, nombreNegocio, descuentoPct, descuentoMotivo, cuotaMensual, resultado } = calc.snap

  const { data, error } = await db
    .from('presupuestos_instalacion')
    .insert({
      diagnostico_id:        input.diagnosticoId ?? null,
      client_id:             input.clientId ?? null,
      comercial_email:       input.comercialEmail ?? ctx.email,
      comercial_nombre:      input.comercialNombre ?? ctx.nombre,
      nombre_negocio:        nombreNegocio,
      nombre_responsable:    (input.nombreResponsable || '').trim() || null,
      contacto:              (input.contacto || '').trim() || null,
      nivel,
      moneda,
      modulos:               input.modulos ?? [],
      volumenes:             input.volumenes ?? {},
      formato_datos:         input.formato,
      // Sin migración de histórico no se guardan sus datos: una fila que dice «no la quiere»
      // y a la vez lleva período y 10h estimadas es un registro que se contradice solo, y el
      // que luego se lee para saber qué se le vendió.
      migracion:             input.migracion?.desea ? input.migracion : { desea: false },
      desglose:              resultado.desglose,
      revisiones:            resultado.revisiones,
      horas_total:           resultado.horasTotal,
      coste_instalacion: resultado.costeInstalacion,
      cuota_mensual:     cuotaMensual,
      // Snapshot de lo negociado: un presupuesto de hace tres meses tiene que seguir
      // explicando su propio número cuando cambie la tarifa base.
      tarifa_hora:       resultado.tarifaHora,
      descuento_pct:         descuentoPct,
      descuento_motivo:      descuentoMotivo || null,
      total_final:       resultado.totalFinal,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message }

  await logActividad(db, {
    user_email:  ctx.email,
    entity:      'presupuesto',
    entity_id:   String(data.id),
    action:      'crear',
    description: `Guardó presupuesto de ${nombreNegocio} — ${resultado.horasTotal}h · ${importeClaux(resultado.totalFinal, moneda)} instalación${descuentoPct > 0 ? ` (${descuentoPct}% dto.: ${descuentoMotivo})` : ''} · ${importeClaux(cuotaMensual, moneda)}/mes`,
  })

  revalidatePath('/admin/presupuestos')
  return { ok: true, id: data.id }
}

// ── Editar un presupuesto en borrador (solo estado 'guardado') ──
//
// Un presupuesto es la foto de lo pactado: una vez APROBADO se congela (es la prueba de lo que
// se le enseñó al cliente) y una vez INSTALADO ya tiene horas reales registradas. Editar solo
// tiene sentido mientras es un borrador. Para cambiar uno aprobado se le quita la aprobación
// antes, o se crea uno nuevo. El recálculo es el mismo autoritativo que al crear.
export async function actualizarPresupuesto(
  id: number, input: CrearPresupuestoInput,
): Promise<{ ok: boolean; id?: number; error?: string; aviso?: string | null; avisoTono?: 'info' | 'warning' }> {
  const ctx = await requirePermiso('presupuestos')
  const db = createAdminClient()

  const { data: actual } = await db
    .from('presupuestos_instalacion')
    .select('estado')
    .eq('id', id)
    .maybeSingle()
  if (!actual) return { ok: false, error: 'Presupuesto no encontrado.' }
  if (actual.estado !== 'guardado') {
    return { ok: false, error: 'Solo se puede editar un presupuesto en borrador. Quítale la aprobación para poder editarlo.' }
  }

  const calc = await calcularSnapshotPresupuesto(db, input)
  if (!calc.ok) return { ok: false, error: calc.error }
  const { nivel, moneda, nombreNegocio, descuentoPct, descuentoMotivo, cuotaMensual, resultado } = calc.snap

  // No se tocan `diagnostico_id`, `client_id`, `estado`, `horas_reales` ni `created_at`: son la
  // identidad y el ciclo de vida del presupuesto, no lo que se está reeditando.
  const { error } = await db
    .from('presupuestos_instalacion')
    .update({
      comercial_email:       input.comercialEmail ?? ctx.email,
      comercial_nombre:      input.comercialNombre ?? ctx.nombre,
      nombre_negocio:        nombreNegocio,
      nombre_responsable:    (input.nombreResponsable || '').trim() || null,
      contacto:              (input.contacto || '').trim() || null,
      nivel,
      moneda,
      modulos:               input.modulos ?? [],
      volumenes:             input.volumenes ?? {},
      formato_datos:         input.formato,
      migracion:             input.migracion?.desea ? input.migracion : { desea: false },
      desglose:              resultado.desglose,
      revisiones:            resultado.revisiones,
      horas_total:           resultado.horasTotal,
      coste_instalacion: resultado.costeInstalacion,
      cuota_mensual:     cuotaMensual,
      tarifa_hora:       resultado.tarifaHora,
      descuento_pct:         descuentoPct,
      descuento_motivo:      descuentoMotivo || null,
      total_final:       resultado.totalFinal,
      updated_at:            new Date().toISOString(),
    })
    .eq('id', id)
    // Candado de concurrencia: si entre la carga y el guardado alguien lo aprobó, no se pisa.
    .eq('estado', 'guardado')
  if (error) return { ok: false, error: error.message }

  await logActividad(db, {
    user_email:  ctx.email,
    entity:      'presupuesto',
    entity_id:   String(id),
    action:      'editar',
    description: `Editó el presupuesto de ${nombreNegocio} — ${resultado.horasTotal}h · ${importeClaux(resultado.totalFinal, moneda)} instalación${descuentoPct > 0 ? ` (${descuentoPct}% dto.: ${descuentoMotivo})` : ''} · ${importeClaux(cuotaMensual, moneda)}/mes`,
  })

  // El cobro por confirmar que cuelga de este presupuesto se mueve con él: si no,
  // el cliente sigue viendo en su panel la cifra del borrador anterior.
  const cobro = await sincronizarCobroConfiguracion(db, id, ctx)

  // La propuesta que enseña este presupuesto no guarda copia de sus cifras: hay
  // que tirarle la caché o seguiría enseñando el precio de antes.
  const propuestas = await refrescarPropuestasDe(db, id)

  revalidatePath('/admin/presupuestos')
  revalidatePath('/admin/pagos')
  return {
    ok: true, id,
    aviso: juntar(avisoCobro(cobro), avisoPropuestas(propuestas)),
    avisoTono: tonoCobro(cobro),
  }
}

// ── Aprobar / desaprobar un presupuesto ──
// 'aprobado' = el cliente aceptó la oferta; habilita crear el cliente desde aquí.
// No se puede tocar un presupuesto ya 'instalado' (tiene horas reales registradas).
export async function aprobarPresupuesto(
  id: number, aprobado: boolean,
): Promise<{ ok: boolean; error?: string; aviso?: string | null; avisoTono?: 'info' | 'warning' }> {
  const ctx = await requirePermiso('presupuestos')
  const db = createAdminClient()

  const { data: actual } = await db
    .from('presupuestos_instalacion')
    .select('estado, nombre_negocio')
    .eq('id', id)
    .maybeSingle()
  if (!actual) return { ok: false, error: 'Presupuesto no encontrado.' }
  if (actual.estado === 'instalado') {
    return { ok: false, error: 'El presupuesto ya está instalado; no se puede cambiar la aprobación.' }
  }

  const nuevoEstado = aprobado ? 'aprobado' : 'guardado'
  const { error } = await db
    .from('presupuestos_instalacion')
    .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }

  await logActividad(db, {
    user_email:  ctx.email,
    entity:      'presupuesto',
    entity_id:   String(id),
    action:      aprobado ? 'aprobar' : 'desaprobar',
    description: `${aprobado ? 'Aprobó' : 'Quitó la aprobación del'} presupuesto de ${actual.nombre_negocio}`,
  })

  // Aprobar es el momento en que la cifra se vuelve un compromiso: el cobro de
  // configuración pendiente pasa a decir exactamente eso. Al QUITAR la aprobación
  // no se toca —borrar registros de dinero por un clic no— pero el admin ya puede
  // eliminarlo desde la ficha del cliente.
  const cobro = aprobado
    ? await sincronizarCobroConfiguracion(db, id, ctx)
    : { accion: 'ninguna' as const }

  // Aprobar no cambia las cifras, pero sí la diapositiva de fases (el sello del
  // presupuesto) y la fecha «Actualizada el…» de la portada.
  const propuestas = await refrescarPropuestasDe(db, id)

  revalidatePath('/admin/presupuestos')
  revalidatePath('/admin/pagos')
  return {
    ok: true,
    aviso: juntar(avisoCobro(cobro), avisoPropuestas(propuestas)),
    avisoTono: tonoCobro(cobro),
  }
}

// ── Eliminar un presupuesto (solo borradores) ──
//
// Un presupuesto se hace delante del cliente y a veces sale mal: se cotiza el
// negocio equivocado, se duplica al probar, se guarda a medias. Hasta ahora no
// había forma de quitarlo y la lista se llenaba de ruido que además compite por
// ser «el presupuesto de ese cliente».
//
// Solo el BORRADOR. Un `aprobado` es la prueba de lo que se pactó y un
// `instalado` tiene horas reales detrás: eso no se borra, se desaprueba o se
// deja. Y si tiene un cobro colgando se dice que no: la FK es `on delete set
// null`, así que borrarlo dejaría un cobro huérfano en silencio — que es
// exactamente el desajuste que estamos cerrando.
export async function eliminarPresupuesto(
  id: number,
): Promise<{ ok: boolean; error?: string; yaEliminado?: boolean }> {
  const ctx = await requirePermiso('presupuestos')
  const db = createAdminClient()

  const { data: pres } = await db
    .from('presupuestos_instalacion')
    .select('id, estado, nombre_negocio, client_id, total_final, moneda')
    .eq('id', id)
    .maybeSingle()
  // El listado puede estar abierto en otra pestaña. Si ya se eliminó allí, tratar
  // la operación como idempotente permite limpiar la fila obsoleta al refrescar.
  if (!pres) return { ok: true, yaEliminado: true }
  if (pres.estado !== 'guardado') {
    return {
      ok: false,
      error: pres.estado === 'instalado'
        ? 'Un presupuesto instalado no se elimina: tiene horas reales registradas.'
        : 'Un presupuesto aprobado no se elimina. Quítale la aprobación primero si de verdad hay que rectificarlo.',
    }
  }

  const { data: cobro } = await db
    .from('payments')
    .select('pago_id')
    .eq('presupuesto_id', id)
    .limit(1)
    .maybeSingle()
  if (cobro) {
    return {
      ok: false,
      error: `Tiene el cobro ${cobro.pago_id} enlazado. Resuélvelo en la ficha del cliente (ajustarlo o eliminarlo) antes de borrar el presupuesto.`,
    }
  }

  // Las propuestas se leen AQUÍ, antes de borrar: la FK es `on delete set null`
  // y después de borrar ya no hay ninguna fila que referencie a este id.
  const propuestas = await propuestasDe(db, id)

  const { data: eliminado, error } = await db
    .from('presupuestos_instalacion')
    .delete()
    .eq('id', id)
    // Candado de concurrencia: si alguien lo aprobó mientras se confirmaba, no se borra.
    .eq('estado', 'guardado')
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!eliminado || eliminado.length === 0) {
    const { data: sigue } = await db
      .from('presupuestos_instalacion')
      .select('estado')
      .eq('id', id)
      .maybeSingle()
    if (!sigue) return { ok: true, yaEliminado: true }
    return { ok: false, error: 'El presupuesto cambió mientras se eliminaba. Actualiza la lista.' }
  }

  await logActividad(db, {
    user_email:  ctx.email,
    entity:      'presupuesto',
    entity_id:   String(id),
    action:      'eliminar',
    description: `Eliminó el borrador de presupuesto de ${pres.nombre_negocio} — ${importeClaux(pres.total_final, pres.moneda)} de instalación${pres.client_id ? ` · ${pres.client_id}` : ''}`,
  })

  // La propuesta no se rompe al borrar el presupuesto: se queda sin la
  // diapositiva del importe. Pero si no se refresca, sigue enseñando las cifras
  // de algo que ya no existe.
  refrescarPropuestas(propuestas)

  revalidatePath('/admin/presupuestos')
  if (pres.client_id) revalidatePath(`/admin/clientes/${pres.client_id}`)
  return { ok: true }
}

// ── Poner el cobro de configuración al día con su presupuesto (a mano) ──
//
// La reparación de lo que quedó descuadrado antes de que el cobro siguiera al
// presupuesto: se dispara desde el historial de pagos de la ficha del cliente,
// donde es donde se ve la discrepancia. Toca dinero, así que pide permiso de
// Pagos, no de Presupuestos.
export async function ajustarCobroConfiguracion(
  presupuestoId: number,
): Promise<{ ok: boolean; error?: string; aviso?: string | null }> {
  const ctx = await requirePermiso('pagos')
  const db = createAdminClient()

  const r = await sincronizarCobroConfiguracion(db, presupuestoId, ctx)
  if (r.accion === 'congelado') return { ok: false, error: avisoCobro(r) ?? 'El cobro ya está confirmado.' }

  revalidatePath('/admin/presupuestos')
  revalidatePath('/admin/pagos')
  revalidatePath('/admin/clientes')
  return { ok: true, aviso: avisoCobro(r) ?? 'El cobro ya coincidía con el presupuesto.' }
}

// ── Registrar las horas reales de la instalación (cierre) ──
export async function actualizarHorasReales(
  id: number, horas: number | null,
): Promise<{ ok: boolean; error?: string }> {
  await requirePermiso('presupuestos')
  const db = createAdminClient()
  const valor = horas != null && Number.isFinite(horas) && horas >= 0 ? horas : null

  // Al limpiar las horas, el presupuesto vuelve a su estado previo a instalar:
  // 'aprobado' si ya tiene cliente creado, si no 'guardado'. No revertimos a
  // 'guardado' a secas para no perder la aprobación.
  let estadoBase = 'guardado'
  if (valor == null) {
    const { data: actual } = await db
      .from('presupuestos_instalacion')
      .select('client_id')
      .eq('id', id)
      .maybeSingle()
    if (actual?.client_id) estadoBase = 'aprobado'
  }

  const { error } = await db
    .from('presupuestos_instalacion')
    .update({ horas_reales: valor, estado: valor != null ? 'instalado' : estadoBase, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/presupuestos')
  return { ok: true }
}

// ── La IA que rellena el presupuesto con lo que el lead ya declaró ───────────
//
// Ojo a lo que NO hace: ni precio, ni horas, ni nivel. Devuelve una `PropuestaIa`
// —volúmenes y módulos— que el comercial aplica de un clic sobre el formulario, y
// el cálculo sigue siendo el de siempre. Nada de esto toca la base de datos: lo
// que se guarda es el presupuesto que la persona cree luego, con su propia traza.
export async function sugerirEntradasLeadIa(args: {
  leadId: number
  /** Los módulos marcados AHORA en el formulario, no los que recomendó el lead. */
  modulos: string[]
  /** Lo tecleado en las líneas de volumen, para no proponer lo que ya está. */
  volumenes: Record<string, number>
  /** Las líneas que la pantalla está enseñando (las de una fase excluida no salen). */
  lineas: string[]
}): Promise<{ ok: true; propuesta: PropuestaIa<EntradaLead> } | { ok: false; error: string; reintentar?: boolean }> {
  await requirePermiso('presupuestos')
  const db = createAdminClient()

  const { data: lead } = await db
    .from('diagnosticos')
    .select('sector, necesidades, modo_actual, tamano')
    .eq('id', args.leadId)
    .maybeSingle()
  if (!lead) return { ok: false, error: 'Ese lead ya no existe.' }

  const [catalogo, parametros, modulosCat] = await Promise.all([
    obtenerCatalogoPublico(),
    cargarParametros(),
    db.from('modulos_catalogo').select('clave, nombre, descripcion').eq('activo', true).order('orden'),
  ])

  // Del lead sale lo que declaró del negocio, ya en palabras: el modelo no sabe
  // qué es «restaurante_2» ni qué significa el índice 1 en `tamano`.
  const delSector = catalogo.sectores.find(s => s.sector === lead.sector)?.modulos ?? []
  const etiquetaNecesidad = new Map(catalogo.necesidades.map(n => [n.clave, n.etiqueta]))

  const visibles = new Set(args.lineas)
  const lineas = parametros.lineas
    .filter(l => visibles.has(l.clave))
    .sort((a, b) => a.orden - b.orden)
    .map(l => ({ clave: l.clave, etiqueta: l.etiqueta, actual: Number(args.volumenes[l.clave]) || 0 }))

  const modulos = ((modulosCat.data ?? []) as { clave: string; nombre: string; descripcion: string | null }[])
    .map(m => ({
      clave: m.clave,
      nombre: m.nombre,
      descripcion: (m.descripcion ?? '').slice(0, 160),
      marcado: args.modulos.includes(m.clave),
    }))

  try {
    const propuesta = await proponerEntradasLead({
      sector:      catalogo.sectores.find(s => s.sector === lead.sector)?.nombre ?? String(lead.sector ?? ''),
      modoActual:  lead.modo_actual ? etiquetaModo(lead.modo_actual) : null,
      necesidades: ((lead.necesidades ?? []) as string[]).map(c => etiquetaNecesidad.get(c) ?? c),
      declarado:   tamanoComoTexto(catalogo.niveles, delSector, lead.tamano as Record<string, number> | null)
                     .map(l => `${l.etiqueta}: ${l.banda}`),
      lineas,
      modulos,
    })
    if (!propuesta) return { ok: false, error: 'La IA no ve nada que añadir a lo que ya hay.', reintentar: true }
    return { ok: true, propuesta }
  } catch (e) {
    if (e instanceof IaBolsaAgotada || e instanceof IaApagada) return { ok: false, error: e.message }
    throw e
  }
}

// ── La IA que revisa el borrador antes de emitirlo ───────────────────────────
//
// La única función de IA del admin que NO escribe, y es deliberado (plan §Fase 4):
// aquí quien decide es quien vende. Devuelve avisos para leer; no hay nada que
// aplicar, ni una cifra que se mueva sola.
//
// Trabaja sobre el borrador que hay EN PANTALLA, guardado o no —«antes de emitir»
// es justo antes de guardarlo—, y recalcula las horas en el servidor con los
// parámetros de verdad: lo que llegue del navegador es una propuesta, no la
// cuenta. Y hacia el modelo NO va quién es el cliente: ni el negocio, ni el
// contacto, ni el comercial. Nada de eso ayuda a saber si las horas se quedan
// cortas.

/** Cuántos presupuestos cerrados se leen para buscar los parecidos. */
const CERRADOS_A_MIRAR = 40

interface FilaCerrada {
  id:           number
  client_id:    string | null
  nivel:        string | null
  modulos:      string[] | null
  volumenes:    Record<string, number> | null
  horas_total:  number | null
  horas_reales: number | null
}

/** Cuánto se parecen dos presupuestos: por los módulos, que es lo que mueve las horas. */
function parecido(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const set = new Set(b)
  const comunes = a.filter(c => set.has(c)).length
  return comunes / new Set([...a, ...b]).size
}

export async function revisarPresupuestoIa(
  input: CrearPresupuestoInput,
): Promise<{ ok: true; revision: RevisionPresupuesto } | { ok: false; error: string; reintentar?: boolean }> {
  await requirePermiso('presupuestos')
  const db = createAdminClient()

  const modulosSel = input.modulos ?? []
  const volumenes  = input.volumenes ?? {}
  const fasesFuera = (input.fasesExcluidas ?? []).map(Number).filter(n => n >= 1 && n <= 4)
  const moneda     = normalizarMonedaClaux(input.moneda)
  const nivel      = normalizarNivel(input.nivel)

  const [parametros, cat, cerrados] = await Promise.all([
    cargarParametros(),
    db.from('modulos_catalogo').select('clave, nombre'),
    db.from('presupuestos_instalacion')
      .select('id, client_id, nivel, modulos, volumenes, horas_total, horas_reales')
      .eq('estado', 'instalado')
      .not('horas_reales', 'is', null)
      .order('created_at', { ascending: false })
      .limit(CERRADOS_A_MIRAR),
  ])

  // El recálculo autoritativo, el mismo que hace guardar: revisar la cuenta del
  // navegador sería revisar una cuenta que no es la que se va a guardar.
  const resultado = calcularInstalacion({
    modulos:   modulosSel,
    volumenes,
    formato:   input.formato,
    moneda,
    historicoHorasManual: input.migracion?.desea ? Number(input.migracion?.horasManual ?? 0) || 0 : 0,
    tarifaHoraOverride:   Number(input.tarifaHora) || 0,
    descuentoPct:         Math.min(100, Math.max(0, Number(input.descuentoPct) || 0)),
    fasesExcluidas:       fasesFuera,
  }, parametros)

  // Un formulario recién abierto no tiene nada que revisar, y gastar una llamada
  // de la bolsa para que conteste eso mismo es tirar dinero.
  if (!modulosSel.length && resultado.horasTotal === 0) {
    return { ok: false, error: 'Sin nada que revisar: marca los módulos y pon los volúmenes.' }
  }

  const nombreModulo = new Map(((cat.data ?? []) as { clave: string; nombre: string }[]).map(m => [m.clave, m.nombre]))
  const etiquetaLinea = new Map(parametros.lineas.map(l => [l.clave, l.etiqueta]))
  const enPalabras = (v: Record<string, number> | null | undefined) =>
    Object.entries(v ?? {})
      .filter(([, n]) => Number(n) > 0)
      .map(([k, n]) => `${etiquetaLinea.get(k) ?? k}: ${n}`)

  // Los casos parecidos y su desvío: los ordena y los cuenta el código. Al modelo
  // se le pide el juicio, no la aritmética.
  const filas = ((cerrados.data ?? []) as FilaCerrada[])
    .filter(f => Number(f.horas_total) > 0 && f.horas_reales != null)
  const casos: CasoCerrado[] = filas
    .map(f => ({ f, p: parecido(modulosSel, f.modulos ?? []) }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 8)
    .map(({ f }) => {
      const horas = Number(f.horas_total)
      const reales = Number(f.horas_reales)
      const pct = Math.round((reales / horas - 1) * 100)
      return {
        ref:         f.client_id ?? numeroPresupuesto(f.id),
        nivel:       f.nivel ?? '',
        modulos:     (f.modulos ?? []).map(c => nombreModulo.get(c) ?? c),
        volumenes:   enPalabras(f.volumenes),
        horas,
        horasReales: reales,
        desvio:      pct === 0 ? 'clavado' : `${pct > 0 ? '+' : ''}${pct} %`,
      }
    })

  // La foto del histórico, calculada aquí: es el contexto que hace que un aviso
  // de horas signifique algo, y un modelo no tiene por qué sacar una mediana.
  let nota: string | null = null
  if (filas.length) {
    const desvios = filas
      .map(f => Number(f.horas_reales) / Number(f.horas_total) - 1)
      .sort((a, b) => a - b)
    const mediana = desvios[Math.floor(desvios.length / 2)]
    const pct = Math.round(mediana * 100)
    nota = `De ${filas.length} instalación${filas.length === 1 ? '' : 'es'} ya cerrada${filas.length === 1 ? '' : 's'}, `
      + (pct > 0 ? `la mediana costó un ${pct} % más de lo presupuestado.`
        : pct < 0 ? `la mediana costó un ${Math.abs(pct)} % menos de lo presupuestado.`
        : 'la mediana salió clavada.')
  }

  const migracion = input.migracion?.desea
    ? [
        input.migracion.desde || input.migracion.hasta ? `de ${input.migracion.desde || '?'} a ${input.migracion.hasta || '?'}` : null,
        input.migracion.volumen ? `${input.migracion.volumen} registros` : null,
        input.migracion.horasManual ? `${input.migracion.horasManual} h a mano` : null,
      ].filter(Boolean).join(' · ') || 'sí'
    : null

  try {
    const revision = await revisarPresupuesto({
      borrador: {
        nivel:      nivel,
        moneda,
        modulos:    modulosSel.map(c => nombreModulo.get(c) ?? c),
        volumenes:  enPalabras(volumenes),
        fasesFuera: fasesFuera.map(n => etiquetaFase(n as NumeroFase)),
        formato:    FORMATOS.find(f => f.key === input.formato)?.label ?? String(input.formato ?? ''),
        migracion,
        horas:      resultado.horasTotal,
        porFase:    resultado.desglose.map(d => ({ fase: d.fase, horas: d.horas })),
        tarifaHora: Number(input.tarifaHora) || 0,
        descuentoPct:    Math.min(100, Math.max(0, Number(input.descuentoPct) || 0)),
        descuentoMotivo: (input.descuentoMotivo || '').trim() || null,
        total:      resultado.totalFinal,
        cuota:      await calcularCuotaMensual(db, modulosSel, nivel, moneda),
        revisiones: resultado.revisiones.map(r => `${r.linea}: ${r.motivo}`),
      },
      casos,
      nota,
    })
    if (!revision) return { ok: false, error: 'La IA no ha podido revisarlo.', reintentar: true }
    return { ok: true, revision }
  } catch (e) {
    if (e instanceof IaBolsaAgotada || e instanceof IaApagada) return { ok: false, error: e.message }
    throw e
  }
}
