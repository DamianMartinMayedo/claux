'use server'

import { revalidatePath }    from 'next/cache'
import { revalidarFinanzas } from './_finanzas-revalidar'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarModulo }  from './auth'
import { obtenerEmpresas }   from './empresas'
import { mapaTasas, monedaValida } from '@/lib/tasas'
import type { MonedaOpcion } from './monedas'
import {
  TIPOS_CONTRATO, PERIODICIDADES, generarEmpleadoId, construirCamposEmpleado,
  type TipoContrato as _TipoContrato, type Periodicidad as _Periodicidad,
} from '@/lib/rrhh-core'
import { resolverCategoriaSistema } from '@/lib/gastos-core'

// ── Tipos ─────────────────────────────────────────────────────────────────────

// Los tipos y helpers de Personal viven en `@/lib/rrhh-core` (una sola fuente,
// compartida con el importador). Se re-declaran directamente porque el re-export
// agregado `export type { … } from …` rompe el loader de 'use server'.
export type TipoContrato   = _TipoContrato
export type Periodicidad   = _Periodicidad
export type EstadoEmpleado = 'ACTIVO' | 'BAJA'

export interface Empleado {
  empleado_id:   string
  client_id:     string
  empresa_id:    string
  nombre:        string
  apellidos:     string | null
  documento:     string | null
  documento_vencimiento: string | null
  fecha_nacimiento:      string | null
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
  pdf_url:       string | null
  pdf_nombre:    string | null
  created_at:    string
}

export type TipoConcepto = 'BONO' | 'DEDUCCION'
export type ModoConcepto = 'FIJO' | 'PORCENTAJE'

export interface ConceptoEmpleado {
  concepto_id: string
  empleado_id: string
  nombre:      string
  tipo:        TipoConcepto
  modo:        ModoConcepto
  valor:       number
  activo:      boolean
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
  /**
   * La línea NO coincide con los conceptos vigentes del trabajador: le falta (o le
   * sobra) un bono o una deducción. Es lo que decide si sale el aviso de actualizar.
   * También se marca en una nómina CONFIRMADA: ahí actualizarla implica reabrirla
   * (revertir sus gastos), que es un paso más pero es el caso real —cuando uno se
   * acuerda de la retención, la nómina del mes ya está cerrada—.
   */
  desfasada:       boolean
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
  /** Alguna de sus líneas está desfasada respecto a los conceptos vigentes. */
  desactualizada:  boolean
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
  nominas:         NominaConLineas[]
  turnos_catalogo: Turno[]
  asignaciones:    TurnoAsignacion[]
  cuentas:         { cuenta_id: string; nombre: string; empresa_id: string; moneda: string }[]
  empresas:        { empresa_id: string; nombre: string; moneda_funcional: string | null }[]
  monedas:         MonedaOpcion[]
  /** Factores entre las monedas del cliente ("ORIGEN__DESTINO" → factor). */
  tasas:           Record<string, number>
  cargos:          string[]
  departamentos:   string[]
  turnos:          string[]
  empresa_nombres: Record<string, string>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EPS = 0.005

function corto(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()
}
function generarContratoId():   string { return `CON-${corto()}` }
function generarNominaId():     string { return `NOM-${corto()}` }
function generarLineaId():      string { return `NLN-${corto()}` }
function generarGastoId():      string { return `GAS-${corto()}` }
function generarTurnoId():      string { return `TUR-${corto()}` }
function generarAsignacionId(): string { return `TAS-${corto()}` }
function generarConceptoId():   string { return `CPT-${corto()}` }

function redondear2(n: number): number { return Math.round(n * 100) / 100 }

interface ConceptoAplicable { nombre?: string; tipo: TipoConcepto; modo: ModoConcepto; valor: number }

/**
 * Fórmula ÚNICA de una línea de nómina: devengado = salario del período + bonos,
 * deducciones = suma de las deducciones, y el PORCENTAJE se calcula sobre el
 * SALARIO BASE (no sobre el devengado). La comparten los tres sitios que la
 * necesitan —generar la nómina, recalcularla y detectar que está desfasada—:
 * con una copia por sitio, lo que la pantalla avisa y lo que se guarda acabarían
 * discrepando, y en dinero eso no se ve hasta que ya está confirmado.
 */
function aplicarConceptos(base: number, conceptos: ConceptoAplicable[]): {
  devengado:   number
  deducciones: number
  neto:        number
  /** Las deducciones superaban el devengado y se han recortado a él. */
  recortada:   boolean
  detalle:     { nombre: string; tipo: TipoConcepto; monto: number }[]
} {
  let devengado   = base
  let deducciones = 0
  const detalle: { nombre: string; tipo: TipoConcepto; monto: number }[] = []
  for (const c of conceptos) {
    const monto = redondear2(c.modo === 'PORCENTAJE' ? (base * c.valor) / 100 : c.valor)
    if (c.tipo === 'BONO') devengado += monto
    else                   deducciones += monto
    detalle.push({ nombre: c.nombre ?? '', tipo: c.tipo, monto })
  }
  devengado   = redondear2(devengado)
  deducciones = redondear2(deducciones)
  const recortada = deducciones > devengado + EPS
  if (recortada) deducciones = devengado
  return { devengado, deducciones, neto: redondear2(Math.max(0, devengado - deducciones)), recortada, detalle }
}

// Copia un empleado a otra empresa como registro INDEPENDIENTE (misma persona, nueva
// relación laboral: cada empresa tiene su contrato/salario/moneda). Se copian los
// datos como punto de partida y queda activo; el salario/moneda se ajustan luego.
export async function copiarEmpleadoAEmpresa(
  empleado_id: string,
  empresa_destino: string,
  moneda?: string | null,
  salario?: number | null,
): Promise<{ ok: boolean; error?: string; empleado_id?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_destino)) {
    return { ok: false, error: 'Empresa destino no válida.' }
  }

  const db = createAdminClient()
  const { data: src } = await db.from('empleados').select('*')
    .eq('empleado_id', empleado_id).eq('client_id', session.client_id).maybeSingle()
  if (!src) return { ok: false, error: 'No se encontró el empleado a copiar.' }
  if (!empresas.some(e => e.empresa_id === src.empresa_id)) {
    return { ok: false, error: 'Sin acceso al registro original.' }
  }
  if (src.empresa_id === empresa_destino) {
    return { ok: false, error: 'El empleado ya pertenece a esa empresa.' }
  }

  // La copia nace con la moneda de SU empresa (la propone el modal), no con la
  // de origen: el mismo salario en otra moneda no es el mismo salario. El
  // salario llega ya en esa moneda — el modal lo convierte con la tasa vigente
  // y deja corregirlo antes de copiar.
  const monedaFinal = moneda?.trim() || src.moneda
  if (monedaFinal !== src.moneda && !await monedaValida(db, session.client_id, monedaFinal)) {
    return { ok: false, error: `La moneda "${monedaFinal}" no está configurada.` }
  }

  const salario_base = (salario != null && !isNaN(salario) && salario >= 0)
    ? salario
    : (src.salario_base as number)

  const nuevo_id = generarEmpleadoId()
  const ahora    = new Date().toISOString()

  // Defensivo: aquí la PRIMARY KEY sí es `empleado_id` (que se regenera arriba),
  // así que copiar la fila entera funciona. Pero varias tablas del esquema base
  // llevan además una `id` uuid que SÍ es su PK —third_parties es una, y por eso
  // su copia reventaba—, así que no dependemos de esa diferencia: si algún día
  // `empleados` gana una `id`, esto seguirá copiando bien en vez de romperse.
  const { id: _id, ...datosOrigen } = src as Record<string, unknown>
  void _id

  const { error } = await db.from('empleados').insert({
    ...datosOrigen,
    empleado_id: nuevo_id,
    empresa_id:  empresa_destino,
    moneda:      monedaFinal,
    salario_base,
    fecha_baja:  null,
    motivo_baja: null,
    created_at:  ahora,
    updated_at:  ahora,
  })
  if (error) { console.error('[rrhh] copiar empleado error:', error); return { ok: false, error: `No se pudo copiar: ${error.message}` } }
  revalidatePath('/portal/rrhh')
  return { ok: true, empleado_id: nuevo_id }
}

