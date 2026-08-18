'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermiso } from '@/lib/admin-guard'
import { logActividad } from '@/lib/audit'
import { revalidatePath } from 'next/cache'
import { calcularInstalacion } from '@/lib/presupuesto/calculo'
import { cargarParametros } from '@/lib/presupuesto/parametros'
import type { FormatoDatos, TarifaTipo } from '@/lib/presupuesto/config'

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
): Promise<{ ok: boolean; id?: number; error?: string }> {
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

  revalidatePath('/admin/presupuestos')
  return { ok: true, id }
}

// ── Aprobar / desaprobar un presupuesto ──
// 'aprobado' = el cliente aceptó la oferta; habilita crear el cliente desde aquí.
// No se puede tocar un presupuesto ya 'instalado' (tiene horas reales registradas).
export async function aprobarPresupuesto(
  id: number, aprobado: boolean,
): Promise<{ ok: boolean; error?: string }> {
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

  revalidatePath('/admin/presupuestos')
  return { ok: true }
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
