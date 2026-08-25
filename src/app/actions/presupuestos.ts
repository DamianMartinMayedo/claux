'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermiso } from '@/lib/admin-guard'
import { logActividad } from '@/lib/audit'
import { revalidatePath } from 'next/cache'
import { calcularInstalacion } from '@/lib/presupuesto/calculo'
import { cargarParametros } from '@/lib/presupuesto/parametros'
import type { FormatoDatos, TarifaTipo } from '@/lib/presupuesto/config'
import { hoyEnTz } from '@/lib/fecha-tz'

export interface ModuloPresupuesto {
  clave:   string
  nombre:  string
  tipo:    string
  es_base: boolean
  precio_fundador_usd: number
  precio_estandar_usd: number
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
   *  tarifa única, configurable y negociable por cliente. */
  tarifa:             TarifaTipo
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
  tarifa:                string
  horas_total:           number
  coste_instalacion_usd: number
  cuota_mensual_usd:     number
  horas_reales:          number | null
  estado:                string
  client_id:             string | null
  tarifa_hora_usd:       number
  descuento_pct:         number
  total_final_usd:       number
}

// ── Catálogo de módulos activos (en vivo) para el formulario ──
export async function listarModulosParaPresupuesto(): Promise<ModuloPresupuesto[]> {
  await requirePermiso('presupuestos')
  const db = createAdminClient()
  const { data } = await db
    .from('modulos_catalogo')
    .select('clave, nombre, tipo, es_base, precio_fundador_usd, precio_estandar_usd')
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

// ── Cuota mensual (Σ precios de módulos contratados según tarifa, en vivo) ──
async function calcularCuotaMensual(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, modulos: string[], tarifa: TarifaTipo,
): Promise<number> {
  const { data } = await db
    .from('modulos_catalogo')
    .select('clave, precio_fundador_usd, precio_estandar_usd')
    .eq('activo', true)
  const campo = tarifa === 'fundador' ? 'precio_fundador_usd' : 'precio_estandar_usd'
  return (data ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((m: any) => modulos.includes(m.clave))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .reduce((s: number, m: any) => s + Number(m[campo] ?? 0), 0)
}

// ── Listar presupuestos guardados ──
export async function listarPresupuestos(): Promise<PresupuestoRow[]> {
  await requirePermiso('presupuestos')
  const db = createAdminClient()
  const { data } = await db
    .from('presupuestos_instalacion')
    .select('id, created_at, comercial_nombre, nombre_negocio, contacto, tarifa, horas_total, coste_instalacion_usd, cuota_mensual_usd, horas_reales, estado, client_id, tarifa_hora_usd, descuento_pct, total_final_usd')
    .order('created_at', { ascending: false })
  return (data ?? []) as PresupuestoRow[]
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
    .select('id, created_at, comercial_nombre, nombre_negocio, contacto, tarifa, horas_total, coste_instalacion_usd, cuota_mensual_usd, horas_reales, estado, client_id, tarifa_hora_usd, descuento_pct, total_final_usd')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
  return (data ?? []) as PresupuestoRow[]
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
// propuesta, no el precio. La tarifa pactada sí se respeta —es la palanca comercial—, pero las
// horas se vuelven a calcular aquí. Las fases excluidas viajan con el resto: si el recálculo
// del servidor las ignorara, guardaría un presupuesto más caro que el que el comercial acaba de
// enseñar en pantalla.
type SnapshotPresupuesto = {
  tarifa:          TarifaTipo
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
  const tarifa: TarifaTipo = input.tarifa === 'fundador' ? 'fundador' : 'estandar'

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
    historicoHorasManual,
    tarifaHoraOverride: Number(input.tarifaHora) || 0,
    descuentoPct,
    fasesExcluidas,
  }, parametros)

  const cuotaMensual = await calcularCuotaMensual(db, input.modulos ?? [], tarifa)

  return { ok: true, snap: { tarifa, nombreNegocio, descuentoPct, descuentoMotivo, cuotaMensual, resultado } }
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
  pagoId?: string
}

/** Lo que le pasó al cobro, en una frase para el toast (null = no pasó nada que contar). */
function avisoCobro(r: ResultadoCobro): string | null {
  const usd = (n?: number) => `$${(n ?? 0).toFixed(2)}`
  if (r.accion === 'actualizado') return `El cobro de configuración pasa a ${usd(r.monto)}.`
  if (r.accion === 'creado')      return `Se creó el cobro de configuración ${r.pagoId} por ${usd(r.monto)} (por confirmar).`
  if (r.accion === 'eliminado')   return 'Se retiró el cobro de configuración: el presupuesto queda en $0.'
  if (r.accion === 'congelado')   return `Ojo: el cobro de configuración (${usd(r.monto)}) ya está confirmado y no se toca. Ajústalo a mano si procede.`
  return null
}

/** Un cobro ya confirmado que deja de cuadrar es lo único que exige mano humana. */
function tonoCobro(r: ResultadoCobro): 'info' | 'warning' {
  return r.accion === 'congelado' ? 'warning' : 'info'
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
    .select('id, client_id, estado, total_final_usd, nombre_negocio')
    .eq('id', presupuestoId)
    .maybeSingle()
  if (!pres?.client_id) return { accion: 'ninguna' }

  const total = Number(pres.total_final_usd) || 0
  // Un BORRADOR no es un compromiso: puede mover el cobro que ya es suyo, pero no
  // adoptar uno suelto ni inventarse uno nuevo. Si no, editar un presupuesto en
  // negociación le dejaría al cliente un «pendiente» en su panel —o peor, le
  // robaría al cobro vivo la cifra del presupuesto que sí está aprobado.
  const esCompromiso = pres.estado === 'aprobado' || pres.estado === 'instalado'

  // El cobro de ESTE presupuesto. Si no lo hay, se adopta el que dejó el alta
  // sin ligar (dato anterior a la mig. 204): es el mismo cobro, sin etiqueta.
  const { data: propio } = await db
    .from('payments')
    .select('pago_id, estado, monto_usd')
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
      .select('pago_id, estado, monto_usd')
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
    return { accion: 'congelado', monto: Number(cobro.monto_usd) || 0, pagoId: cobro.pago_id }
  }

  // Presupuesto a cero (100% de descuento, cortesía): no hay nada que cobrar, y
  // un cobro de $0 en la ficha del cliente es ruido que alguien tendría que ir
  // tachando a mano.
  if (total <= 0) {
    if (!cobro) return { accion: 'ninguna' }
    await db.from('payments').delete().eq('pago_id', cobro.pago_id)
    await logActividad(db, {
      user_email: ctx.email, entity: 'pago', entity_id: cobro.pago_id, action: 'eliminar',
      description: `Eliminó el cobro de configuración ${cobro.pago_id} — el presupuesto de ${pres.nombre_negocio} queda en $0`,
    })
    return { accion: 'eliminado', pagoId: cobro.pago_id }
  }

  if (cobro) {
    const antes = Number(cobro.monto_usd) || 0
    await db.from('payments')
      .update({ monto_usd: total, presupuesto_id: presupuestoId })
      .eq('pago_id', cobro.pago_id)
    if (Math.abs(antes - total) < 0.005) return { accion: 'ninguna', monto: total, pagoId: cobro.pago_id }
    await logActividad(db, {
      user_email: ctx.email, entity: 'pago', entity_id: cobro.pago_id, action: 'editar',
      description: `Ajustó el cobro de configuración ${cobro.pago_id} de $${antes.toFixed(2)} a $${total.toFixed(2)} — presupuesto de ${pres.nombre_negocio}`,
    })
    return { accion: 'actualizado', monto: total, pagoId: cobro.pago_id }
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
    monto_usd:      total,
    metodo:         'transferencia',
    fecha:          hoyEnTz(),
    notas:          'Pago único de configuración inicial',
  })
  if (error) return { accion: 'ninguna' }

  await logActividad(db, {
    user_email: ctx.email, entity: 'pago', entity_id: pagoId, action: 'registrar',
    description: `Pre-creó el cobro de configuración ${pagoId} (por confirmar) — $${total.toFixed(2)} del presupuesto de ${pres.nombre_negocio}`,
  })
  return { accion: 'creado', monto: total, pagoId }
}

