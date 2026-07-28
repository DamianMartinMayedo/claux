'use server'

import { revalidatePath }    from 'next/cache'
import { revalidarFinanzas } from './_finanzas-revalidar'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarModulo }  from './auth'
import { obtenerEmpresas }   from './empresas'
import { monedaValida }      from '@/lib/tasas'
import { etiquetaDeCategoria, generarRegistroId, parsearSubcategorias, type TipoRegistro as _TipoRegistro } from '@/lib/gastos-core'
import { generarMovimientoId } from '@/lib/tesoreria-core'
import { esRolPL, type RolPL as _RolPL } from '@/lib/pl/estado'

// ── Tipos ─────────────────────────────────────────────────────────────────────

// El tipo y los helpers viven en `@/lib/gastos-core` (una sola fuente, compartida
// con el importador). Se re-declara directamente porque el re-export agregado
// `export type { … } from …` rompe el loader de 'use server'.
export type TipoRegistro   = _TipoRegistro
export type EstadoRegistro = 'PENDIENTE' | 'PARCIAL' | 'LIQUIDADO'
export type EstadoCategoria = 'ACTIVO' | 'INACTIVO'
export type RolPL           = _RolPL

export interface CategoriaGasto {
  categoria_id:  string
  client_id:     string
  nombre:        string
  descripcion:   string | null
  parent_id:     string | null  // null = categoría raíz; fijo = subcategoría
  estado:        EstadoCategoria
  es_sistema:    boolean
  /** Clave estable de las que escribe el sistema (mig. 133); null en las del dueño. */
  clave_sistema: string | null
  /** Papel en el estado de resultados (mig. 134). En una subcategoría NO se lee:
   *  el informe usa el de su categoría madre. */
  rol_pl:        RolPL
  uso_count?:    number  // Calculado: cuántos gastos usan esta categoría
  created_at:    string
  updated_at:    string
}

export interface GastoCobro {
  registro_id:  string
  client_id:    string
  empresa_id:   string
  tipo:         TipoRegistro
  fecha:        string
  vencimiento:  string | null
  tercero_id:   string | null
  categoria:    string | null  // nombre desnormalizado (display / reportes)
  categoria_id: string | null  // FK a categorias_gastos
  descripcion:  string
  moneda:       string
  monto:        number
  notas:        string | null
  created_at:   string
  updated_at:   string
}

// Liquidación = movimiento de tesorería con referencia a este registro
export interface Liquidacion {
  movimiento_id: string
  fecha:         string
  monto:         number
  cuenta_id:     string
  cuenta_nombre: string
}

export interface GastoCobroConSaldo extends GastoCobro {
  monto_liquidado: number
  saldo_pendiente: number
  estado:          EstadoRegistro
  liquidaciones:   Liquidacion[]
}

