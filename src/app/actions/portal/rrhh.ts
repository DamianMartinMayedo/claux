'use server'

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { obtenerEmpresas }   from './empresas'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type TipoContrato  = 'INDEFINIDO' | 'TEMPORAL' | 'POR_OBRA' | 'PRACTICAS'
export type Periodicidad  = 'MENSUAL' | 'QUINCENAL' | 'SEMANAL' | 'POR_HORA'
export type EstadoEmpleado = 'ACTIVO' | 'BAJA'

export interface Empleado {
  empleado_id:   string
  client_id:     string
  empresa_id:    string
  nombre:        string
  apellidos:     string | null
  documento:     string | null
  telefono:      string | null
  email:         string | null
  direccion:     string | null
  cargo:         string | null
  departamento:  string | null
  turno:         string | null
  tipo_contrato: TipoContrato
  fecha_alta:    string
  salario_base:  number
  moneda:        string
  periodicidad:  Periodicidad
  fecha_baja:    string | null
  motivo_baja:   string | null
  notas:         string | null
  created_at:    string
  updated_at:    string
}

export interface EmpleadoConEstado extends Empleado {
  estado: EstadoEmpleado
}

export interface Contrato {
  contrato_id:   string
  client_id:     string
  empleado_id:   string
  tipo_contrato: TipoContrato
  fecha_inicio:  string
  fecha_fin:     string | null
  salario_base:  number
  moneda:        string
  periodicidad:  Periodicidad
  notas:         string | null
  created_at:    string
}

export type EstadoNomina = 'BORRADOR' | 'CONFIRMADA'

export interface NominaLinea {
  linea_id:        string
  nomina_id:       string
  empleado_id:     string
  empleado_nombre: string
  cargo:           string | null
  salario_base:    number
  devengado:       number
  deducciones:     number
  neto:            number
  notas:           string | null
}

export interface Nomina {
  nomina_id:  string
  client_id:  string
  empresa_id: string
  periodo:    string
  fecha:      string
  moneda:     string
  estado:     EstadoNomina
  gasto_id:   string | null
  total:      number
  notas:      string | null
  created_at: string
  updated_at: string
}

export interface NominaConLineas extends Nomina {
  lineas:          NominaLinea[]
  pagado:          number
  saldo_pendiente: number
}

export interface Turno {
  turno_id:    string
  client_id:   string
  empresa_id:  string
  nombre:      string
  hora_inicio: string | null
  hora_fin:    string | null
  color:       string | null
  activo:      boolean
}

export interface TurnoAsignacion {
  asignacion_id: string
  empleado_id:   string
  dia_semana:    number   // 1=Lunes … 7=Domingo
  turno_id:      string
}

export interface RrhhPageData {
  empleados:       EmpleadoConEstado[]
  contratos:       Contrato[]
  nominas:         NominaConLineas[]
  turnos_catalogo: Turno[]
  asignaciones:    TurnoAsignacion[]
  empresas:        { empresa_id: string; nombre: string }[]
  monedas:         string[]
  cargos:          string[]
  departamentos:   string[]
  turnos:          string[]
  empresa_nombres: Record<string, string>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TIPOS_CONTRATO: TipoContrato[]  = ['INDEFINIDO', 'TEMPORAL', 'POR_OBRA', 'PRACTICAS']
const PERIODICIDADES:  Periodicidad[] = ['MENSUAL', 'QUINCENAL', 'SEMANAL', 'POR_HORA']

const EPS = 0.005

function corto(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()
}
function generarEmpleadoId():   string { return `PER-${corto()}` }
function generarContratoId():   string { return `CON-${corto()}` }
function generarNominaId():     string { return `NOM-${corto()}` }
function generarLineaId():      string { return `NLN-${corto()}` }
function generarGastoId():      string { return `GAS-${corto()}` }
function generarTurnoId():      string { return `TUR-${corto()}` }
function generarAsignacionId(): string { return `TAS-${corto()}` }

function hoy(): string {
  return new Date().toISOString().split('T')[0]
}
function estadoDe(fecha_baja: string | null): EstadoEmpleado {
  return fecha_baja ? 'BAJA' : 'ACTIVO'
}

// ── Obtener datos de RRHH ───────────────────────────────────────────────────────

export async function obtenerRrhh(): Promise<RrhhPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db          = createAdminClient()
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  const idsFiltro   = empresa_ids.length ? empresa_ids : ['__none__']