// ── Copiar a otra empresa en lote (Fase 3 — máximo cuidado, Regla A) ─────────────
// Envuelve la individual (excluye la PK y regenera el código). Añade la DEDUP que la
// individual no trae: por nombre+apellidos en la empresa destino (no hay índice único
// → copiar en lote duplicaría). Un destino por operación; cada uno conserva SU
// moneda/salario (no se convierte a ciegas). Usa el ResultadoLote/loteVacio de abajo.
export async function copiarEmpleadosAEmpresaEnLote(
  ids: string[], empresa_destino: string,
): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session)             return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('rrhh'))) return loteVacio('No tienes permiso para editar en este módulo.')
  if (!empresa_destino) return loteVacio('Elige una empresa destino.')
  if (!ids.length) return loteVacio()

  const db = createAdminClient()
  const { data: origen } = await db.from('empleados')
    .select('empleado_id, nombre, apellidos, empresa_id')
    .eq('client_id', session.client_id).in('empleado_id', ids)
  const { data: enDestino } = await db.from('empleados')
    .select('nombre, apellidos')
    .eq('client_id', session.client_id).eq('empresa_id', empresa_destino)
  const claveDe = (n: string, a: string | null) => `${n.trim().toLowerCase()}|${(a ?? '').trim().toLowerCase()}`
  const existentes = new Set((enDestino ?? []).map((e: { nombre: string; apellidos: string | null }) => claveDe(e.nombre, e.apellidos)))

  const res = loteVacio()
  for (const e of (origen ?? []) as { empleado_id: string; nombre: string; apellidos: string | null; empresa_id: string }[]) {
    const etiqueta = `${e.nombre}${e.apellidos ? ' ' + e.apellidos : ''}`
    const k = claveDe(e.nombre, e.apellidos)
    if (e.empresa_id === empresa_destino) { res.omitidas.push({ etiqueta, motivo: 'ya pertenece a esa empresa' }); continue }
    if (existentes.has(k))                { res.omitidas.push({ etiqueta, motivo: 'ya existe en la empresa destino' }); continue }
    const r = await copiarEmpleadoAEmpresa(e.empleado_id, empresa_destino)   // conserva su moneda/salario
    if (r.ok) { res.hechas++; existentes.add(k) }
    else res.omitidas.push({ etiqueta, motivo: r.error ?? 'No se pudo copiar' })
  }
  revalidatePath('/portal/rrhh')
  return res
}

function hoy(): string {
  return new Date().toISOString().split('T')[0]
}
function estadoDe(fecha_baja: string | null): EstadoEmpleado {
  return fecha_baja ? 'BAJA' : 'ACTIVO'
}

// ── Acciones en lote — tipo compartido (nómina + personal) ──────────────────────
// Reutilizan las acciones individuales (mismo gating y efectos en cadena). La capa
// de lote decide la ELEGIBILIDAD por estado y reporta lo omitido con su etiqueta.

export interface ResultadoLote {
  hechas:   number
  omitidas: { etiqueta: string; motivo: string }[]
  errores:  { etiqueta: string; error: string }[]
  error?:   string
}
const loteVacio = (error?: string): ResultadoLote => ({ hechas: 0, omitidas: [], errores: [], error })

// ── Obtener datos de RRHH ───────────────────────────────────────────────────────