export interface GastosCobrosPageData {
  registros:         GastoCobroConSaldo[]
  terceros:          { tercero_id: string; nombre: string; tipo: string; empresa_id: string; moneda_defecto: string | null }[]
  cuentas:           { cuenta_id: string; nombre: string; empresa_id: string; moneda: string }[]
  monedas:           string[]
  categorias_gastos: CategoriaGasto[]  // Lista de categorías de gastos
  empresa_nombres:   Record<string, string>
  empresas:          { empresa_id: string; nombre: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EPS = 0.005

function generarCategoriaGastoId(): string {
  return `CATGAS-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}
function hoy(): string {
  return new Date().toISOString().split('T')[0]
}
function estadoDe(monto: number, liquidado: number): EstadoRegistro {
  if (liquidado <= EPS)            return 'PENDIENTE'
  if (liquidado >= monto - EPS)    return 'LIQUIDADO'
  return 'PARCIAL'
}

// ── Obtener gastos y cobros ────────────────────────────────────────────────────

export async function obtenerGastosCobros(): Promise<GastosCobrosPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db          = createAdminClient()
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  const idsFiltro   = empresa_ids.length ? empresa_ids : ['__none__']

  const [regRes, movRes, cuRes, terRes, monRes, catRes] = await Promise.all([
    db.from('gastos_cobros').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false }),
    db.from('movimientos_tesoreria')
      .select('movimiento_id, fecha, monto, monto_ref, cuenta_id, referencia_id, origen')
      .eq('client_id', session.client_id)
      .in('origen', ['PAGO', 'COBRO'])
      .not('referencia_id', 'is', null),
    // Se traen TODAS (incluida la de «Apertura») porque también resuelven el
    // nombre de cada liquidación; el selector de cuenta sí las filtra abajo.
    db.from('cuentas').select('cuenta_id, nombre, empresa_id, moneda, activa, es_apertura')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('nombre'),
    db.from('third_parties').select('tercero_id, nombre, tipo, empresa_id, moneda_defecto')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .eq('activo', true)
      .order('nombre'),
    db.from('monedas').select('codigo')
      .eq('client_id', session.client_id)
      .eq('activa', true)
      .order('codigo'),
    db.from('categorias_gastos').select('*')
      .eq('client_id', session.client_id)
      .order('estado', { ascending: true })  // ACTIVO primero
      .order('nombre'),
  ])

  const registros = (regRes.data ?? []) as GastoCobro[]
  const movs      = (movRes.data ?? []) as { movimiento_id: string; fecha: string; monto: number; monto_ref: number | null; cuenta_id: string; referencia_id: string }[]
  const cuentas   = (cuRes.data  ?? []) as { cuenta_id: string; nombre: string; empresa_id: string; moneda: string; activa: boolean; es_apertura: boolean }[]

  const cuentaNombre: Record<string, string> = {}
  for (const c of cuentas) cuentaNombre[c.cuenta_id] = c.nombre

  // Agrupar liquidaciones por registro
  const liqsPorRegistro = new Map<string, Liquidacion[]>()
  for (const m of movs) {
    const arr = liqsPorRegistro.get(m.referencia_id) ?? []
    arr.push({
      movimiento_id: m.movimiento_id,
      fecha:         m.fecha,
      // Importe aplicado al registro en su moneda (monto_ref); reconcilia el saldo
      monto:         Number(m.monto_ref ?? m.monto),
      cuenta_id:     m.cuenta_id,
      cuenta_nombre: cuentaNombre[m.cuenta_id] ?? m.cuenta_id,
    })
    liqsPorRegistro.set(m.referencia_id, arr)
  }

  const registrosConSaldo: GastoCobroConSaldo[] = registros.map(r => {
    const liqs            = liqsPorRegistro.get(r.registro_id) ?? []
    const monto_liquidado = liqs.reduce((s, l) => s + l.monto, 0)
    const monto           = Number(r.monto)
    return {
      ...r,
      monto,
      monto_liquidado,
      saldo_pendiente: Math.max(0, monto - monto_liquidado),
      estado:          estadoDe(monto, monto_liquidado),
      liquidaciones:   liqs.sort((a, b) => b.fecha.localeCompare(a.fecha)),
    }
  })

  // Categorías de gastos con conteo de uso
  const categoriasRaw = (catRes.data ?? []) as CategoriaGasto[]
  
  // Contar uso de cada categoría en gastos_cobros
  const usoPorCategoria = new Map<string, number>()
  for (const r of registros) {
    if (r.categoria_id) {
      usoPorCategoria.set(r.categoria_id, (usoPorCategoria.get(r.categoria_id) ?? 0) + 1)
    }
  }
  
  // Agregar uso_count y ordenar: ACTIVO primero, luego por uso descendente
  const categorias_gastos = categoriasRaw
    .map(c => ({ ...c, uso_count: usoPorCategoria.get(c.categoria_id) ?? 0 }))
    .sort((a, b) => {
      if (a.estado !== b.estado) return a.estado === 'ACTIVO' ? -1 : 1
      return b.uso_count - a.uso_count  // Más usadas primero
    })

  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre

  return {
    registros:         registrosConSaldo,
    terceros:          (terRes.data ?? []) as GastosCobrosPageData['terceros'],
    cuentas:           cuentas.filter(c => c.activa && !c.es_apertura).map(c => ({ cuenta_id: c.cuenta_id, nombre: c.nombre, empresa_id: c.empresa_id, moneda: c.moneda })),
    monedas:           ((monRes.data ?? []) as { codigo: string }[]).map(m => m.codigo),
    categorias_gastos,
    empresa_nombres,
    empresas:          empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
  }
}

// ── Guardar gasto / cobro (crear / editar) ─────────────────────────────────────

export async function guardarGastoCobro(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const registro_id = (formData.get('registro_id') as string)?.trim()
  const tipo        = (formData.get('tipo')        as string)?.trim() as TipoRegistro
  const empresa_id  = (formData.get('empresa_id')  as string)?.trim()
  const fecha       = (formData.get('fecha')       as string)?.trim() || hoy()
  const vencimiento = (formData.get('vencimiento') as string)?.trim() || null
  const tercero_id  = (formData.get('tercero_id')  as string)?.trim() || null
  const categoria_id_in = (formData.get('categoria_id') as string)?.trim() || null
  const conceptoForm = (formData.get('descripcion') as string)?.trim()  // texto libre (solo cobros)
  const moneda      = (formData.get('moneda')      as string)?.trim()
  const montoRaw    = parseFloat(formData.get('monto') as string)
  const notas       = (formData.get('notas')       as string)?.trim() || null

  if (tipo !== 'GASTO' && tipo !== 'COBRO') return { ok: false, error: 'Tipo no válido.' }
  if (!empresa_id)                          return { ok: false, error: 'Debes seleccionar una empresa.' }
  if (isNaN(montoRaw) || montoRaw <= 0)     return { ok: false, error: 'El monto debe ser un número positivo.' }

  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_id)) {
    return { ok: false, error: 'Empresa no válida.' }
  }

  // Etiqueta (columna `descripcion`) y clasificación según el tipo:
  //  · GASTO → se identifica por su categoría (obligatoria); la etiqueta es
  //    «Categoría» o «Categoría · Subcategoría». El texto libre va en notas.
  //  · COBRO → lleva concepto de texto libre; sin categoría.
  let descripcion: string
  let categoria_id: string | null = null
  let categoriaNombre: string | null = null

  if (tipo === 'GASTO') {
    if (!categoria_id_in) return { ok: false, error: 'Debes elegir una categoría para el gasto.' }
    // La derivación de la etiqueta vive en el núcleo compartido con el importador.
    const etq = await etiquetaDeCategoria(db, session.client_id, categoria_id_in)
    if (!etq) return { ok: false, error: 'Categoría de gasto no válida o inactiva.' }
    categoria_id    = etq.categoria_id
    categoriaNombre = etq.nombre
    descripcion     = etq.descripcion
  } else {
    if (!conceptoForm) return { ok: false, error: 'El concepto es obligatorio.' }
    descripcion = conceptoForm
  }

  if (!registro_id) {
    if (!moneda) return { ok: false, error: 'Debes seleccionar una moneda.' }
    if (!await monedaValida(db, session.client_id, moneda)) {
      return { ok: false, error: `La moneda "${moneda}" no está configurada.` }
    }
    const { error } = await db.from('gastos_cobros').insert({
      registro_id: generarRegistroId(tipo),
      client_id:   session.client_id,
      empresa_id,
      tipo,
      fecha,
      vencimiento,
      tercero_id,
      categoria:   categoriaNombre,
      categoria_id,
      descripcion,
      moneda,
      monto:       montoRaw,
      notas,
      updated_at:  new Date().toISOString(),
    })
    if (error) return { ok: false, error: error.message }
  } else {
    // Un registro generado por otro documento no se edita a mano: lo manda su origen.
    // Es la MISMA puerta que la guarda de borrado, por el otro lado — sin esto, cambiar
    // el importe de «Retenciones de nómina» descuadra la nómina contra sus libros sin
    // que nada avise, y el recálculo no lo arregla porque la fila ya está posteada.
    const duenno = await documentoDeOrigen(db, session.client_id, registro_id)
    if (duenno) return { ok: false, error: `Este registro lo generó ${duenno}. Corrígelo desde ahí.` }

    // El importe no puede bajar por debajo de lo ya pagado: el saldo se recortaría a 0
    // y el estado derivado diría LIQUIDADO habiendo salido de la caja más dinero del que
    // el gasto declara. Mismo criterio (y mismo tono) que la guardia de borrado.
    const { data: liqs } = await db.from('movimientos_tesoreria')
      .select('monto, monto_ref')
      .eq('client_id', session.client_id)
      .eq('referencia_id', registro_id)
    const liquidado = ((liqs ?? []) as { monto: number; monto_ref: number | null }[])
      .reduce((s, m) => s + Number(m.monto_ref ?? m.monto), 0)
    if (liquidado > 0 && montoRaw < liquidado - EPS) {
      return {
        ok: false,
        error: `Ya has ${tipo === 'GASTO' ? 'pagado' : 'cobrado'} ${liquidado.toFixed(2)} de este registro. Anula los movimientos antes de bajar el importe.`,
      }
    }

    // Editar — la moneda no se cambia (las liquidaciones quedarían inconsistentes).
    // `empresa_id` SÍ se guarda: antes el formulario lo ofrecía y el update lo
    // descartaba, así que cambiar de empresa se guardaba «bien» y no hacía nada.
    const { error } = await db.from('gastos_cobros')
      .update({ empresa_id, fecha, vencimiento, tercero_id, categoria: categoriaNombre, categoria_id, descripcion, monto: montoRaw, notas, updated_at: new Date().toISOString() })
      .eq('registro_id', registro_id)
      .eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/portal/gastos')
  return { ok: true }
}

// ── Eliminar gasto / cobro ─────────────────────────────────────────────────────
// Solo si no tiene liquidaciones (pagos/cobros). Si las tiene, anúlalas primero.

// ── ¿Manda otro documento sobre este registro? ────────────────────────────────
// Devuelve «una compra» / «una nómina» si el registro es un byproduct, o null si es
// suyo. Lo usan las DOS puertas —editar y borrar—: con una copia por sitio, arreglar
// una y olvidar la otra es exactamente lo que ya pasó.
//
// Se mira `origen_tipo` PRIMERO y `gasto_id` después, y las dos cosas siempre:
//  · `origen_tipo` es lo único que ve las filas SECUNDARIAS. `nominas.gasto_id` apunta
//    solo a «Salarios», y una nómina confirmada escribe hasta CINCO filas (Salarios ·
//    Retenciones · Impuestos de salario · Contribución SS empresa · el COBRO del
//    subsidio). Comprobando solo `gasto_id`, las otras cuatro se borraban de una en
//    una desde Gastos: la nómina seguía confirmada y su deuda con la agencia
//    tributaria desaparecía de los libros, sin aviso. `eliminarNomina` sí revierte
//    por `origen_tipo`/`origen_id`; esta guarda era la única asimetría.
//  · `gasto_id` cubre el histórico: las filas de nómina que hay en producción llevan
//    `origen_tipo` a NULL (son anteriores, y todas son «Salarios» porque ninguna
//    nómina confirmada tenía deducciones, así que la fila de Retenciones de la
//    mig. 139 no llegó a crearse).
//
// Sin 'use server' export: es un helper interno (un export no-async rompe el build).
async function documentoDeOrigen(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, client_id: string, registro_id: string,
): Promise<string | null> {
  const { data } = await db.from('gastos_cobros')
    .select('origen_tipo')
    .eq('registro_id', registro_id).eq('client_id', client_id)
    .maybeSingle()
  const origen = (data as { origen_tipo: string | null } | null)?.origen_tipo ?? null
  if (origen === 'NOMINA') return 'una nómina'
  if (origen === 'COMPRA') return 'una compra'

  const [{ count: enCompra }, { count: enNomina }] = await Promise.all([
    db.from('compras').select('compra_id', { count: 'exact', head: true }).eq('client_id', client_id).eq('gasto_id', registro_id),
    db.from('nominas').select('nomina_id', { count: 'exact', head: true }).eq('client_id', client_id).eq('gasto_id', registro_id),
  ])
  if ((enCompra ?? 0) > 0) return 'una compra'
  if ((enNomina ?? 0) > 0) return 'una nómina'
  return null
}

export async function eliminarGastoCobro(registro_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  // Candado de ecosistema (para TODOS, también el configurador): un gasto generado
  // por una compra o una nómina es un byproduct. Borrarlo suelto dejaría el documento
  // de origen apuntando a un gasto inexistente y, en compras, el stock sin revertir.
  // Se elimina borrando/anulando su documento de origen (que sí revierte todo).
  const duenno = await documentoDeOrigen(db, session.client_id, registro_id)
  if (duenno) return { ok: false, error: `Este registro lo generó ${duenno}. Elimínalo desde ahí.` }

  const { count } = await db.from('movimientos_tesoreria')
    .select('movimiento_id', { count: 'exact', head: true })
    .eq('client_id', session.client_id)
    .eq('referencia_id', registro_id)
  if ((count ?? 0) > 0) {
    // Configurador (modo configuración): se lleva también las liquidaciones de
    // Tesorería para no dejarlas huérfanas. El usuario normal debe anularlas antes.
    if (!session.imp) return { ok: false, error: 'Tiene pagos/cobros registrados. Anúlalos antes de eliminar.' }
    await db.from('movimientos_tesoreria').delete()
      .eq('client_id', session.client_id).eq('referencia_id', registro_id)
  }

  const { error } = await db.from('gastos_cobros').delete()
    .eq('registro_id', registro_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/gastos')
  return { ok: true }
}

// ── Eliminar gastos / cobros en lote ───────────────────────────────────────────
// Reutiliza la acción individual en bucle SECUENCIAL (misma guarda de negocio):
// un registro con pagos/cobros registrados NO se borra → es una omisión esperada,
// no un fallo. La capa de lote solo agrega el resultado.

export interface ResultadoLote {
  hechas:   number
  omitidas: { etiqueta: string; motivo: string }[]
  errores:  { etiqueta: string; error: string }[]
  error?:   string   // fallo global (sesión / permiso)
}

function loteVacio(error?: string): ResultadoLote {
  return { hechas: 0, omitidas: [], errores: [], error }
}

export async function eliminarGastosCobrosEnLote(ids: string[]): Promise<ResultadoLote> {
  const session = await getPortalSession()
  if (!session) return loteVacio('Sesión inválida.')
  if (!(await puedeEditarModulo('base'))) return loteVacio('No tienes permiso para editar en este módulo.')

  const db = createAdminClient()
  const { data: regs } = await db.from('gastos_cobros')
    .select('registro_id, descripcion')
    .eq('client_id', session.client_id).in('registro_id', ids)

  const res = loteVacio()
  for (const r of (regs ?? []) as { registro_id: string; descripcion: string }[]) {
    const out = await eliminarGastoCobro(r.registro_id)   // reutiliza guarda + gating
    if (out.ok) res.hechas++
    else res.omitidas.push({ etiqueta: r.descripcion, motivo: out.error ?? 'Error' })
  }
  revalidatePath('/portal/gastos')
  revalidarFinanzas()
  return res
}

// ── Registrar liquidación (pago de un gasto / cobro de un ingreso) ──────────────
// Crea un movimiento de Tesorería (origen PAGO/COBRO). Admite pagos parciales.

export async function registrarLiquidacion(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const registro_id = (formData.get('registro_id') as string)?.trim()
  const cuenta_id   = (formData.get('cuenta_id')   as string)?.trim()
  const montoRaw    = parseFloat(formData.get('monto') as string)   // en la moneda del registro
  const tasaRaw     = parseFloat(formData.get('tasa_cambio') as string)
  const fecha       = (formData.get('fecha')       as string)?.trim() || hoy()
  const notas       = (formData.get('notas')       as string)?.trim() || null

  if (!registro_id)                      return { ok: false, error: 'Registro no válido.' }
  if (!cuenta_id)                        return { ok: false, error: 'Debes seleccionar una cuenta.' }
  if (isNaN(montoRaw) || montoRaw <= 0)  return { ok: false, error: 'El monto debe ser un número positivo.' }

  const { data: registro } = await db.from('gastos_cobros')
    .select('tipo, descripcion, categoria_id, moneda, monto')
    .eq('registro_id', registro_id)
    .eq('client_id', session.client_id)
    .single()
  if (!registro) return { ok: false, error: 'Registro no encontrado.' }

  // Obtener nombre de categoría si existe
  let categoriaNombre: string | null = null
  if (registro.categoria_id) {
    const { data: cat } = await db.from('categorias_gastos')
      .select('nombre')
      .eq('categoria_id', registro.categoria_id)
      .eq('client_id', session.client_id)
      .maybeSingle()
    categoriaNombre = cat?.nombre ?? null
  }

  const { data: cuenta } = await db.from('cuentas')
    .select('empresa_id, moneda, activa, es_apertura')
    .eq('cuenta_id', cuenta_id)
    .eq('client_id', session.client_id)
    .single()
  if (!cuenta)            return { ok: false, error: 'Cuenta no encontrada.' }
  if (!cuenta.activa)     return { ok: false, error: 'La cuenta está archivada.' }
  // La cuenta de «Apertura» solo la usa el importador para saldar el histórico
  // (mig. 130): pagar desde ella a mano sería mover dinero que no existe.
  if (cuenta.es_apertura) return { ok: false, error: 'Esta cuenta es de saldo inicial: no se cobra ni se paga desde ella.' }

  // Moneda distinta a la del registro → se aplica tasa (misma lógica que las transferencias).
  // `montoRaw` es el importe en la moneda del registro (reduce su saldo); en la caja
  // entra/sale `montoCaja` = montoRaw × tasa, en la moneda de la caja.
  const cambiaMoneda = cuenta.moneda !== registro.moneda
  const tasa = cambiaMoneda ? tasaRaw : 1
  if (cambiaMoneda && (isNaN(tasa) || tasa <= 0)) {
    return { ok: false, error: `Indica la tasa de cambio para saldar en ${registro.moneda} desde una caja en ${cuenta.moneda}.` }
  }
  const montoCaja = Math.round(montoRaw * tasa * 100) / 100

  // Saldo pendiente actual (en la moneda del registro → se suma monto_ref)
  const { data: liqs } = await db.from('movimientos_tesoreria')
    .select('monto_ref, monto')
    .eq('client_id', session.client_id)
    .eq('referencia_id', registro_id)
  const yaLiquidado = (liqs ?? []).reduce((s, m) => s + Number(m.monto_ref ?? m.monto), 0)
  const pendiente   = Number(registro.monto) - yaLiquidado
  if (montoRaw > pendiente + EPS) {
    return { ok: false, error: `El monto supera el saldo pendiente (${pendiente.toFixed(2)} ${registro.moneda}).` }
  }

  const esGasto = registro.tipo === 'GASTO'
  const conceptoBase = `${esGasto ? 'Pago' : 'Cobro'} · ${registro.descripcion}`
  const { error } = await db.from('movimientos_tesoreria').insert({
    movimiento_id: generarMovimientoId(),
    client_id:     session.client_id,
    empresa_id:    cuenta.empresa_id,
    cuenta_id,
    fecha,
    tipo:          esGasto ? 'EGRESO' : 'INGRESO',
    monto:         montoCaja,             // en la moneda de la caja
    moneda:        cuenta.moneda,
    monto_ref:     montoRaw,              // en la moneda del registro (reduce su saldo)
    concepto:      cambiaMoneda ? `${conceptoBase} (${montoRaw.toFixed(2)} ${registro.moneda} a ${tasa} ${cuenta.moneda}/${registro.moneda})` : conceptoBase,
    categoria:     categoriaNombre,  // Nombre de la categoría para display
    categoria_id:  registro.categoria_id,  // FK para referencia
    origen:        esGasto ? 'PAGO' : 'COBRO',
    referencia_id: registro_id,
    notas,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/gastos')
  revalidatePath('/portal/tesoreria')
  revalidatePath('/portal/rrhh')
  revalidatePath('/portal/nomina')
  revalidatePath('/portal/cxp')
  revalidarFinanzas()
  return { ok: true }
}

// ── Anular liquidación (borra el movimiento de Tesorería asociado) ──────────────

export async function anularLiquidacion(movimiento_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  // Solo movimientos de liquidación (origen PAGO/COBRO con referencia)
  const { data: mov } = await db.from('movimientos_tesoreria')
    .select('origen')
    .eq('movimiento_id', movimiento_id)
    .eq('client_id', session.client_id)
    .single()
  if (!mov) return { ok: false, error: 'Movimiento no encontrado.' }
  if (mov.origen !== 'PAGO' && mov.origen !== 'COBRO') {
    return { ok: false, error: 'Ese movimiento no es una liquidación.' }
  }

  const { error } = await db.from('movimientos_tesoreria').delete()
    .eq('movimiento_id', movimiento_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/gastos')
  revalidatePath('/portal/tesoreria')
  revalidatePath('/portal/rrhh')
  revalidatePath('/portal/nomina')
  revalidatePath('/portal/cxp')
  revalidarFinanzas()
  return { ok: true }
}

// ── CRUD de categorías de gastos ──────────────────────────────────────────────

// ── Alta de subcategorías en lote ─────────────────────────────────────────────
// Crea las hijas de `padre_id` que falten. Antes había que crear la categoría y
// volver a entrar al modal una vez POR subcategoría; con tres hijas eran cuatro
// pasadas. Aquí van todas de una.
//
// Reutiliza lo que ya existe en vez de fallar:
//  · Si la hija ya está y está ACTIVA, se salta (así reenviar el formulario con la
//    lista entera no duplica nada ni revienta).
//  · Si está ARCHIVADA, se REACTIVA. Es el caso que rompería el lote entero: el
//    índice único `(client_id, coalesce(parent_id,''), nombre)` cuenta también las
//    archivadas, así que insertarla daría 23505 y se caerían también las demás.
async function crearSubcategorias(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, client_id: string, padre_id: string, nombres: string[],
): Promise<{ creadas: number; reactivadas: number; error?: string }> {
  if (nombres.length === 0) return { creadas: 0, reactivadas: 0 }

  const { data: hijas } = await db.from('categorias_gastos')
    .select('categoria_id, nombre, estado')
    .eq('client_id', client_id).eq('parent_id', padre_id)

  const porNombre = new Map<string, { categoria_id: string; estado: string }>()
  for (const h of (hijas ?? []) as { categoria_id: string; nombre: string; estado: string }[]) {
    porNombre.set(h.nombre.trim().toLowerCase(), { categoria_id: h.categoria_id, estado: h.estado })
  }

  const aInsertar: Record<string, unknown>[] = []
  const aReactivar: string[] = []
  const ahora = new Date().toISOString()

  for (const nombre of nombres) {
    const ya = porNombre.get(nombre.toLowerCase())
    if (ya) {
      if (ya.estado !== 'ACTIVO') aReactivar.push(ya.categoria_id)
      continue
    }
    aInsertar.push({
      categoria_id: generarCategoriaGastoId(),
      client_id,
      nombre,
      descripcion: null,
      parent_id:   padre_id,
      // La hija cuenta en el informe dentro de su madre; su `rol_pl` propio no se
      // usa, y por eso va al valor neutro (misma regla que el alta individual).
      rol_pl:      'OPERATIVO',
      estado:      'ACTIVO',
      es_sistema:  false,
      updated_at:  ahora,
    })
  }

  if (aReactivar.length) {
    await db.from('categorias_gastos')
      .update({ estado: 'ACTIVO', updated_at: ahora })
      .eq('client_id', client_id).in('categoria_id', aReactivar)
  }
  if (aInsertar.length) {
    const { error } = await db.from('categorias_gastos').insert(aInsertar)
    if (error) return { creadas: 0, reactivadas: aReactivar.length, error: error.message }
  }
  return { creadas: aInsertar.length, reactivadas: aReactivar.length }
}

export async function guardarCategoriaGasto(
  formData: FormData,
): Promise<{
  ok: boolean; error?: string; categoria_id?: string
  subcategorias_creadas?: number; subcategorias_reactivadas?: number
}> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  const categoria_id_form = (formData.get('categoria_id') as string)?.trim()
  const nombre            = (formData.get('nombre') as string)?.trim()
  const descripcion       = (formData.get('descripcion') as string)?.trim() || null
  const parent_id         = (formData.get('parent_id') as string)?.trim() || null
  const rolForm           = (formData.get('rol_pl') as string)?.trim()
  // Una subcategoría hereda el papel de su madre: guardar uno propio crearía la
  // posibilidad de que «Suministros · Electricidad» fuera coste de ventas con
  // «Suministros» operativo, y el rollup del informe dejaría de cuadrar.
  const rol_pl: RolPL = parent_id ? 'OPERATIVO' : (esRolPL(rolForm) ? rolForm : 'OPERATIVO')

  if (!nombre) return { ok: false, error: 'El nombre de la categoría es obligatorio.' }

  // Subcategorías escritas de una vez, separadas por coma. Solo tienen sentido en
  // una categoría PRINCIPAL: la jerarquía es de dos niveles, así que si esta va a
  // ser hija de otra no puede tener hijas a su vez. Se dice en claro en vez de
  // ignorar el campo sin avisar — el usuario ha escrito algo y merece respuesta.
  const subcategorias = parsearSubcategorias(formData.get('subcategorias') as string)
  if (subcategorias.length > 0 && parent_id) {
    return {
      ok: false,
      error: 'Una subcategoría no puede tener subcategorías dentro. Quita la categoría padre o vacía la lista.',
    }
  }
  if (subcategorias.some(s => s.toLowerCase() === nombre.toLowerCase())) {
    return { ok: false, error: `«${nombre}» no puede ser subcategoría de sí misma.` }
  }

  // Jerarquía: solo 2 niveles (categoría → subcategoría)
  if (parent_id) {
    if (parent_id === categoria_id_form) {
      return { ok: false, error: 'Una categoría no puede ser su propia categoría padre.' }
    }
    const { data: padre } = await db.from('categorias_gastos')
      .select('parent_id')
      .eq('categoria_id', parent_id)
      .eq('client_id', session.client_id)
      .maybeSingle()
    if (!padre)          return { ok: false, error: 'La categoría padre no existe.' }
    if (padre.parent_id) return { ok: false, error: 'Solo se permiten dos niveles: la categoría padre no puede ser a su vez una subcategoría.' }
    // Una categoría que ya tiene subcategorías no puede volverse subcategoría
    if (categoria_id_form) {
      const { count } = await db.from('categorias_gastos')
        .select('categoria_id', { count: 'exact', head: true })
        .eq('client_id', session.client_id)
        .eq('parent_id', categoria_id_form)
      if ((count ?? 0) > 0) {
        return { ok: false, error: 'Esta categoría tiene subcategorías; no puede convertirse en subcategoría de otra.' }
      }
    }
  }

  if (!categoria_id_form) {
    // Crear nueva categoría
    const categoria_id = generarCategoriaGastoId()
    const { error } = await db.from('categorias_gastos').insert({
      categoria_id,
      client_id:   session.client_id,
      nombre,
      descripcion,
      parent_id,
      rol_pl,
      estado:      'ACTIVO',
      es_sistema:  false,
      updated_at:  new Date().toISOString(),
    })
    if (error) {
      if (error.code === '23505') {  // Unique violation
        return { ok: false, error: 'Ya existe una categoría con ese nombre.' }
      }
      return { ok: false, error: error.message }
    }
    // La madre ya existe: si el lote de hijas falla, se dice EXACTAMENTE eso en vez
    // de un «error inesperado» que haría pensar que no se creó nada.
    const subs = await crearSubcategorias(db, session.client_id, categoria_id, subcategorias)
    revalidatePath('/portal/gastos')
    if (subs.error) {
      return { ok: false, error: `La categoría «${nombre}» se creó, pero sus subcategorías no: ${subs.error}` }
    }
    return {
      ok: true, categoria_id,
      subcategorias_creadas:     subs.creadas,
      subcategorias_reactivadas: subs.reactivadas,
    }
  } else {
    // Editar categoría existente
    const { data: cat } = await db.from('categorias_gastos')
      .select('es_sistema')
      .eq('categoria_id', categoria_id_form)
      .eq('client_id', session.client_id)
      .maybeSingle()
    
    if (!cat) return { ok: false, error: 'Categoría no encontrada.' }

    const { error } = await db.from('categorias_gastos')
      .update({ nombre, descripcion, parent_id, rol_pl, updated_at: new Date().toISOString() })
      .eq('categoria_id', categoria_id_form)
      .eq('client_id', session.client_id)
    
    if (error) {
      if (error.code === '23505') {
        return { ok: false, error: 'Ya existe una categoría con ese nombre.' }
      }
      return { ok: false, error: error.message }
    }
    // Propagar el nuevo nombre a las filas desnormalizadas (reportes/listados).
    await db.from('gastos_cobros').update({ categoria: nombre })
      .eq('client_id', session.client_id).eq('categoria_id', categoria_id_form)
    await db.from('movimientos_tesoreria').update({ categoria: nombre })
      .eq('client_id', session.client_id).eq('categoria_id', categoria_id_form)
    // Editando también se pueden añadir hijas nuevas: las que ya estén se saltan, así
    // que el campo funciona como «añadir a las que ya hay», no como «reemplazarlas».
    const subs = await crearSubcategorias(db, session.client_id, categoria_id_form, subcategorias)
    revalidatePath('/portal/gastos')
    revalidatePath('/portal/tesoreria')
    revalidarFinanzas()
    if (subs.error) {
      return { ok: false, error: `«${nombre}» se guardó, pero sus subcategorías nuevas no: ${subs.error}` }
    }
    return {
      ok: true, categoria_id: categoria_id_form,
      subcategorias_creadas:     subs.creadas,
      subcategorias_reactivadas: subs.reactivadas,
    }
  }
}

export async function archivarCategoriaGasto(
  categoria_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()

  // Verificar que no sea categoría del sistema
  const { data: cat } = await db.from('categorias_gastos')
    .select('es_sistema')
    .eq('categoria_id', categoria_id)
    .eq('client_id', session.client_id)
    .maybeSingle()

  if (!cat) return { ok: false, error: 'Categoría no encontrada.' }
  if (cat.es_sistema) {
    return { ok: false, error: 'Las categorías del sistema no se pueden archivar.' }
  }

  const { error } = await db.from('categorias_gastos')
    .update({ estado: 'INACTIVO', updated_at: new Date().toISOString() })
    .eq('categoria_id', categoria_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/gastos')
  return { ok: true }
}

// ── Eliminar una categoría (o subcategoría) ───────────────────────────────────
//
// Borrar aquí NO es archivar, y la diferencia la marca la base de datos con dos
// cascadas que se disparan solas y en silencio:
//
//   · `categorias_gastos.parent_id` es ON DELETE **CASCADE** → borrar una madre se
//     lleva TODAS sus subcategorías. Nadie lo pide y nadie lo ve venir.
//   · `gastos_cobros.categoria_id` y `movimientos_tesoreria.categoria_id` son
//     ON DELETE **SET NULL** → los gastos históricos NO se borran, pero pierden el
//     vínculo. Y como el estado de resultados clasifica por ese vínculo (y, si
//     falla, por el nombre — que también desaparece), esos importes se caerían de
//     su renglón: **cambiarían informes de meses ya cerrados**.
//
// De ahí la regla: **si la categoría o alguna de sus hijas tiene movimiento, no se
// borra, se archiva.** Archivar la quita de los desplegables y conserva la historia
// intacta, que es lo que el usuario quiere el 95 % de las veces. Borrar queda para
// lo que se creó por error y nunca se usó.
//
// `impactoCategoria` es lo que el diálogo enseña ANTES de preguntar: nadie debería
// confirmar un borrado sin saber que se lleva tres subcategorías por delante.

export interface ImpactoCategoria {
  ok:            boolean
  error?:        string
  nombre:        string
  es_sistema:    boolean
  subcategorias: string[]   // nombres de las hijas que caerían con ella
  registros:     number     // gastos/cobros que la usan (ella o sus hijas)
  movimientos:   number     // movimientos de tesorería que la usan
  puede_borrar:  boolean
}

export async function impactoCategoria(categoria_id: string): Promise<ImpactoCategoria> {
  const vacio = {
    nombre: '', es_sistema: false, subcategorias: [], registros: 0, movimientos: 0,
    puede_borrar: false,
  }
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.', ...vacio }

  const db = createAdminClient()
  const { data: cat } = await db.from('categorias_gastos')
    .select('nombre, es_sistema')
    .eq('categoria_id', categoria_id).eq('client_id', session.client_id)
    .maybeSingle()
  if (!cat) return { ok: false, error: 'Categoría no encontrada.', ...vacio }

  const { data: hijas } = await db.from('categorias_gastos')
    .select('categoria_id, nombre')
    .eq('client_id', session.client_id).eq('parent_id', categoria_id)

  const nombresHijas = ((hijas ?? []) as { nombre: string }[]).map(h => h.nombre)
  // El uso se mide sobre la categoría Y sus hijas: la cascada se las lleva a todas,
  // así que preguntar solo por la madre daría vía libre a un borrado que sí rompe.
  const ids = [categoria_id, ...((hijas ?? []) as { categoria_id: string }[]).map(h => h.categoria_id)]

  const [{ count: registros }, { count: movimientos }] = await Promise.all([
    db.from('gastos_cobros').select('registro_id', { count: 'exact', head: true })
      .eq('client_id', session.client_id).in('categoria_id', ids),
    db.from('movimientos_tesoreria').select('movimiento_id', { count: 'exact', head: true })
      .eq('client_id', session.client_id).in('categoria_id', ids),
  ])

  const enUso = (registros ?? 0) + (movimientos ?? 0)
  return {
    ok: true,
    nombre:        cat.nombre as string,
    es_sistema:    !!cat.es_sistema,
    subcategorias: nombresHijas,
    registros:     registros ?? 0,
    movimientos:   movimientos ?? 0,
    puede_borrar:  !cat.es_sistema && enUso === 0,
  }
}

export async function eliminarCategoriaGasto(
  categoria_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  // La comprobación se REPITE aquí aunque el diálogo ya la haya hecho: entre que se
  // pinta el diálogo y se confirma puede entrar un gasto con esa categoría, y el
  // cliente no es el sitio donde se decide si algo puede borrarse.
  const impacto = await impactoCategoria(categoria_id)
  if (!impacto.ok) return { ok: false, error: impacto.error }
  if (impacto.es_sistema) {
    return { ok: false, error: 'Las categorías del sistema las asigna CLAUX sola: no se pueden eliminar.' }
  }
  if (!impacto.puede_borrar) {
    const usos = impacto.registros + impacto.movimientos
    return {
      ok: false,
      error: `«${impacto.nombre}» se usa en ${usos} ${usos === 1 ? 'registro' : 'registros'}. `
           + 'Elimínalos o archívala: archivar la quita de los desplegables y conserva el historial.',
    }
  }

  const { error } = await createAdminClient()
    .from('categorias_gastos')
    .delete()
    .eq('categoria_id', categoria_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/gastos')
  revalidatePath('/portal/tesoreria')
  revalidarFinanzas()
  return { ok: true }
}

export async function restaurarCategoriaGasto(
  categoria_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const { error } = await createAdminClient()
    .from('categorias_gastos')
    .update({ estado: 'ACTIVO', updated_at: new Date().toISOString() })
    .eq('categoria_id', categoria_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/gastos')
  return { ok: true }
}