  const [empRes, monRes, nomRes, nlnRes, conRes, turRes, tasRes] = await Promise.all([
    db.from('empleados').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('fecha_baja', { ascending: true, nullsFirst: true })
      .order('nombre', { ascending: true }),
    db.from('monedas').select('codigo')
      .eq('client_id', session.client_id)
      .eq('activa', true)
      .order('codigo'),
    db.from('nominas').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('periodo', { ascending: false })
      .order('created_at', { ascending: false }),
    db.from('nomina_lineas').select('*')
      .eq('client_id', session.client_id)
      .order('empleado_nombre', { ascending: true }),
    db.from('contratos').select('*')
      .eq('client_id', session.client_id)
      .order('fecha_inicio', { ascending: false })
      .order('created_at', { ascending: false }),
    db.from('turnos').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('nombre', { ascending: true }),
    db.from('turno_asignaciones').select('*')
      .eq('client_id', session.client_id),
  ])

  const empleados = ((empRes.data ?? []) as Empleado[]).map(e => ({
    ...e,
    salario_base: Number(e.salario_base),
    estado:       estadoDe(e.fecha_baja),
  }))
  const empleadoIds = new Set(empleados.map(e => e.empleado_id))

  // Contratos de los empleados accesibles (historial)
  const contratos = ((conRes.data ?? []) as Contrato[])
    .filter(c => empleadoIds.has(c.empleado_id))
    .map(c => ({ ...c, salario_base: Number(c.salario_base) }))

  // Turnos (catálogo) y asignaciones de los empleados accesibles
  const turnos_catalogo = (turRes.data ?? []) as Turno[]
  const asignaciones = ((tasRes.data ?? []) as TurnoAsignacion[])
    .filter(a => empleadoIds.has(a.empleado_id))

  // Nóminas con sus líneas y el estado de pago del gasto enlazado
  const nominasRaw = (nomRes.data ?? []) as Nomina[]
  const lineasRaw  = (nlnRes.data ?? []) as (NominaLinea & { client_id: string })[]

  const lineasPorNomina = new Map<string, NominaLinea[]>()
  for (const l of lineasRaw) {
    const arr = lineasPorNomina.get(l.nomina_id) ?? []
    arr.push({
      linea_id:        l.linea_id,
      nomina_id:       l.nomina_id,
      empleado_id:     l.empleado_id,
      empleado_nombre: l.empleado_nombre,
      cargo:           l.cargo,
      salario_base:    Number(l.salario_base),
      devengado:       Number(l.devengado),
      deducciones:     Number(l.deducciones),
      neto:            Number(l.neto),
      notas:           l.notas,
    })
    lineasPorNomina.set(l.nomina_id, arr)
  }

  // Pagos del gasto enlazado (liquidación unificada en Tesorería)
  const gastoIds = nominasRaw.map(n => n.gasto_id).filter((g): g is string => !!g)
  const pagadoPorGasto = new Map<string, number>()
  if (gastoIds.length) {
    const { data: movs } = await db.from('movimientos_tesoreria')
      .select('monto, referencia_id')
      .eq('client_id', session.client_id)
      .in('referencia_id', gastoIds)
    for (const m of (movs ?? []) as { monto: number; referencia_id: string }[]) {
      pagadoPorGasto.set(m.referencia_id, (pagadoPorGasto.get(m.referencia_id) ?? 0) + Number(m.monto))
    }
  }

  const nominas: NominaConLineas[] = nominasRaw.map(n => {
    const total  = Number(n.total)
    const pagado = n.gasto_id ? (pagadoPorGasto.get(n.gasto_id) ?? 0) : 0
    return {
      ...n,
      total,
      lineas:          lineasPorNomina.get(n.nomina_id) ?? [],
      pagado,
      saldo_pendiente: Math.max(0, total - pagado),
    }
  })

  const datalist = (vals: (string | null)[]) =>
    Array.from(new Set(vals.filter((v): v is string => !!v))).sort()

  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre

  return {
    empleados,
    contratos,
    nominas,
    turnos_catalogo,
    asignaciones,
    empresas:       empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
    monedas:        ((monRes.data ?? []) as { codigo: string }[]).map(m => m.codigo),
    cargos:         datalist(empleados.map(e => e.cargo)),
    departamentos:  datalist(empleados.map(e => e.departamento)),
    turnos:         datalist(empleados.map(e => e.turno)),
    empresa_nombres,
  }
}