export async function obtenerRrhh(): Promise<RrhhPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db          = createAdminClient()
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  const idsFiltro   = empresa_ids.length ? empresa_ids : ['__none__']

  const [empRes, monRes, nomRes, nlnRes, turRes, tasRes, cuRes, cptRes] = await Promise.all([
    db.from('empleados').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('fecha_baja', { ascending: true, nullsFirst: true })
      .order('nombre', { ascending: true }),
    db.from('monedas').select('codigo, nombre')
      .eq('client_id', session.client_id)
      .eq('activa', true)
      .order('es_consolidacion', { ascending: false })
      .order('codigo'),
    db.from('nominas').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('periodo', { ascending: false })
      .order('created_at', { ascending: false }),
    db.from('nomina_lineas').select('*')
      .eq('client_id', session.client_id)
      .order('empleado_nombre', { ascending: true }),
    db.from('turnos').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('nombre', { ascending: true }),
    db.from('turno_asignaciones').select('*')
      .eq('client_id', session.client_id),
    db.from('cuentas').select('cuenta_id, nombre, empresa_id, moneda, activa')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .eq('activa', true)
      .eq('es_apertura', false)   // técnica de la migración (mig. 130): no se paga desde ella
      .order('nombre'),
    // Conceptos activos de TODO el cliente en una sola consulta: con ellos se marca
    // el desfase de cada línea sin pedir nada por nómina (eran 3 consultas por
    // borrador, y esta pantalla se abre en 3G).
    db.from('conceptos_empleado').select('empleado_id, nombre, tipo, modo, valor')
      .eq('client_id', session.client_id)
      .eq('activo', true)
      .order('created_at'),
  ])

  const empleados = ((empRes.data ?? []) as Empleado[]).map(e => ({
    ...e,
    salario_base: Number(e.salario_base),
    estado:       estadoDe(e.fecha_baja),
  }))
  const empleadoIds = new Set(empleados.map(e => e.empleado_id))

  // Turnos (catálogo) y asignaciones de los empleados accesibles
  const turnos_catalogo = (turRes.data ?? []) as Turno[]
  const asignaciones = ((tasRes.data ?? []) as TurnoAsignacion[])
    .filter(a => empleadoIds.has(a.empleado_id))

  // Nóminas con sus líneas y el estado de pago del gasto enlazado
  const nominasRaw = (nomRes.data ?? []) as Nomina[]
  const lineasRaw  = (nlnRes.data ?? []) as (NominaLinea & { client_id: string })[]

  // Conceptos vigentes por trabajador → sirven para marcar qué línea de borrador
  // NO los refleja (el aviso de «actualizar» solo aparece si hay desfase real).
  const conceptosPorEmpleado = new Map<string, ConceptoAplicable[]>()
  for (const c of (cptRes.data ?? []) as { empleado_id: string; nombre: string; tipo: TipoConcepto; modo: ModoConcepto; valor: number }[]) {
    const arr = conceptosPorEmpleado.get(c.empleado_id) ?? []
    arr.push({ nombre: c.nombre, tipo: c.tipo, modo: c.modo, valor: Number(c.valor) })
    conceptosPorEmpleado.set(c.empleado_id, arr)
  }
  const estadoPorNomina = new Map(nominasRaw.map(n => [n.nomina_id, n.estado]))

  const lineasPorNomina = new Map<string, NominaLinea[]>()
  for (const l of lineasRaw) {
    const arr = lineasPorNomina.get(l.nomina_id) ?? []
    const devengado   = Number(l.devengado)
    const deducciones = Number(l.deducciones)
    // También en las CONFIRMADAS: reabrirlas para meter una retención olvidada es
    // el caso real (la nómina del mes ya está cerrada cuando uno se acuerda), así
    // que ocultar el desfase ahí obligaba a borrar la nómina y regenerarla.
    const calc = estadoPorNomina.has(l.nomina_id)
      ? aplicarConceptos(Number(l.salario_base), conceptosPorEmpleado.get(l.empleado_id) ?? [])
      : null
    arr.push({
      linea_id:        l.linea_id,
      nomina_id:       l.nomina_id,
      empleado_id:     l.empleado_id,
      empleado_nombre: l.empleado_nombre,
      cargo:           l.cargo,
      salario_base:    Number(l.salario_base),
      devengado,
      deducciones,
      neto:            Number(l.neto),
      notas:           l.notas,
      desfasada:       !!calc && (Math.abs(devengado - calc.devengado) > EPS
                               || Math.abs(deducciones - calc.deducciones) > EPS),
    })
    lineasPorNomina.set(l.nomina_id, arr)
  }

  // Pagos del gasto enlazado (liquidación unificada en Tesorería)
  const gastoIds = nominasRaw.map(n => n.gasto_id).filter((g): g is string => !!g)
  const pagadoPorGasto = new Map<string, number>()
  if (gastoIds.length) {
    const { data: movs } = await db.from('movimientos_tesoreria')
      .select('monto, monto_ref, referencia_id')
      .eq('client_id', session.client_id)
      .in('referencia_id', gastoIds)
    // Saldo de la nómina en su moneda → se suma monto_ref (importe aplicado)
    for (const m of (movs ?? []) as { monto: number; monto_ref: number | null; referencia_id: string }[]) {
      pagadoPorGasto.set(m.referencia_id, (pagadoPorGasto.get(m.referencia_id) ?? 0) + Number(m.monto_ref ?? m.monto))
    }
  }

  const nominas: NominaConLineas[] = nominasRaw.map(n => {
    const total  = Number(n.total)
    const pagado = n.gasto_id ? (pagadoPorGasto.get(n.gasto_id) ?? 0) : 0
    const lineas = lineasPorNomina.get(n.nomina_id) ?? []
    return {
      ...n,
      total,
      lineas,
      pagado,
      saldo_pendiente: Math.max(0, total - pagado),
      desactualizada:  lineas.some(l => l.desfasada),
    }
  })

  const datalist = (vals: (string | null)[]) =>
    Array.from(new Set(vals.filter((v): v is string => !!v))).sort()

  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre

  const cuentas = ((cuRes.data ?? []) as { cuenta_id: string; nombre: string; empresa_id: string; moneda: string; activa: boolean }[])
    .map(c => ({ cuenta_id: c.cuenta_id, nombre: c.nombre, empresa_id: c.empresa_id, moneda: c.moneda }))

  const monedas = (monRes.data ?? []) as MonedaOpcion[]
  const tasas   = await mapaTasas(db, session.client_id, monedas.map(m => m.codigo))

  return {
    empleados,
    nominas,
    turnos_catalogo,
    asignaciones,
    cuentas,
    empresas:       empresas.map(e => ({
      empresa_id: e.empresa_id, nombre: e.nombre, moneda_funcional: e.moneda_funcional,
    })),
    monedas,
    tasas,
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
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const empleado_id  = (formData.get('empleado_id')  as string)?.trim()
  const empresa_id   = (formData.get('empresa_id')   as string)?.trim()
  const nombre       = (formData.get('nombre')       as string)?.trim()
  const moneda       = (formData.get('moneda')       as string)?.trim()

  if (!nombre)      return { ok: false, error: 'El nombre es obligatorio.' }
  if (!empresa_id)  return { ok: false, error: 'Debes seleccionar una empresa.' }

  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_id)) {
    return { ok: false, error: 'Empresa no válida.' }
  }

  // La normalización (contrato, periodicidad, salario, fecha de alta) la hace el
  // núcleo compartido con el importador (`@/lib/rrhh-core`).
  const campos = construirCamposEmpleado({
    nombre,
    apellidos:             (formData.get('apellidos')             as string) ?? null,
    documento:             (formData.get('documento')             as string) ?? null,
    documento_vencimiento: (formData.get('documento_vencimiento') as string) ?? null,
    fecha_nacimiento:      (formData.get('fecha_nacimiento')      as string) ?? null,
    telefono:              (formData.get('telefono')              as string) ?? null,
    email:                 (formData.get('email')                 as string) ?? null,
    direccion:             (formData.get('direccion')             as string) ?? null,
    cargo:                 (formData.get('cargo')                 as string) ?? null,
    departamento:          (formData.get('departamento')          as string) ?? null,
    turno:                 (formData.get('turno')                 as string) ?? null,
    tipo_contrato:         (formData.get('tipo_contrato')         as string) ?? null,
    fecha_alta:            (formData.get('fecha_alta')            as string) ?? null,
    salario_base:          parseFloat(formData.get('salario_base') as string),
    periodicidad:          (formData.get('periodicidad')          as string) ?? null,
    notas:                 (formData.get('notas')                 as string) ?? null,
  })

  if (!moneda) return { ok: false, error: 'Debes seleccionar una moneda.' }

  if (!empleado_id) {
    if (!await monedaValida(db, session.client_id, moneda)) {
      return { ok: false, error: `La moneda "${moneda}" no está configurada en Monedas y Tasas.` }
    }
    const nuevoId = generarEmpleadoId()
    const { error } = await db.from('empleados').insert({
      empleado_id: nuevoId,
      client_id:   session.client_id,
      empresa_id,
      moneda,
      ...campos,
    })
    if (error) return { ok: false, error: error.message }
  } else {
    // La moneda SÍ se cambia: un empleado copiado a una empresa que opera en
    // otra moneda nacía con la de origen y, con el campo bloqueado, no había
    // forma de arreglarlo. Las nóminas ya emitidas no se tocan — cada una
    // guarda su moneda y sus líneas son un snapshot cerrado —, así que el
    // cambio solo afecta a las nóminas futuras; el modal avisa antes.
    // El salario llega ya en la moneda nueva: al cambiarla, el formulario lo
    // convierte con la tasa vigente y el dueño puede corregirlo antes de guardar.
    const { data: previo } = await db.from('empleados')
      .select('moneda')
      .eq('empleado_id', empleado_id).eq('client_id', session.client_id).maybeSingle()
    if (!previo) return { ok: false, error: 'Empleado no encontrado.' }

    if (moneda !== previo.moneda && !await monedaValida(db, session.client_id, moneda)) {
      return { ok: false, error: `La moneda "${moneda}" no está configurada en Monedas y Tasas.` }
    }

    const { error } = await db.from('empleados')
      .update({ ...campos, moneda })
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
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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

// ── Personal en lote (Fase 2) ────────────────────────────────────────────────────
// Candado `rrhh` inline (audit-gating). Baja/reactivar son UPDATE atómicos (no tienen
// guarda de negocio, solo el gating); eliminar reutiliza la individual en bucle para
// conservar su guarda (no borra a quien aparece en nóminas → omitido con su motivo).

export async function darBajaEmpleadosEnLote(
  ids: string[], fecha: string, motivo: string,
): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session)             return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('rrhh'))) return loteVacio('No tienes permiso para editar en este módulo.')
  if (!ids.length) return loteVacio()

  const { data, error } = await createAdminClient().from('empleados')
    .update({ fecha_baja: fecha || hoy(), motivo_baja: motivo?.trim() || null, updated_at: new Date().toISOString() })
    .eq('client_id', session.client_id).in('empleado_id', ids).is('fecha_baja', null)
    .select('empleado_id')
  if (error) return loteVacio(error.message)
  revalidatePath('/portal/rrhh')
  return { ...loteVacio(), hechas: (data ?? []).length }
}

export async function reactivarEmpleadosEnLote(ids: string[]): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session)             return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('rrhh'))) return loteVacio('No tienes permiso para editar en este módulo.')
  if (!ids.length) return loteVacio()

  const { data, error } = await createAdminClient().from('empleados')
    .update({ fecha_baja: null, motivo_baja: null, updated_at: new Date().toISOString() })
    .eq('client_id', session.client_id).in('empleado_id', ids).not('fecha_baja', 'is', null)
    .select('empleado_id')
  if (error) return loteVacio(error.message)
  revalidatePath('/portal/rrhh')
  return { ...loteVacio(), hechas: (data ?? []).length }
}

