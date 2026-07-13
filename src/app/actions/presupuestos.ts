'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermiso } from '@/lib/admin-guard'
import { logActividad } from '@/lib/audit'
import { revalidatePath } from 'next/cache'
import { calcularInstalacion } from '@/lib/presupuesto/calculo'
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
  tarifa:             TarifaTipo
  modulos:            string[]
  volumenes:          Record<string, number>
  formato:            FormatoDatos
  migracion:          MigracionInput
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
    .select('id, created_at, comercial_nombre, nombre_negocio, contacto, tarifa, horas_total, coste_instalacion_usd, cuota_mensual_usd, horas_reales, estado, client_id')
    .order('created_at', { ascending: false })
  return (data ?? []) as PresupuestoRow[]
}

// ── Detalle completo de un presupuesto ──
export async function obtenerPresupuesto(id: number) {
  await requirePermiso('presupuestos')
  const db = createAdminClient()
  const { data } = await db
    .from('presupuestos_instalacion')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  return data
}

// ── Crear (guardar) un presupuesto: recálculo autoritativo en servidor ──
export async function crearPresupuesto(
  input: CrearPresupuestoInput,
): Promise<{ ok: boolean; id?: number; error?: string }> {
  const ctx = await requirePermiso('presupuestos')

  const nombre_negocio = (input.nombreNegocio || '').trim()
  if (!nombre_negocio) return { ok: false, error: 'El nombre del negocio es obligatorio.' }
  const tarifa: TarifaTipo = input.tarifa === 'fundador' ? 'fundador' : 'estandar'

  const db = createAdminClient()

  const historicoHorasManual = input.migracion?.desea ? Number(input.migracion?.horasManual ?? 0) || 0 : 0

  const resultado = calcularInstalacion({
    tarifa,
    modulos:   input.modulos ?? [],
    volumenes: input.volumenes ?? {},
    formato:   input.formato,
    historicoHorasManual,
  })

  const cuotaMensual = await calcularCuotaMensual(db, input.modulos ?? [], tarifa)

  const { data, error } = await db
    .from('presupuestos_instalacion')
    .insert({
      diagnostico_id:        input.diagnosticoId ?? null,
      client_id:             input.clientId ?? null,
      comercial_email:       input.comercialEmail ?? ctx.email,
      comercial_nombre:      input.comercialNombre ?? ctx.nombre,
      nombre_negocio,
      nombre_responsable:    (input.nombreResponsable || '').trim() || null,
      contacto:              (input.contacto || '').trim() || null,
      tarifa,
      modulos:               input.modulos ?? [],
      volumenes:             input.volumenes ?? {},
      formato_datos:         input.formato,
      migracion:             input.migracion ?? {},
      desglose:              resultado.desglose,
      revisiones:            resultado.revisiones,
      horas_total:           resultado.horasTotal,
      coste_instalacion_usd: resultado.costeInstalacionUsd,
      cuota_mensual_usd:     cuotaMensual,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message }

  await logActividad(db, {
    user_email:  ctx.email,
    entity:      'presupuesto',
    entity_id:   String(data.id),
    action:      'crear',
    description: `Guardó presupuesto de ${nombre_negocio} — ${resultado.horasTotal}h · $${resultado.costeInstalacionUsd.toFixed(2)} instalación · $${cuotaMensual.toFixed(2)}/mes`,
  })

  revalidatePath('/admin/presupuestos')
  return { ok: true, id: data.id }
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