// ── Crear (guardar) un presupuesto: recálculo autoritativo en servidor ──
export async function crearPresupuesto(
  input: CrearPresupuestoInput,
): Promise<{ ok: boolean; id?: number; error?: string }> {
  const ctx = await requirePermiso('presupuestos')
  const db = createAdminClient()

  const calc = await calcularSnapshotPresupuesto(db, input)
  if (!calc.ok) return { ok: false, error: calc.error }
  const { tarifa, nombreNegocio, descuentoPct, descuentoMotivo, cuotaMensual, resultado } = calc.snap

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
      tarifa,
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
      coste_instalacion_usd: resultado.costeInstalacionUsd,
      cuota_mensual_usd:     cuotaMensual,
      // Snapshot de lo negociado: un presupuesto de hace tres meses tiene que seguir
      // explicando su propio número cuando cambie la tarifa base.
      tarifa_hora_usd:       resultado.tarifaHora,
      descuento_pct:         descuentoPct,
      descuento_motivo:      descuentoMotivo || null,
      total_final_usd:       resultado.totalFinalUsd,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message }

  await logActividad(db, {
    user_email:  ctx.email,
    entity:      'presupuesto',
    entity_id:   String(data.id),
    action:      'crear',
    description: `Guardó presupuesto de ${nombreNegocio} — ${resultado.horasTotal}h · $${resultado.totalFinalUsd.toFixed(2)} instalación${descuentoPct > 0 ? ` (${descuentoPct}% dto.: ${descuentoMotivo})` : ''} · $${cuotaMensual.toFixed(2)}/mes`,
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
  const { tarifa, nombreNegocio, descuentoPct, descuentoMotivo, cuotaMensual, resultado } = calc.snap

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
      tarifa,
      modulos:               input.modulos ?? [],
      volumenes:             input.volumenes ?? {},
      formato_datos:         input.formato,
      migracion:             input.migracion?.desea ? input.migracion : { desea: false },
      desglose:              resultado.desglose,
      revisiones:            resultado.revisiones,
      horas_total:           resultado.horasTotal,
      coste_instalacion_usd: resultado.costeInstalacionUsd,
      cuota_mensual_usd:     cuotaMensual,
      tarifa_hora_usd:       resultado.tarifaHora,
      descuento_pct:         descuentoPct,
      descuento_motivo:      descuentoMotivo || null,
      total_final_usd:       resultado.totalFinalUsd,
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
    description: `Editó el presupuesto de ${nombreNegocio} — ${resultado.horasTotal}h · $${resultado.totalFinalUsd.toFixed(2)} instalación${descuentoPct > 0 ? ` (${descuentoPct}% dto.: ${descuentoMotivo})` : ''} · $${cuotaMensual.toFixed(2)}/mes`,
  })

  // El cobro por confirmar que cuelga de este presupuesto se mueve con él: si no,
  // el cliente sigue viendo en su panel la cifra del borrador anterior.
  const cobro = await sincronizarCobroConfiguracion(db, id, ctx)

  revalidatePath('/admin/presupuestos')
  revalidatePath('/admin/pagos')
  return { ok: true, id, aviso: avisoCobro(cobro), avisoTono: tonoCobro(cobro) }
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

  revalidatePath('/admin/presupuestos')
  revalidatePath('/admin/pagos')
  return { ok: true, aviso: avisoCobro(cobro), avisoTono: tonoCobro(cobro) }
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
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePermiso('presupuestos')
  const db = createAdminClient()

  const { data: pres } = await db
    .from('presupuestos_instalacion')
    .select('id, estado, nombre_negocio, client_id, total_final_usd')
    .eq('id', id)
    .maybeSingle()
  if (!pres) return { ok: false, error: 'Presupuesto no encontrado.' }
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

  const { error } = await db
    .from('presupuestos_instalacion')
    .delete()
    .eq('id', id)
    // Candado de concurrencia: si alguien lo aprobó mientras se confirmaba, no se borra.
    .eq('estado', 'guardado')
  if (error) return { ok: false, error: error.message }

  await logActividad(db, {
    user_email:  ctx.email,
    entity:      'presupuesto',
    entity_id:   String(id),
    action:      'eliminar',
    description: `Eliminó el borrador de presupuesto de ${pres.nombre_negocio} — $${Number(pres.total_final_usd ?? 0).toFixed(2)} de instalación${pres.client_id ? ` · ${pres.client_id}` : ''}`,
  })

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