export async function eliminarEmpleadosEnLote(ids: string[]): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session)             return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('rrhh'))) return loteVacio('No tienes permiso para editar en este módulo.')
  if (!ids.length) return loteVacio()

  const db = createAdminClient()
  const { data: emps } = await db.from('empleados')
    .select('empleado_id, nombre, apellidos').eq('client_id', session.client_id).in('empleado_id', ids)
  const nombreDe = new Map((emps ?? []).map((e: { empleado_id: string; nombre: string; apellidos: string | null }) =>
    [e.empleado_id, `${e.nombre}${e.apellidos ? ' ' + e.apellidos : ''}`]))

  const res = loteVacio()
  for (const id of ids) {
    if (!nombreDe.has(id)) continue
    const r = await eliminarEmpleado(id)   // conserva la guarda de nóminas
    if (r.ok) res.hechas++
    else res.omitidas.push({ etiqueta: nombreDe.get(id) ?? id, motivo: r.error ?? 'No se pudo eliminar' })
  }
  revalidatePath('/portal/rrhh')
  return res
}

// ════════════════════════════════════════════════════════════════════════════════
// CONTRATOS (historial)
// ════════════════════════════════════════════════════════════════════════════════

// ── Guardar contrato (documento del empleado, PDF opcional) ─────────────────────
// Los contratos son documentos externos: NO cierran a otros ni tocan el salario
// del empleado (la nómina usa empleados.salario_base). Pueden coexistir varios.

const PDF_MAX = 10 * 1024 * 1024

// Sube el PDF de un contrato al bucket (como Blob — el Buffer se corrompe en el
// serverless de Vercel, ver memoria storage-upload-blob-no-buffer) y devuelve
// { url, nombre } o un error de validación.
async function subirContratoPdf(
  db: ReturnType<typeof createAdminClient>,
  file: File,
  path: string,
): Promise<{ url: string; nombre: string } | { error: string }> {
  if (file.type !== 'application/pdf') return { error: 'El contrato debe ser un archivo PDF.' }
  if (file.size > PDF_MAX)             return { error: 'El PDF no puede superar los 10 MB.' }
  const buffer = Buffer.from(await file.arrayBuffer())
  const blob   = new Blob([new Uint8Array(buffer)], { type: 'application/pdf' })
  const { error: upErr } = await db.storage.from('contratos')
    .upload(path, blob, { contentType: 'application/pdf', upsert: true })
  if (upErr) return { error: upErr.message }
  return { url: db.storage.from('contratos').getPublicUrl(path).data.publicUrl, nombre: file.name }
}