// ── Guardar empleado (crear / editar) ───────────────────────────────────────────

export async function guardarEmpleado(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  const empleado_id  = (formData.get('empleado_id')  as string)?.trim()
  const empresa_id   = (formData.get('empresa_id')   as string)?.trim()
  const nombre       = (formData.get('nombre')       as string)?.trim()
  const apellidos    = (formData.get('apellidos')    as string)?.trim() || null
  const documento    = (formData.get('documento')    as string)?.trim() || null
  const telefono     = (formData.get('telefono')     as string)?.trim() || null
  const email        = (formData.get('email')        as string)?.trim() || null
  const direccion    = (formData.get('direccion')    as string)?.trim() || null
  const cargo        = (formData.get('cargo')        as string)?.trim() || null
  const departamento = (formData.get('departamento') as string)?.trim() || null
  const turno        = (formData.get('turno')        as string)?.trim() || null
  const tipo_raw     = (formData.get('tipo_contrato') as string)?.trim() as TipoContrato
  const fecha_alta   = (formData.get('fecha_alta')   as string)?.trim() || hoy()
  const periodi_raw  = (formData.get('periodicidad') as string)?.trim() as Periodicidad
  const salarioRaw   = parseFloat(formData.get('salario_base') as string)
  const moneda       = (formData.get('moneda')       as string)?.trim()
  const notas        = (formData.get('notas')        as string)?.trim() || null

  if (!nombre)      return { ok: false, error: 'El nombre es obligatorio.' }
  if (!empresa_id)  return { ok: false, error: 'Debes seleccionar una empresa.' }

  const tipo_contrato = TIPOS_CONTRATO.includes(tipo_raw)   ? tipo_raw    : 'INDEFINIDO'
  const periodicidad  = PERIODICIDADES.includes(periodi_raw) ? periodi_raw : 'MENSUAL'
  const salario_base  = isNaN(salarioRaw) || salarioRaw < 0 ? 0 : salarioRaw

  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_id)) {
    return { ok: false, error: 'Empresa no válida.' }
  }

  const campos = {
    nombre, apellidos, documento, telefono, email, direccion,
    cargo, departamento, turno, tipo_contrato, fecha_alta,
    salario_base, periodicidad, notas,
    updated_at: new Date().toISOString(),
  }

  if (!empleado_id) {
    if (!moneda) return { ok: false, error: 'Debes seleccionar una moneda.' }
    const nuevoId = generarEmpleadoId()
    const { error } = await db.from('empleados').insert({
      empleado_id: nuevoId,
      client_id:   session.client_id,
      empresa_id,
      moneda,
      ...campos,
    })
    if (error) return { ok: false, error: error.message }

    // Contrato inicial (historial) — espejo del snapshot recién creado
    await db.from('contratos').insert({
      contrato_id:   generarContratoId(),
      client_id:     session.client_id,
      empleado_id:   nuevoId,
      tipo_contrato,
      fecha_inicio:  fecha_alta,
      fecha_fin:     null,
      salario_base,
      moneda,
      periodicidad,
      notas:         'Contrato inicial',
    })
  } else {
    // Editar — la moneda no se cambia (la nómina quedaría inconsistente).
    const { error } = await db.from('empleados')
      .update(campos)
      .eq('empleado_id', empleado_id)
      .eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/portal/rrhh')
  return { ok: true }
}

// ── Dar de baja / reactivar ──────────────────────────────────────────────────────

export async function darBajaEmpleado(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const empleado_id = (formData.get('empleado_id') as string)?.trim()
  const fecha_baja  = (formData.get('fecha_baja')  as string)?.trim() || hoy()
  const motivo_baja = (formData.get('motivo_baja') as string)?.trim() || null
  if (!empleado_id) return { ok: false, error: 'Empleado no válido.' }

  const db = createAdminClient()
  const { error } = await db.from('empleados')
    .update({ fecha_baja, motivo_baja, updated_at: new Date().toISOString() })
    .eq('empleado_id', empleado_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/rrhh')
  return { ok: true }
}

export async function reactivarEmpleado(empleado_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()
  const { error } = await db.from('empleados')
    .update({ fecha_baja: null, motivo_baja: null, updated_at: new Date().toISOString() })
    .eq('empleado_id', empleado_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/rrhh')
  return { ok: true }
}

// ── Eliminar empleado ─────────────────────────────────────────────────────────────
// Bloqueado si aparece en nóminas registradas (conserva el historial → dar de baja).

export async function eliminarEmpleado(empleado_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  const { count } = await db.from('nomina_lineas')
    .select('linea_id', { count: 'exact', head: true })
    .eq('client_id', session.client_id)
    .eq('empleado_id', empleado_id)
  if ((count ?? 0) > 0) {
    return { ok: false, error: 'Aparece en nóminas registradas. Da de baja en su lugar para conservar el historial.' }
  }

  const { error } = await db.from('empleados').delete()
    .eq('empleado_id', empleado_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/rrhh')
  return { ok: true }
}

// ════════════════════════════════════════════════════════════════════════════════
// CONTRATOS (historial)
// ════════════════════════════════════════════════════════════════════════════════

// ── Nuevo contrato ───────────────────────────────────────────────────────────────
// Cierra el contrato vigente, abre uno nuevo y actualiza el snapshot del empleado
// (lo que lee la nómina). La moneda no cambia (se hereda del empleado).

export async function guardarContrato(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const empleado_id  = (formData.get('empleado_id')  as string)?.trim()
  const tipo_raw     = (formData.get('tipo_contrato') as string)?.trim() as TipoContrato
  const fecha_inicio = (formData.get('fecha_inicio') as string)?.trim() || hoy()
  const periodi_raw  = (formData.get('periodicidad') as string)?.trim() as Periodicidad
  const salarioRaw   = parseFloat(formData.get('salario_base') as string)
  const notas        = (formData.get('notas')        as string)?.trim() || null

  if (!empleado_id) return { ok: false, error: 'Empleado no válido.' }

  const tipo_contrato = TIPOS_CONTRATO.includes(tipo_raw)    ? tipo_raw    : 'INDEFINIDO'
  const periodicidad  = PERIODICIDADES.includes(periodi_raw) ? periodi_raw : 'MENSUAL'
  const salario_base  = isNaN(salarioRaw) || salarioRaw < 0 ? 0 : salarioRaw

  const db = createAdminClient()

  const { data: empleado } = await db.from('empleados')
    .select('moneda')
    .eq('empleado_id', empleado_id)
    .eq('client_id', session.client_id)
    .single()
  if (!empleado) return { ok: false, error: 'Empleado no encontrado.' }

  // Cerrar el contrato vigente
  await db.from('contratos')
    .update({ fecha_fin: fecha_inicio })
    .eq('client_id', session.client_id)
    .eq('empleado_id', empleado_id)
    .is('fecha_fin', null)

  const { error } = await db.from('contratos').insert({
    contrato_id:  generarContratoId(),
    client_id:    session.client_id,
    empleado_id,
    tipo_contrato,
    fecha_inicio,
    fecha_fin:    null,
    salario_base,
    moneda:       empleado.moneda,
    periodicidad,
    notas,
  })
  if (error) return { ok: false, error: error.message }

  // Actualizar el snapshot del empleado (lo que usa la nómina)
  await db.from('empleados')
    .update({ tipo_contrato, salario_base, periodicidad, updated_at: new Date().toISOString() })
    .eq('empleado_id', empleado_id)
    .eq('client_id', session.client_id)

  revalidatePath('/portal/rrhh')
  return { ok: true }
}

// ── Eliminar contrato ────────────────────────────────────────────────────────────
// Si era el vigente, reabre el anterior y restaura el snapshot del empleado.

export async function eliminarContrato(contrato_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  const { data: contrato } = await db.from('contratos')
    .select('empleado_id, fecha_fin')
    .eq('contrato_id', contrato_id)
    .eq('client_id', session.client_id)
    .single()
  if (!contrato) return { ok: false, error: 'Contrato no encontrado.' }

  const eraVigente = contrato.fecha_fin === null

  if (eraVigente) {
    // Buscar el contrato anterior (el más reciente de los restantes)
    const { data: previos } = await db.from('contratos')
      .select('*')
      .eq('client_id', session.client_id)
      .eq('empleado_id', contrato.empleado_id)
      .neq('contrato_id', contrato_id)
      .order('fecha_inicio', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
    const previo = (previos ?? [])[0] as Contrato | undefined
    if (!previo) {
      return { ok: false, error: 'Es el único contrato del empleado. Edita el empleado en Personal o dalo de baja.' }
    }
    // Reabrir el anterior y restaurar el snapshot
    await db.from('contratos')
      .update({ fecha_fin: null })
      .eq('contrato_id', previo.contrato_id)
      .eq('client_id', session.client_id)
    await db.from('empleados')
      .update({
        tipo_contrato: previo.tipo_contrato,
        salario_base:  previo.salario_base,
        periodicidad:  previo.periodicidad,
        updated_at:    new Date().toISOString(),
      })
      .eq('empleado_id', contrato.empleado_id)
      .eq('client_id', session.client_id)
  }

  const { error } = await db.from('contratos').delete()
    .eq('contrato_id', contrato_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/rrhh')
  return { ok: true }
}

// ════════════════════════════════════════════════════════════════════════════════
// NÓMINA
// ════════════════════════════════════════════════════════════════════════════════

// ── Crear nómina ────────────────────────────────────────────────────────────────
// Genera una nómina BORRADOR y precarga una línea por cada empleado ACTIVO de la
// empresa cuya moneda coincide (devengado = neto = salario_base).

export async function crearNomina(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const empresa_id = (formData.get('empresa_id') as string)?.trim()
  const periodo    = (formData.get('periodo')    as string)?.trim()   // YYYY-MM
  const moneda     = (formData.get('moneda')     as string)?.trim()
  const fecha      = (formData.get('fecha')      as string)?.trim() || hoy()
  const notas      = (formData.get('notas')      as string)?.trim() || null

  if (!empresa_id)                 return { ok: false, error: 'Debes seleccionar una empresa.' }
  if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) return { ok: false, error: 'El período debe tener formato AAAA-MM.' }
  if (!moneda)                     return { ok: false, error: 'Debes seleccionar una moneda.' }

  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_id)) {
    return { ok: false, error: 'Empresa no válida.' }
  }

  const db = createAdminClient()

  const { data: empData } = await db.from('empleados')
    .select('empleado_id, nombre, apellidos, cargo, salario_base')
    .eq('client_id', session.client_id)
    .eq('empresa_id', empresa_id)
    .eq('moneda', moneda)
    .is('fecha_baja', null)
    .order('nombre')
  const activos = (empData ?? []) as { empleado_id: string; nombre: string; apellidos: string | null; cargo: string | null; salario_base: number }[]

  if (!activos.length) {
    return { ok: false, error: `No hay empleados activos en esa empresa con salario en ${moneda}.` }
  }

  const nomina_id = generarNominaId()
  const total     = activos.reduce((s, e) => s + Number(e.salario_base), 0)

  const { error: nomErr } = await db.from('nominas').insert({
    nomina_id,
    client_id:  session.client_id,
    empresa_id,
    periodo,
    fecha,
    moneda,
    estado:     'BORRADOR',
    total,
    notas,
    updated_at: new Date().toISOString(),
  })
  if (nomErr) return { ok: false, error: nomErr.message }

  const lineas = activos.map(e => {
    const base = Number(e.salario_base)
    return {
      linea_id:        generarLineaId(),
      nomina_id,
      client_id:       session.client_id,
      empleado_id:     e.empleado_id,
      empleado_nombre: [e.nombre, e.apellidos].filter(Boolean).join(' '),
      cargo:           e.cargo,
      salario_base:    base,
      devengado:       base,
      deducciones:     0,
      neto:            base,
    }
  })
  const { error: linErr } = await db.from('nomina_lineas').insert(lineas)
  if (linErr) {
    await db.from('nominas').delete().eq('nomina_id', nomina_id).eq('client_id', session.client_id)
    return { ok: false, error: linErr.message }
  }

  revalidatePath('/portal/rrhh')
  return { ok: true }
}

// ── Editar línea de nómina (solo BORRADOR) ──────────────────────────────────────
// Ajusta devengado / deducciones; recalcula neto y el total de la nómina.

export async function guardarLineaNomina(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const linea_id        = (formData.get('linea_id') as string)?.trim()
  const devengadoRaw    = parseFloat(formData.get('devengado')   as string)
  const deduccionesRaw  = parseFloat(formData.get('deducciones') as string)
  if (!linea_id) return { ok: false, error: 'Línea no válida.' }

  const devengado   = isNaN(devengadoRaw)   || devengadoRaw   < 0 ? 0 : devengadoRaw
  const deducciones = isNaN(deduccionesRaw) || deduccionesRaw < 0 ? 0 : deduccionesRaw
  if (deducciones > devengado) return { ok: false, error: 'Las deducciones no pueden superar el devengado.' }
  const neto = devengado - deducciones

  const db = createAdminClient()

  const { data: linea } = await db.from('nomina_lineas')
    .select('nomina_id')
    .eq('linea_id', linea_id)
    .eq('client_id', session.client_id)
    .single()
  if (!linea) return { ok: false, error: 'Línea no encontrada.' }

  const { data: nomina } = await db.from('nominas')
    .select('estado')
    .eq('nomina_id', linea.nomina_id)
    .eq('client_id', session.client_id)
    .single()
  if (!nomina) return { ok: false, error: 'Nómina no encontrada.' }
  if (nomina.estado !== 'BORRADOR') return { ok: false, error: 'La nómina ya está confirmada y no se puede editar.' }

  const { error } = await db.from('nomina_lineas')
    .update({ devengado, deducciones, neto })
    .eq('linea_id', linea_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  // Recalcular total de la nómina
  const { data: todas } = await db.from('nomina_lineas')
    .select('neto')
    .eq('nomina_id', linea.nomina_id)
    .eq('client_id', session.client_id)
  const total = (todas ?? []).reduce((s, l) => s + Number(l.neto), 0)
  await db.from('nominas')
    .update({ total, updated_at: new Date().toISOString() })
    .eq('nomina_id', linea.nomina_id)
    .eq('client_id', session.client_id)

  revalidatePath('/portal/rrhh')
  return { ok: true }
}

// ── Confirmar nómina ────────────────────────────────────────────────────────────
// Crea un GASTO "Salarios" en gastos_cobros (fluye a CxP / Tesorería / Reportes)
// y enlaza su id. La nómina queda CONFIRMADA y deja de ser editable.

export async function confirmarNomina(nomina_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  const { data: nomina } = await db.from('nominas')
    .select('*')
    .eq('nomina_id', nomina_id)
    .eq('client_id', session.client_id)
    .single()
  if (!nomina)                       return { ok: false, error: 'Nómina no encontrada.' }
  if (nomina.estado !== 'BORRADOR')  return { ok: false, error: 'La nómina ya está confirmada.' }

  const { data: lineas } = await db.from('nomina_lineas')
    .select('neto')
    .eq('nomina_id', nomina_id)
    .eq('client_id', session.client_id)
  const total = (lineas ?? []).reduce((s, l) => s + Number(l.neto), 0)
  if (total <= EPS) return { ok: false, error: 'La nómina no tiene importe a pagar.' }

  const gasto_id = generarGastoId()
  const { error: gErr } = await db.from('gastos_cobros').insert({
    registro_id: gasto_id,
    client_id:   session.client_id,
    empresa_id:  nomina.empresa_id,
    tipo:        'GASTO',
    fecha:       nomina.fecha,
    categoria:   'Salarios',
    descripcion: `Nómina ${nomina.periodo}`,
    moneda:      nomina.moneda,
    monto:       total,
    notas:       `Nómina ${nomina_id}`,
    updated_at:  new Date().toISOString(),
  })
  if (gErr) return { ok: false, error: gErr.message }

  const { error: nErr } = await db.from('nominas')
    .update({ estado: 'CONFIRMADA', gasto_id, total, updated_at: new Date().toISOString() })
    .eq('nomina_id', nomina_id)
    .eq('client_id', session.client_id)
  if (nErr) {
    await db.from('gastos_cobros').delete().eq('registro_id', gasto_id).eq('client_id', session.client_id)
    return { ok: false, error: nErr.message }
  }

  revalidatePath('/portal/rrhh')
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/cxp')
  revalidatePath('/portal/tesoreria')
  revalidatePath('/portal/reportes')
  return { ok: true }
}

// ── Eliminar nómina ──────────────────────────────────────────────────────────────
// Si está confirmada, solo si el gasto enlazado no tiene pagos en Tesorería.

export async function eliminarNomina(nomina_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()

  const { data: nomina } = await db.from('nominas')
    .select('estado, gasto_id')
    .eq('nomina_id', nomina_id)
    .eq('client_id', session.client_id)
    .single()
  if (!nomina) return { ok: false, error: 'Nómina no encontrada.' }

  if (nomina.estado === 'CONFIRMADA' && nomina.gasto_id) {
    const { count } = await db.from('movimientos_tesoreria')
      .select('movimiento_id', { count: 'exact', head: true })
      .eq('client_id', session.client_id)
      .eq('referencia_id', nomina.gasto_id)
    if ((count ?? 0) > 0) {
      return { ok: false, error: 'El gasto de esta nómina tiene pagos registrados. Anúlalos en Tesorería antes de eliminar.' }
    }
    await db.from('gastos_cobros').delete().eq('registro_id', nomina.gasto_id).eq('client_id', session.client_id)
  }

  await db.from('nomina_lineas').delete().eq('nomina_id', nomina_id).eq('client_id', session.client_id)
  const { error } = await db.from('nominas').delete()
    .eq('nomina_id', nomina_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/rrhh')
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/cxp')
  return { ok: true }
}

// ════════════════════════════════════════════════════════════════════════════════
// TURNOS (catálogo + planificador semanal)
// ════════════════════════════════════════════════════════════════════════════════

// ── Guardar turno (crear / editar catálogo) ─────────────────────────────────────

export async function guardarTurno(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const turno_id    = (formData.get('turno_id')    as string)?.trim()
  const empresa_id  = (formData.get('empresa_id')  as string)?.trim()
  const nombre      = (formData.get('nombre')      as string)?.trim()
  const hora_inicio = (formData.get('hora_inicio') as string)?.trim() || null
  const hora_fin    = (formData.get('hora_fin')    as string)?.trim() || null
  const color       = (formData.get('color')       as string)?.trim() || null

  if (!nombre)     return { ok: false, error: 'El nombre del turno es obligatorio.' }
  if (!empresa_id) return { ok: false, error: 'Debes seleccionar una empresa.' }

  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_id)) {
    return { ok: false, error: 'Empresa no válida.' }
  }

  const db = createAdminClient()

  if (!turno_id) {
    const { error } = await db.from('turnos').insert({
      turno_id: generarTurnoId(),
      client_id: session.client_id,
      empresa_id, nombre, hora_inicio, hora_fin, color,
      activo: true,
      updated_at: new Date().toISOString(),
    })
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await db.from('turnos')
      .update({ nombre, hora_inicio, hora_fin, color, updated_at: new Date().toISOString() })
      .eq('turno_id', turno_id)
      .eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/portal/rrhh')
  return { ok: true }
}

// ── Eliminar turno (borra también sus asignaciones) ─────────────────────────────

export async function eliminarTurno(turno_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const db = createAdminClient()
  await db.from('turno_asignaciones').delete()
    .eq('client_id', session.client_id).eq('turno_id', turno_id)
  const { error } = await db.from('turnos').delete()
    .eq('turno_id', turno_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/rrhh')
  return { ok: true }
}

// ── Asignar turno a (empleado, día) ─────────────────────────────────────────────
// turno_id vacío → libera la celda. Un turno por empleado y día (reemplaza).

export async function asignarTurno(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }

  const empleado_id = (formData.get('empleado_id') as string)?.trim()
  const diaRaw      = parseInt(formData.get('dia_semana') as string, 10)
  const turno_id    = (formData.get('turno_id')    as string)?.trim() || ''

  if (!empleado_id)                       return { ok: false, error: 'Empleado no válido.' }
  if (isNaN(diaRaw) || diaRaw < 1 || diaRaw > 7) return { ok: false, error: 'Día no válido.' }

  const db = createAdminClient()

  // Reemplazo: borra la asignación previa de esa celda
  await db.from('turno_asignaciones').delete()
    .eq('client_id', session.client_id)
    .eq('empleado_id', empleado_id)
    .eq('dia_semana', diaRaw)

  if (turno_id) {
    const { data: turno } = await db.from('turnos')
      .select('turno_id')
      .eq('turno_id', turno_id)
      .eq('client_id', session.client_id)
      .single()
    if (!turno) return { ok: false, error: 'Turno no encontrado.' }

    const { error } = await db.from('turno_asignaciones').insert({
      asignacion_id: generarAsignacionId(),
      client_id:     session.client_id,
      empleado_id,
      dia_semana:    diaRaw,
      turno_id,
    })
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/portal/rrhh')
  return { ok: true }
}