export async function guardarContrato(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const empleado_id  = (formData.get('empleado_id')  as string)?.trim()
  const tipo_raw     = (formData.get('tipo_contrato') as string)?.trim() as TipoContrato
  const fecha_inicio = (formData.get('fecha_inicio') as string)?.trim() || hoy()
  const fecha_fin    = (formData.get('fecha_fin')    as string)?.trim() || null
  const periodi_raw  = (formData.get('periodicidad') as string)?.trim() as Periodicidad
  const salarioRaw   = parseFloat(formData.get('salario_base') as string)
  const notas        = (formData.get('notas')        as string)?.trim() || null
  const file         = formData.get('pdf') as File | null

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

  const contrato_id = generarContratoId()

  // PDF adjunto (opcional)
  let pdf_url:    string | null = null
  let pdf_nombre: string | null = null
  if (file && file.size > 0) {
    const sub = await subirContratoPdf(db, file, `${session.client_id}/${empleado_id}/${contrato_id}.pdf`)
    if ('error' in sub) return { ok: false, error: sub.error }
    pdf_url = sub.url; pdf_nombre = sub.nombre
  }

  const { error } = await db.from('contratos').insert({
    contrato_id,
    client_id:   session.client_id,
    empleado_id,
    tipo_contrato,
    fecha_inicio,
    fecha_fin,
    salario_base,
    moneda:      empleado.moneda,
    periodicidad,
    notas,
    pdf_url,
    pdf_nombre,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/portal/rrhh/${empleado_id}`)
  return { ok: true }
}

// ── Actualizar contrato (editar campos y/o adjuntar/reemplazar el PDF) ───────────
export async function actualizarContrato(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const contrato_id  = (formData.get('contrato_id')  as string)?.trim()
  const tipo_raw     = (formData.get('tipo_contrato') as string)?.trim() as TipoContrato
  const fecha_inicio = (formData.get('fecha_inicio') as string)?.trim() || hoy()
  const fecha_fin    = (formData.get('fecha_fin')    as string)?.trim() || null
  const periodi_raw  = (formData.get('periodicidad') as string)?.trim() as Periodicidad
  const notas        = (formData.get('notas')        as string)?.trim() || null
  const file         = formData.get('pdf') as File | null

  if (!contrato_id) return { ok: false, error: 'Contrato no válido.' }

  const tipo_contrato = TIPOS_CONTRATO.includes(tipo_raw)    ? tipo_raw    : 'INDEFINIDO'
  const periodicidad  = PERIODICIDADES.includes(periodi_raw) ? periodi_raw : 'MENSUAL'

  const db = createAdminClient()

  const { data: contrato } = await db.from('contratos')
    .select('empleado_id, pdf_url, pdf_nombre')
    .eq('contrato_id', contrato_id)
    .eq('client_id', session.client_id)
    .single()
  if (!contrato) return { ok: false, error: 'Contrato no encontrado.' }

  // PDF: si adjunta uno nuevo, reemplaza (mismo path, upsert); si no, conserva el actual.
  let pdf_url:    string | null = contrato.pdf_url as string | null
  let pdf_nombre: string | null = contrato.pdf_nombre as string | null
  if (file && file.size > 0) {
    const sub = await subirContratoPdf(db, file, `${session.client_id}/${contrato.empleado_id}/${contrato_id}.pdf`)
    if ('error' in sub) return { ok: false, error: sub.error }
    pdf_url = sub.url; pdf_nombre = sub.nombre
  }

  const { error } = await db.from('contratos')
    .update({ tipo_contrato, fecha_inicio, fecha_fin, periodicidad, notas, pdf_url, pdf_nombre })
    .eq('contrato_id', contrato_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/portal/rrhh/${contrato.empleado_id}`)
  return { ok: true }
}

// ── Eliminar contrato ────────────────────────────────────────────────────────────

export async function eliminarContrato(contrato_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const { data: contrato } = await db.from('contratos')
    .select('empleado_id')
    .eq('contrato_id', contrato_id)
    .eq('client_id', session.client_id)
    .single()
  if (!contrato) return { ok: false, error: 'Contrato no encontrado.' }

  // Borra el PDF adjunto si existe (best-effort)
  await db.storage.from('contratos')
    .remove([`${session.client_id}/${contrato.empleado_id}/${contrato_id}.pdf`])

  const { error } = await db.from('contratos').delete()
    .eq('contrato_id', contrato_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/portal/rrhh/${contrato.empleado_id}`)
  return { ok: true }
}

// ── Detalle de un empleado (datos + sus contratos) ──────────────────────────────

export interface EmpleadoDetalleData {
  data:      RrhhPageData
  empleado:  EmpleadoConEstado
  contratos: Contrato[]
  conceptos: ConceptoEmpleado[]
}

export async function obtenerEmpleadoDetalle(empleado_id: string): Promise<EmpleadoDetalleData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const data = await obtenerRrhh()
  if (!data) return null
  const empleado = data.empleados.find(e => e.empleado_id === empleado_id)
  if (!empleado) return null

  const db = createAdminClient()
  const [consRes, cptRes] = await Promise.all([
    db.from('contratos').select('*')
      .eq('client_id', session.client_id)
      .eq('empleado_id', empleado_id)
      .order('fecha_inicio', { ascending: false })
      .order('created_at', { ascending: false }),
    db.from('conceptos_empleado').select('*')
      .eq('client_id', session.client_id)
      .eq('empleado_id', empleado_id)
      .order('created_at', { ascending: true }),
  ])
  const contratos = ((consRes.data ?? []) as Contrato[]).map(c => ({ ...c, salario_base: Number(c.salario_base) }))
  const conceptos = ((cptRes.data ?? []) as ConceptoEmpleado[]).map(c => ({ ...c, valor: Number(c.valor) }))

  // El desfase de cada línea ya viene marcado desde `obtenerRrhh`
  // (`NominaLinea.desfasada`): la vista filtra por ahí, sin consultas extra.
  return { data, empleado, contratos, conceptos }
}

// ── Conceptos recurrentes del empleado (bonos/deducciones fijos) ─────────────────

export async function guardarConceptoEmpleado(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const empleado_id = (formData.get('empleado_id') as string)?.trim()
  const nombre      = (formData.get('nombre')      as string)?.trim()
  const tipo        = (formData.get('tipo')        as string)?.trim()
  const modo        = (formData.get('modo')        as string)?.trim()
  const valorRaw    = parseFloat(formData.get('valor') as string)

  if (!empleado_id)                       return { ok: false, error: 'Empleado no válido.' }
  if (!nombre)                            return { ok: false, error: 'El nombre del concepto es obligatorio.' }
  if (tipo !== 'BONO' && tipo !== 'DEDUCCION')   return { ok: false, error: 'Tipo no válido.' }
  if (modo !== 'FIJO' && modo !== 'PORCENTAJE')  return { ok: false, error: 'Modo no válido.' }
  if (isNaN(valorRaw) || valorRaw <= 0)   return { ok: false, error: 'El valor debe ser positivo.' }

  const db = createAdminClient()
  const { data: emp } = await db.from('empleados').select('empleado_id')
    .eq('empleado_id', empleado_id).eq('client_id', session.client_id).single()
  if (!emp) return { ok: false, error: 'Empleado no encontrado.' }

  const { error } = await db.from('conceptos_empleado').insert({
    concepto_id: generarConceptoId(),
    client_id:   session.client_id,
    empleado_id,
    nombre,
    tipo,
    modo,
    valor:       valorRaw,
    activo:      true,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/portal/rrhh/${empleado_id}`)
  return { ok: true }
}

export async function eliminarConceptoEmpleado(concepto_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: cpt } = await db.from('conceptos_empleado').select('empleado_id')
    .eq('concepto_id', concepto_id).eq('client_id', session.client_id).single()
  if (!cpt) return { ok: false, error: 'Concepto no encontrado.' }

  const { error } = await db.from('conceptos_empleado').delete()
    .eq('concepto_id', concepto_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/portal/rrhh/${cpt.empleado_id}`)
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
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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

  // Evitar duplicados: una nómina por empresa y período
  const { count: yaExiste } = await db.from('nominas')
    .select('nomina_id', { count: 'exact', head: true })
    .eq('client_id', session.client_id)
    .eq('empresa_id', empresa_id)
    .eq('periodo', periodo)
  if ((yaExiste ?? 0) > 0) {
    return { ok: false, error: `Ya existe una nómina de ${periodo} para esta empresa.` }
  }

  // Incluir a quien trabajó (aunque sea parte) en el período: alta ≤ fin del mes
  // y (sigue activo o se dio de baja dentro/después del inicio del período).
  const [yy, mm]    = periodo.split('-').map(Number)
  const periodStart = `${periodo}-01`
  const periodEnd   = `${periodo}-${String(new Date(yy, mm, 0).getDate()).padStart(2, '0')}`

  const { data: empData } = await db.from('empleados')
    .select('empleado_id, nombre, apellidos, cargo, salario_base')
    .eq('client_id', session.client_id)
    .eq('empresa_id', empresa_id)
    .eq('moneda', moneda)
    .lte('fecha_alta', periodEnd)
    .or(`fecha_baja.is.null,fecha_baja.gte.${periodStart}`)
    .order('nombre')
  const activos = (empData ?? []) as { empleado_id: string; nombre: string; apellidos: string | null; cargo: string | null; salario_base: number }[]

  if (!activos.length) {
    return { ok: false, error: `No hay personal en esa empresa con salario en ${moneda} para ${periodo}.` }
  }

  const nomina_id = generarNominaId()

  // Conceptos recurrentes activos de cada empleado → se aplican solos a su línea
  const empIds = activos.map(e => e.empleado_id)
  const { data: cptData } = await db.from('conceptos_empleado')
    .select('empleado_id, nombre, tipo, modo, valor')
    .eq('client_id', session.client_id)
    .in('empleado_id', empIds.length ? empIds : ['__none__'])
    .eq('activo', true)
    .order('created_at')
  const cptPorEmp = new Map<string, ConceptoAplicable[]>()
  for (const c of (cptData ?? []) as { empleado_id: string; nombre: string; tipo: TipoConcepto; modo: ModoConcepto; valor: number }[]) {
    const arr = cptPorEmp.get(c.empleado_id) ?? []
    arr.push({ nombre: c.nombre, tipo: c.tipo, modo: c.modo, valor: Number(c.valor) })
    cptPorEmp.set(c.empleado_id, arr)
  }

  const lineas = activos.map(e => {
    const base = Number(e.salario_base)
    const { devengado, deducciones, neto } = aplicarConceptos(base, cptPorEmp.get(e.empleado_id) ?? [])
    return {
      linea_id:        generarLineaId(),
      nomina_id,
      client_id:       session.client_id,
      empleado_id:     e.empleado_id,
      empleado_nombre: [e.nombre, e.apellidos].filter(Boolean).join(' '),
      cargo:           e.cargo,
      salario_base:    base,
      devengado,
      deducciones,
      neto,
    }
  })
  const total = redondear2(lineas.reduce((s, l) => s + l.neto, 0))

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
  const { error: linErr } = await db.from('nomina_lineas').insert(lineas)
  if (linErr) {
    await db.from('nominas').delete().eq('nomina_id', nomina_id).eq('client_id', session.client_id)
    return { ok: false, error: linErr.message }
  }

  revalidatePath('/portal/rrhh')
  return { ok: true }
}

// ── Editar el DEVENGADO de una línea de nómina (solo BORRADOR) ──────────────────
// Solo el devengado. Las deducciones NO se editan aquí: salen de los conceptos del
// trabajador y se mantienen tal cual. Se retiró el campo suelto de deducciones del
// modal porque un importe sin concepto no se puede explicar a nadie, no se puede
// clasificar como impuesto o no, no puede ir a un acreedor concreto en contabilidad
// y lo borraba el primer recálculo (que no podía distinguirlo de un concepto sin
// aplicar). Además su guardado dependía de un botón de check por fila y el importe
// tecleado se perdía en silencio al cerrar el modal: le pasó a un cliente real.
//
// El importe deducido se LEE de la base y no se toca: si llegara vacío por
// formulario, tomarlo como 0 borraría la retención al guardar el devengado.

export async function guardarLineaNomina(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const linea_id     = (formData.get('linea_id') as string)?.trim()
  const devengadoRaw = parseFloat(formData.get('devengado') as string)
  if (!linea_id) return { ok: false, error: 'Línea no válida.' }
  const devengado = isNaN(devengadoRaw) || devengadoRaw < 0 ? 0 : redondear2(devengadoRaw)

  const db = createAdminClient()

  const { data: linea } = await db.from('nomina_lineas')
    .select('nomina_id, deducciones')
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

  // Bajar el devengado por debajo de lo ya deducido no se recorta en silencio: se
  // rechaza diciendo el importe, porque el arreglo está en el concepto, no aquí.
  const deducciones = Number(linea.deducciones)
  if (deducciones > devengado + EPS) {
    return {
      ok: false,
      error: `Esta línea tiene ${deducciones.toLocaleString('es-ES', { minimumFractionDigits: 2 })} de deducciones y no pueden superar el devengado. Ajusta primero los conceptos del trabajador en su ficha.`,
    }
  }
  const neto = redondear2(devengado - deducciones)

  const { error } = await db.from('nomina_lineas')
    .update({ devengado, neto })
    .eq('linea_id', linea_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  // Recalcular total de la nómina
  const { data: todas } = await db.from('nomina_lineas')
    .select('neto')
    .eq('nomina_id', linea.nomina_id)
    .eq('client_id', session.client_id)
  const total = redondear2((todas ?? []).reduce((s, l) => s + Number(l.neto), 0))
  await db.from('nominas')
    .update({ total, updated_at: new Date().toISOString() })
    .eq('nomina_id', linea.nomina_id)
    .eq('client_id', session.client_id)

  revalidatePath('/portal/nomina')
  return { ok: true }
}

// RETIRADO: «Aplicar a todas» (`aplicarConceptoNomina`), que sumaba el mismo bono o
// deducción a cada línea de la nómina. Aplicaba un importe suelto SIN concepto que
// lo explicara —ni nombre, ni rastro, ni forma de saber después de dónde salía—, y
// una retención de impuestos no es igual para todos: es del trabajador. Las
// deducciones se llevan por trabajador, desde su ficha (`conceptos_empleado`), y
// entran en la nómina al generarla o con `recalcularNomina`. Sin datos huérfanos:
// no llegó a usarse en producción. Recuperable en git (llegó en `620ef85`).

// ── Actualizar una nómina BORRADOR con los conceptos vigentes ────────────────────
// El olvido normal: se genera la nómina y DESPUÉS se recuerda una retención. Los
// conceptos solo se aplican al crear (`crearNomina`), así que hasta ahora la única
// salida era borrar la nómina entera y volver a generarla.
//
// Es un RECÁLCULO desde el `salario_base` de la línea —el del período, congelado
// al generar— más los conceptos activos del trabajador. No es un añadido: la línea
// guarda `deducciones` como un número sin desglose, así que no hay forma de saber
// qué conceptos la formaron y "sumar solo lo que falta" sería inventarse el punto
// de partida (y duplicar lo ya aplicado). Por eso pisa lo escrito a mano en las
// líneas que toca, y por eso se previsualiza antes de aplicar en vez de confiar.
//
// `empleado_id` acota el recálculo a un solo trabajador (su ficha, o la vista
// individual del modal); sin él va la nómina completa.

export interface RecalculoLineaNomina {
  linea_id:            string
  empleado_id:         string
  empleado_nombre:     string
  salario_base:        number
  devengado_antes:     number
  deducciones_antes:   number
  neto_antes:          number
  devengado_despues:   number
  deducciones_despues: number
  neto_despues:        number
  /** Desglose de lo que se va a aplicar (lo que la línea NO guarda). */
  conceptos:           { nombre: string; tipo: TipoConcepto; monto: number }[]
  /** Las deducciones superaban el devengado y se recortan a él. */
  recortada:           boolean
  cambia:              boolean
}

export interface RecalculoNomina {
  ok:            boolean
  error?:        string
  lineas:        RecalculoLineaNomina[]
  /** Totales de la nómina COMPLETA (las líneas fuera del foco cuentan igual). */
  total_antes:   number
  total_despues: number
}

type DbAdmin = ReturnType<typeof createAdminClient>

async function planificarRecalculo(
  db:          DbAdmin,
  client_id:   string,
  nomina_id:   string,
  empleado_id?: string,
): Promise<{ error?: string; estado?: EstadoNomina; lineas: RecalculoLineaNomina[]; total_otras: number }> {
  const vacio = { lineas: [] as RecalculoLineaNomina[], total_otras: 0 }

  // Planifica en CUALQUIER estado: previsualizar no escribe, y una CONFIRMADA sí
  // se puede actualizar reabriéndola. Quién puede ESCRIBIR lo decide cada acción.
  const { data: nomina, error: nErr } = await db.from('nominas')
    .select('estado')
    .eq('nomina_id', nomina_id)
    .eq('client_id', client_id)
    .maybeSingle()
  if (nErr)    return { ...vacio, error: nErr.message }
  if (!nomina) return { ...vacio, error: 'Nómina no encontrada.' }
  const estado = nomina.estado as EstadoNomina

  const { data: todas, error: lErr } = await db.from('nomina_lineas')
    .select('linea_id, empleado_id, empleado_nombre, salario_base, devengado, deducciones, neto')
    .eq('nomina_id', nomina_id)
    .eq('client_id', client_id)
    .order('empleado_nombre')
  if (lErr) return { ...vacio, estado, error: lErr.message }

  const filas = (todas ?? []) as {
    linea_id: string; empleado_id: string; empleado_nombre: string
    salario_base: number; devengado: number; deducciones: number; neto: number
  }[]
  const enFoco   = empleado_id ? filas.filter(f => f.empleado_id === empleado_id) : filas
  const idsFoco  = new Set(enFoco.map(f => f.linea_id))
  // Las líneas fuera del foco no se tocan, pero sí suman en el total de la nómina.
  const total_otras = filas
    .filter(f => !idsFoco.has(f.linea_id))
    .reduce((s, f) => s + Number(f.neto), 0)

  if (!enFoco.length) {
    return { ...vacio, estado, total_otras, error: 'Ese trabajador no tiene línea en esta nómina.' }
  }

  const { data: cptData, error: cErr } = await db.from('conceptos_empleado')
    .select('empleado_id, nombre, tipo, modo, valor')
    .eq('client_id', client_id)
    .in('empleado_id', Array.from(new Set(enFoco.map(f => f.empleado_id))))
    .eq('activo', true)
    .order('created_at')
  if (cErr) return { ...vacio, estado, total_otras, error: cErr.message }

  const porEmpleado = new Map<string, { nombre: string; tipo: TipoConcepto; modo: ModoConcepto; valor: number }[]>()
  for (const c of (cptData ?? []) as { empleado_id: string; nombre: string; tipo: TipoConcepto; modo: ModoConcepto; valor: number }[]) {
    const arr = porEmpleado.get(c.empleado_id) ?? []
    arr.push({ nombre: c.nombre, tipo: c.tipo, modo: c.modo, valor: Number(c.valor) })
    porEmpleado.set(c.empleado_id, arr)
  }

  const lineas = enFoco.map(f => {
    const base = Number(f.salario_base)
    // El recorte lo hace la fórmula compartida, pero aquí NO se queda en silencio:
    // `recortada` viaja a la previsualización para que el dueño vea que su
    // deducción no cabe entera antes de aplicar nada.
    const { devengado, deducciones, neto, recortada, detalle } =
      aplicarConceptos(base, porEmpleado.get(f.empleado_id) ?? [])

    const devAntes = Number(f.devengado)
    const dedAntes = Number(f.deducciones)
    return {
      linea_id:            f.linea_id,
      empleado_id:         f.empleado_id,
      empleado_nombre:     f.empleado_nombre,
      salario_base:        base,
      devengado_antes:     devAntes,
      deducciones_antes:   dedAntes,
      neto_antes:          Number(f.neto),
      devengado_despues:   devengado,
      deducciones_despues: deducciones,
      neto_despues:        neto,
      conceptos:           detalle,
      recortada,
      cambia: Math.abs(devAntes - devengado) > EPS || Math.abs(dedAntes - deducciones) > EPS,
    }
  })

  return { estado, lineas, total_otras }
}

export async function previsualizarRecalculoNomina(
  nomina_id:    string,
  empleado_id?: string,
): Promise<RecalculoNomina> {
  const nada = { lineas: [] as RecalculoLineaNomina[], total_antes: 0, total_despues: 0 }
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.', ...nada }

  // Solo lee (la página ya pasa por requireModulo('rrhh')); el candado de
  // escritura vive en `recalcularNomina`.
  const db   = createAdminClient()
  const plan = await planificarRecalculo(db, session.client_id, nomina_id, empleado_id)
  if (plan.error) return { ok: false, error: plan.error, ...nada }

  return {
    ok:            true,
    lineas:        plan.lineas,
    total_antes:   redondear2(plan.total_otras + plan.lineas.reduce((s, l) => s + l.neto_antes, 0)),
    total_despues: redondear2(plan.total_otras + plan.lineas.reduce((s, l) => s + l.neto_despues, 0)),
  }
}

// Escribe el plan en las líneas y recalcula el total. Lo comparten `recalcularNomina`
// (borrador) y `reabrirYActualizarNomina` (confirmada): una segunda copia de este
// bucle sería una segunda forma de que el total dejara de cuadrar con sus líneas.
async function aplicarRecalculo(
  db:          DbAdmin,
  client_id:   string,
  nomina_id:   string,
  empleado_id?: string,
): Promise<{ error?: string; actualizadas: number; total: number }> {
  const plan = await planificarRecalculo(db, client_id, nomina_id, empleado_id)
  if (plan.error) return { error: plan.error, actualizadas: 0, total: 0 }

  const cambian = plan.lineas.filter(l => l.cambia)
  for (const l of cambian) {
    const { error } = await db.from('nomina_lineas')
      .update({ devengado: l.devengado_despues, deducciones: l.deducciones_despues, neto: l.neto_despues })
      .eq('linea_id', l.linea_id)
      .eq('client_id', client_id)
    if (error) return { error: error.message, actualizadas: 0, total: 0 }
  }

  // El total se relee de la base, no se toma del plan: entre previsualizar y
  // aplicar, otra pestaña puede haber tocado una línea fuera del foco.
  const { data: todas, error: tErr } = await db.from('nomina_lineas')
    .select('neto')
    .eq('nomina_id', nomina_id)
    .eq('client_id', client_id)
  if (tErr) return { error: tErr.message, actualizadas: 0, total: 0 }
  const total = redondear2((todas ?? []).reduce((s, l) => s + Number(l.neto), 0))
  await db.from('nominas')
    .update({ total, updated_at: new Date().toISOString() })
    .eq('nomina_id', nomina_id)
    .eq('client_id', client_id)

  return { actualizadas: cambian.length, total }
}

function revalidarNomina(empleado_id?: string) {
  revalidatePath('/portal/nomina')
  revalidatePath('/portal/rrhh')
  if (empleado_id) revalidatePath(`/portal/rrhh/${empleado_id}`)
}

export async function recalcularNomina(
  nomina_id:    string,
  empleado_id?: string,
): Promise<{ ok: boolean; error?: string; actualizadas?: number; total?: number }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: nomina } = await db.from('nominas')
    .select('estado').eq('nomina_id', nomina_id).eq('client_id', session.client_id).maybeSingle()
  if (!nomina) return { ok: false, error: 'Nómina no encontrada.' }
  // Una confirmada ya posteó su gasto: se actualiza por `reabrirYActualizarNomina`,
  // que lo revierte primero. Aquí cambiaría las líneas dejando el gasto obsoleto.
  if (nomina.estado !== 'BORRADOR') {
    return { ok: false, error: 'La nómina está confirmada. Hay que reabrirla para actualizarla.' }
  }

  const res = await aplicarRecalculo(db, session.client_id, nomina_id, empleado_id)
  if (res.error) return { ok: false, error: res.error }

  revalidarNomina(empleado_id)
  return { ok: true, actualizadas: res.actualizadas, total: res.total }
}

// ── Reabrir una nómina CONFIRMADA y actualizarla de una vez ──────────────────────
// El caso real: la nómina del mes ya está cerrada y se recuerda una retención. Sin
// esto había que BORRAR la nómina entera y regenerarla.
//
// Reabrir = revertir los gastos que posteó al confirmar (Salarios + Retenciones) y
// volver a BORRADOR. No se ajusta el gasto en caliente a propósito: al reconfirmar
// se regenera de cero, así que es imposible dejarlo descuadrado con sus líneas.
//
// Se NIEGA si algún gasto tiene pagos en Tesorería: ahí ya hay dinero movido contra
// un importe concreto y cambiarlo por debajo rompe la conciliación (podrías haber
// pagado más de lo que el gasto acabaría diciendo que se debe).
//
// Deja la nómina en BORRADOR con los números puestos, SIN reconfirmar: si el
// recálculo saca algo raro —una deducción que no cabe en el devengado— el dueño
// tiene que verlo antes de que vuelva a contabilidad.
export async function reabrirYActualizarNomina(
  nomina_id:    string,
  empleado_id?: string,
): Promise<{ ok: boolean; error?: string; actualizadas?: number; total?: number }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: nomina } = await db.from('nominas')
    .select('estado, gasto_id')
    .eq('nomina_id', nomina_id).eq('client_id', session.client_id).maybeSingle()
  if (!nomina) return { ok: false, error: 'Nómina no encontrada.' }
  if (nomina.estado !== 'CONFIRMADA') {
    // Ya es editable: el recálculo normal basta y no hay gasto que revertir.
    return recalcularNomina(nomina_id, empleado_id)
  }

  // Los dos gastos de la nómina: el de Salarios por `gasto_id`, el de Retenciones
  // por su origen (mig. 139).
  const { data: porOrigen } = await db.from('gastos_cobros')
    .select('registro_id')
    .eq('client_id', session.client_id)
    .eq('origen_tipo', 'NOMINA')
    .eq('origen_id', nomina_id)
  const gastoIds = Array.from(new Set([
    ...(nomina.gasto_id ? [nomina.gasto_id] : []),
    ...((porOrigen ?? []) as { registro_id: string }[]).map(g => g.registro_id),
  ]))

  if (gastoIds.length) {
    const { count } = await db.from('movimientos_tesoreria')
      .select('movimiento_id', { count: 'exact', head: true })
      .eq('client_id', session.client_id)
      .in('referencia_id', gastoIds)
    if ((count ?? 0) > 0) {
      return { ok: false, error: 'Esta nómina ya tiene pagos registrados. Anúlalos en Tesorería y vuelve a intentarlo.' }
    }
    const { error: delErr } = await db.from('gastos_cobros').delete()
      .eq('client_id', session.client_id).in('registro_id', gastoIds)
    if (delErr) return { ok: false, error: delErr.message }
  }

  const { error: reErr } = await db.from('nominas')
    .update({ estado: 'BORRADOR', gasto_id: null, updated_at: new Date().toISOString() })
    .eq('nomina_id', nomina_id)
    .eq('client_id', session.client_id)
  if (reErr) return { ok: false, error: reErr.message }

  const res = await aplicarRecalculo(db, session.client_id, nomina_id, empleado_id)
  if (res.error) {
    // La nómina ya está reabierta y sin gastos: es un estado válido (un borrador
    // sin tocar), así que se informa en vez de intentar deshacer a medias.
    revalidarNomina(empleado_id)
    revalidarFinanzas()
    return { ok: false, error: `La nómina se reabrió, pero no se pudo actualizar: ${res.error}` }
  }

  revalidarNomina(empleado_id)
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/cxp')
  revalidatePath('/portal/tesoreria')
  revalidarFinanzas()
  return { ok: true, actualizadas: res.actualizadas, total: res.total }
}

// ── Confirmar nómina ────────────────────────────────────────────────────────────
// Crea un GASTO "Salarios" en gastos_cobros (fluye a CxP / Tesorería / Reportes)
// y enlaza su id. La nómina queda CONFIRMADA y deja de ser editable.

export async function confirmarNomina(nomina_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const { data: nomina } = await db.from('nominas')
    .select('*')
    .eq('nomina_id', nomina_id)
    .eq('client_id', session.client_id)
    .single()
  if (!nomina)                       return { ok: false, error: 'Nómina no encontrada.' }
  if (nomina.estado !== 'BORRADOR')  return { ok: false, error: 'La nómina ya está confirmada.' }

  const { data: lineas } = await db.from('nomina_lineas')
    .select('devengado, deducciones, neto')
    .eq('nomina_id', nomina_id)
    .eq('client_id', session.client_id)
  const filas       = (lineas ?? []) as { devengado: number; deducciones: number; neto: number }[]
  const devengado   = redondear2(filas.reduce((s, l) => s + Number(l.devengado), 0))
  const retenido    = redondear2(filas.reduce((s, l) => s + Number(l.deducciones), 0))
  const total       = redondear2(filas.reduce((s, l) => s + Number(l.neto), 0))
  // El guardia mira el DEVENGADO, no el neto: una nómina en la que se retuvo todo
  // tiene coste (y una deuda con la agencia tributaria) aunque no salga efectivo
  // hacia el trabajador — con el neto, esa nómina no se podía confirmar.
  if (devengado <= EPS) return { ok: false, error: 'La nómina no tiene importe que registrar.' }

  // Categorías del sistema. Se RESUELVEN-O-CREAN (mig. 133): buscarlas por nombre
  // dejaba sin `categoria_id` a todo cliente dado de alta después de la mig. 074,
  // que nunca tuvo las categorías sembradas. El `rol_pl` lo pone la RPC (mig. 139).
  const [catSalarios, catRetenciones] = await Promise.all([
    resolverCategoriaSistema(db, session.client_id, 'salarios'),
    retenido > EPS
      ? resolverCategoriaSistema(db, session.client_id, 'retenciones_nomina')
      : Promise.resolve(null),
  ])

  // DOS gastos que suman el devengado (mig. 139): el coste de personal es el bruto,
  // y lo retenido no se evapora — sigue debiéndose, pero a otro acreedor y con otro
  // vencimiento, así que va en su propia fila de Cuentas por pagar.
  const base = {
    client_id:   session.client_id,
    empresa_id:  nomina.empresa_id,
    tipo:        'GASTO',
    fecha:       nomina.fecha,
    moneda:      nomina.moneda,
    origen_tipo: 'NOMINA',
    origen_id:   nomina_id,
    updated_at:  new Date().toISOString(),
  }
  const gasto_id = generarGastoId()
  const aInsertar: Record<string, unknown>[] = [{
    ...base,
    registro_id:  gasto_id,
    categoria:    catSalarios?.nombre ?? 'Salarios',
    categoria_id: catSalarios?.categoria_id ?? null,
    descripcion:  `Nómina ${nomina.periodo}`,
    monto:        total,
    notas:        `Nómina ${nomina_id}`,
  }]
  const retencion_id = retenido > EPS ? generarGastoId() : null
  if (retencion_id) {
    aInsertar.push({
      ...base,
      registro_id:  retencion_id,
      categoria:    catRetenciones?.nombre ?? 'Retenciones de nómina',
      categoria_id: catRetenciones?.categoria_id ?? null,
      descripcion:  `Retenciones nómina ${nomina.periodo}`,
      monto:        retenido,
      notas:        `Nómina ${nomina_id} · retenido del salario, a ingresar a la agencia tributaria`,
    })
  }

  const { error: gErr } = await db.from('gastos_cobros').insert(aInsertar)
  if (gErr) return { ok: false, error: gErr.message }

  // `gasto_id` sigue apuntando al de Salarios: es el que gobierna el saldo con la
  // plantilla, y de él salen `pagado`/`saldo_pendiente` y el botón «Pagar».
  const { error: nErr } = await db.from('nominas')
    .update({ estado: 'CONFIRMADA', gasto_id, total, updated_at: new Date().toISOString() })
    .eq('nomina_id', nomina_id)
    .eq('client_id', session.client_id)
  if (nErr) {
    await db.from('gastos_cobros').delete()
      .eq('client_id', session.client_id)
      .in('registro_id', aInsertar.map(g => g.registro_id as string))
    return { ok: false, error: nErr.message }
  }

  revalidatePath('/portal/rrhh')
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/cxp')
  revalidatePath('/portal/tesoreria')
  revalidarFinanzas()
  return { ok: true }
}

// ── Eliminar nómina ──────────────────────────────────────────────────────────────
// Si está confirmada, solo si NINGUNO de sus gastos tiene pagos en Tesorería.

export async function eliminarNomina(nomina_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const { data: nomina } = await db.from('nominas')
    .select('estado, gasto_id')
    .eq('nomina_id', nomina_id)
    .eq('client_id', session.client_id)
    .single()
  if (!nomina) return { ok: false, error: 'Nómina no encontrada.' }

  if (nomina.estado === 'CONFIRMADA') {
    // Confirmar escribe DOS gastos (mig. 139): Salarios y Retenciones. El de
    // Salarios se localiza por `gasto_id`; el de retenciones por su origen —
    // borrar solo el primero dejaba la deuda con la agencia tributaria viva y
    // huérfana, sin nómina que la explicara.
    const { data: porOrigen } = await db.from('gastos_cobros')
      .select('registro_id')
      .eq('client_id', session.client_id)
      .eq('origen_tipo', 'NOMINA')
      .eq('origen_id', nomina_id)
    const gastoIds = Array.from(new Set([
      ...(nomina.gasto_id ? [nomina.gasto_id] : []),
      ...((porOrigen ?? []) as { registro_id: string }[]).map(g => g.registro_id),
    ]))

    if (gastoIds.length) {
      const { count } = await db.from('movimientos_tesoreria')
        .select('movimiento_id', { count: 'exact', head: true })
        .eq('client_id', session.client_id)
        .in('referencia_id', gastoIds)
      if ((count ?? 0) > 0) {
        // Configurador (modo configuración): se lleva también los pagos. El usuario
        // normal debe anularlos en Tesorería antes.
        if (!session.imp) return { ok: false, error: 'Los gastos de esta nómina tienen pagos registrados. Anúlalos en Tesorería antes de eliminar.' }
        await db.from('movimientos_tesoreria').delete()
          .eq('client_id', session.client_id).in('referencia_id', gastoIds)
      }
      await db.from('gastos_cobros').delete()
        .eq('client_id', session.client_id).in('registro_id', gastoIds)
    }
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

// ── Nóminas en lote (Fase 2) ─────────────────────────────────────────────────────
// Candado `rrhh` inline. Confirmar es SECUENCIAL (cada una postea su gasto de
// Salarios). Reutilizan las individuales; la elegibilidad filtra por estado.

export async function confirmarNominasEnLote(ids: string[]): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session)             return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('rrhh'))) return loteVacio('No tienes permiso para editar en este módulo.')
  if (!ids.length) return loteVacio()

  const db = createAdminClient()
  const { data: noms } = await db.from('nominas')
    .select('nomina_id, periodo, estado').eq('client_id', session.client_id).in('nomina_id', ids)

  const res = loteVacio()
  for (const n of (noms ?? []) as { nomina_id: string; periodo: string; estado: string }[]) {
    if (n.estado !== 'BORRADOR') { res.omitidas.push({ etiqueta: n.periodo, motivo: 'ya confirmada' }); continue }
    const r = await confirmarNomina(n.nomina_id)   // secuencial: postea gasto de Salarios
    if (r.ok) res.hechas++
    else res.errores.push({ etiqueta: n.periodo, error: r.error ?? 'Error' })
  }
  revalidatePath('/portal/rrhh')
  revalidarFinanzas()
  return res
}

export async function eliminarNominasEnLote(ids: string[]): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session)             return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('rrhh'))) return loteVacio('No tienes permiso para editar en este módulo.')
  if (!ids.length) return loteVacio()

  const db = createAdminClient()
  const { data: noms } = await db.from('nominas')
    .select('nomina_id, periodo').eq('client_id', session.client_id).in('nomina_id', ids)
  const periodoDe = new Map((noms ?? []).map((n: { nomina_id: string; periodo: string }) => [n.nomina_id, n.periodo]))

  const res = loteVacio()
  for (const id of ids) {
    if (!periodoDe.has(id)) continue
    const r = await eliminarNomina(id)   // conserva la guarda (pagos en tesorería)
    if (r.ok) res.hechas++
    else res.omitidas.push({ etiqueta: periodoDe.get(id) ?? id, motivo: r.error ?? 'No se pudo eliminar' })
  }
  revalidatePath('/portal/rrhh')
  revalidarFinanzas()
  return res
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
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
  if (!(await puedeEditarModulo('rrhh'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

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
