'use server'

import { revalidatePath }    from 'next/cache'
import { revalidarFinanzas } from './_finanzas-revalidar'
import { createAdminClient } from '@/lib/supabase/admin'
import { saldosAFecha, saldoSinMovimientos } from '@/lib/tesoreria/saldos'
import { getPortalSession, puedeEditarModulo }  from './auth'
import { obtenerEmpresas }   from './empresas'
import { type CategoriaGasto } from './gastos'
import { monedaValida }      from '@/lib/tasas'
import { generarCuentaId, generarMovimientoId } from '@/lib/tesoreria-core'
import { generarRegistroId, resolverCategoriaSistema } from '@/lib/gastos-core'
import {
  limiteDelFiltro, importeBuscado, patronBusqueda, rangoUltimosMeses, SIN_CATEGORIA,
  type FiltroListado as _FiltroListado,
} from '@/lib/listados'
// «Hoy» en la zona del NEGOCIO (America/Havana), no en UTC: con `toISOString()` a partir de
// las 20:00 la fecha ya es la de mañana, así que un documento registrado de noche el último
// día del mes caía en el mes siguiente. Una sola fuente: `lib/fecha-tz.ts`.
import { hoyEnTz } from '@/lib/fecha-tz'
import { comprobarLimite } from '@/lib/limites'
import { formatTasa } from '@/lib/formato'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type FiltroListado   = _FiltroListado
export type TipoCuenta      = 'CAJA' | 'BANCO' | 'PASARELA' | 'OTRO'
export type TipoMovimiento  = 'INGRESO' | 'EGRESO'
export type OrigenMovimiento = 'MANUAL' | 'COBRO' | 'PAGO' | 'TRANSFERENCIA'

export interface Cuenta {
  cuenta_id:     string
  client_id:     string
  empresa_id:    string
  nombre:        string
  tipo:          TipoCuenta
  moneda:        string
  saldo_inicial: number
  activa:        boolean
  notas:         string | null
  created_at:    string
  updated_at:    string
}

export interface Movimiento {
  movimiento_id:  string
  client_id:      string
  empresa_id:     string
  cuenta_id:      string
  fecha:          string
  tipo:           TipoMovimiento
  monto:          number
  moneda:         string
  // Importe en la moneda del DOCUMENTO que salda (cobro/pago con cambio de moneda);
  // igual a `monto` cuando no hubo cambio. Es lo que reduce el saldo de la CxC/CxP.
  monto_ref:      number | null
  concepto:       string
  categoria:      string | null  // Nombre de categoría (para display)
  categoria_id:   string | null  // FK a categorias_gastos
  origen:         OrigenMovimiento
  referencia_id:  string | null
  transfer_grupo: string | null
  notas:          string | null
  created_at:     string
  /**
   * Saldo de la cuenta DESPUÉS de este movimiento. Solo viene con una cuenta
   * seleccionada (`filtro.cuenta_id`): mezclando cuentas —y monedas— un acumulado no
   * es un número que se pueda cuadrar con nada. Lo calcula `tes_saldo_tras`
   * (mig. 242) sobre la historia completa de la cuenta, no sobre las filas de la
   * pantalla; ver la nota en `obtenerTesoreria`.
   */
  saldo_tras?:    number | null
}

/**
 * La cuenta con su EXTRACTO del rango: de dónde parte, qué entró, qué salió y dónde
 * acaba. Lo calcula `tes_saldos_a_fecha` (mig. 243), no un bucle aquí arriba.
 */
export interface CuentaConSaldo extends Cuenta {
  /** Saldo a la FECHA DE CORTE (`rango.hasta`), que no siempre es el de hoy. */
  saldo:         number
  /** Saldo al día ANTERIOR a `rango.desde`: de dónde parte el extracto. */
  saldo_previo:  number
  /** Del RANGO. Eran `total_*` de toda la historia y por eso dejaron de llamarse así. */
  ingresos:      number
  egresos:       number
  movimientos:   number
  /** Fecha del primer movimiento de la cuenta; `null` si no tiene ninguno. */
  primera_fecha: string | null
}

export interface TesoreriaPageData {
  cuentas:           CuentaConSaldo[]
  movimientos:       Movimiento[]
  empresa_nombres:   Record<string, string>
  empresas:          { empresa_id: string; nombre: string }[]
  monedas:           string[]   // códigos de monedas activas
  categorias_gastos: CategoriaGasto[]  // Para selects de categoría
  /**
   * Rango y búsqueda del listado. `hasta` es además la FECHA DE CORTE de los saldos:
   * la pantalla se lee como un extracto —saldo previo + lo del rango = saldo al corte—.
   */
  rango:             { desde: string; hasta: string }
  /**
   * La fecha de corte cuando es PASADA; `null` cuando el saldo es el de hoy (sin `hasta`,
   * o `hasta` de hoy en adelante). Solo entonces hay algo que matizar en pantalla.
   */
  corte:             string | null
  q:                 string
  hay_mas:           boolean
  /** Cuántos movimientos hay DE VERDAD en el rango (sin techo). */
  total:             number
  limite:            number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Los generadores viven en los núcleos compartidos con el importador
// (`@/lib/tesoreria-core`, `@/lib/gastos-core`): un código de negocio no puede
// tener tres copias del mismo generador repartidas por el portal.

const TIPOS_CUENTA:     TipoCuenta[]     = ['CAJA', 'BANCO', 'PASARELA', 'OTRO']
const TIPOS_MOVIMIENTO: TipoMovimiento[] = ['INGRESO', 'EGRESO']

// ── Obtener tesorería (cuentas + movimientos + saldos) ─────────────────────────

export async function obtenerTesoreria(
  filtro?: FiltroListado,
): Promise<TesoreriaPageData | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db          = createAdminClient()
  const empresas    = await obtenerEmpresas()
  const empresa_ids = empresas.map(e => e.empresa_id)
  const idsFiltro   = empresa_ids.length ? empresa_ids : ['__none__']

  const porDefecto = rangoUltimosMeses(3)
  const desde  = filtro?.desde ?? porDefecto.desde
  const hasta  = filtro?.hasta ?? porDefecto.hasta
  const q      = (filtro?.q ?? '').trim()
  const limite = limiteDelFiltro(filtro)
  const patron  = patronBusqueda(q)
  const importe = importeBuscado(q)

  // El LISTADO va acotado por los DOS extremos del rango; el SALDO solo por `hasta`, y de
  // eso se encarga la función SQL. La diferencia es el plan entero: acotar los dos daría
  // `saldo_inicial + los movimientos de la ventana`, ni el saldo de hoy ni el del día
  // pedido —un número que no existe—; acotar solo el superior da el saldo de ese día.
  // `count: 'exact'` en la MISMA consulta: devuelve las filas del techo y, aparte, el
  // total que cumple el filtro. Sin él el aviso no podía decir cuántas faltan, y el
  // contador de la tabla decía «N de N» sobre el conjunto ya recortado.
  let listaQuery = db.from('movimientos_tesoreria').select('*', { count: 'exact' })
    .eq('client_id', session.client_id)
    .in('empresa_id', idsFiltro)
  if (desde) listaQuery = listaQuery.gte('fecha', desde)
  if (hasta) listaQuery = listaQuery.lte('fecha', hasta)
  if (patron) {
    const partes = [`concepto.ilike.${patron}`, `movimiento_id.ilike.${patron}`, `notas.ilike.${patron}`]
    if (importe != null) partes.push(`monto.eq.${importe}`)
    listaQuery = listaQuery.or(partes.join(','))
  }
  // Los filtros de la barra, cuando la vista los ESCALA (`?srv=1`) porque el listado está
  // recortado por el techo y filtrar en el navegador solo miraría las filas traídas.
  if (filtro?.empresa_id) listaQuery = listaQuery.eq('empresa_id', filtro.empresa_id)
  if (filtro?.cuenta_id)  listaQuery = listaQuery.eq('cuenta_id',  filtro.cuenta_id)
  if (filtro?.tipo)       listaQuery = listaQuery.eq('tipo',       filtro.tipo)
  if (filtro?.categoria === SIN_CATEGORIA) {
    listaQuery = listaQuery.is('categoria_id', null)
  } else if (filtro?.categoria) {
    // Filtrar por «Suministros» trae sus subcategorías: los movimientos cuelgan de la hija,
    // así que sin esto el filtro miente por omisión.
    const { data: hijas } = await db.from('categorias_gastos')
      .select('categoria_id')
      .eq('client_id', session.client_id)
      .eq('parent_id', filtro.categoria)
    const ids = [filtro.categoria, ...(hijas ?? []).map((h: { categoria_id: string }) => h.categoria_id)]
    listaQuery = listaQuery.in('categoria_id', ids)
  }
  listaQuery = listaQuery
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limite)

  const [cuRes, movRes, saldos, monRes, catRes] = await Promise.all([
    db.from('cuentas').select('*')
      .eq('client_id', session.client_id)
      .in('empresa_id', idsFiltro)
      .order('nombre'),
    listaQuery,
    // La suma la hace POSTGRES. Antes subían por la API todos los movimientos de la
    // historia —1.410 filas en CLI-0008, paginadas para esquivar el techo de las 1.000—
    // para calcular tres números por cuenta; ahora baja una fila por cuenta. Y como la
    // función acota por `hasta`, el saldo que devuelve es el de la fecha de corte.
    saldosAFecha(db, session.client_id, idsFiltro, { desde, hasta }),
    db.from('monedas').select('codigo')
      .eq('client_id', session.client_id)
      .eq('activa', true)
      .order('codigo'),
    db.from('categorias_gastos').select('*')
      .eq('client_id', session.client_id)
      .eq('estado', 'ACTIVO')
      .order('nombre'),
  ])

  // Las cuentas de «Apertura» (mig. 130) NO son dinero real: son el contrapeso
  // técnico contra el que el importador salda el histórico ya pagado. Ni ellas ni
  // sus movimientos entran en Tesorería — enseñarlas sería inventar caja.
  const todasCuentas = (cuRes.data ?? []) as (Cuenta & { es_apertura?: boolean })[]
  const idsApertura  = new Set(todasCuentas.filter(c => c.es_apertura).map(c => c.cuenta_id))
  const cuentas      = todasCuentas.filter(c => !c.es_apertura) as Cuenta[]
  const listaCruda   = (movRes.data ?? []) as Movimiento[]
  const movimientos  = listaCruda.filter(m => !idsApertura.has(m.cuenta_id))

  // ── Saldo tras cada movimiento (solo con UNA cuenta elegida) ─────────────────
  // No se acumula aquí arriba a propósito. El saldo tras un apunte se apoya en toda la
  // historia ANTERIOR de la cuenta, y esta lista no la tiene: va acotada por rango, con
  // techo de 500, y los filtros de la barra son `escalado` —en cuanto el listado se corta,
  // arriba llegan solo los ingresos, o solo una categoría—. Sumar sobre lo que llegó daría
  // un saldo desplazado por las filas que no llegaron: creíble y falso, el mismo fallo que
  // el techo de las 1.000 filas. Así que lo calcula Postgres sobre la cuenta entera
  // (`tes_saldo_tras`, mig. 242) y solo devuelve los ids que se le pasan.
  //
  // Si la función falla, la columna NO aparece: mejor sin saldo que con un saldo inventado.
  let movsConSaldo = movimientos
  if (filtro?.cuenta_id && movimientos.length) {
    const { data: sal } = await db.rpc('tes_saldo_tras', {
      p_client_id:      session.client_id,
      p_cuenta_id:      filtro.cuenta_id,
      p_movimiento_ids: movimientos.map(m => m.movimiento_id),
    })
    if (sal) {
      const porId = new Map(
        (sal as { movimiento_id: string; saldo_tras: number }[])
          .map(f => [f.movimiento_id, Number(f.saldo_tras)]),
      )
      movsConSaldo = movimientos.map(m => ({ ...m, saldo_tras: porId.get(m.movimiento_id) ?? null }))
    }
  }

  const cuentasConSaldo: CuentaConSaldo[] = cuentas.map(c => {
    const inicial = Number(c.saldo_inicial)
    // El respaldo no debería entrar nunca —la función devuelve todas las cuentas que no
    // son de «Apertura», y esas ya están fuera de `cuentas`—, pero si entrara, la cuenta
    // se queda en su saldo inicial: un cero de relleno sería un saldo falso.
    const s = saldos.get(c.cuenta_id) ?? saldoSinMovimientos(inicial)
    return { ...c, saldo_inicial: inicial, ...s }
  })

  // El corte solo se anuncia cuando es PASADO: sin `hasta`, o con un `hasta` de hoy en
  // adelante, el saldo a esa fecha ES el saldo de hoy y no hay nada que matizar. Por eso
  // la pantalla no cambia para quien no toca el rango.
  const corte = hasta && hasta < hoyEnTz() ? hasta : null

  // Los totales por moneda no se suman aquí: los hace la vista sobre estas mismas cuentas,
  // que es donde se sabe qué empresa está elegida y si se están enseñando las archivadas.

  const empresa_nombres: Record<string, string> = {}
  for (const e of empresas) empresa_nombres[e.empresa_id] = e.nombre

  return {
    cuentas:           cuentasConSaldo,
    movimientos:       movsConSaldo,
    empresa_nombres,
    empresas:          empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
    monedas:           ((monRes.data ?? []) as { codigo: string }[]).map(m => m.codigo),
    categorias_gastos: (catRes.data ?? []) as CategoriaGasto[],
    rango:             { desde, hasta },
    corte,
    q,
    hay_mas:           listaCruda.length >= limite,
    total:             movRes.count ?? listaCruda.length,
    limite,
  }
}

// ── Guardar cuenta (crear / editar) ────────────────────────────────────────────

export async function guardarCuenta(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'Sin permiso para editar en este módulo.' }

  const db = createAdminClient()

  const cuenta_id     = (formData.get('cuenta_id')  as string)?.trim()
  const empresa_id    = (formData.get('empresa_id') as string)?.trim()
  const nombre        = (formData.get('nombre')     as string)?.trim()
  const tipo          = (formData.get('tipo')       as string)?.trim() as TipoCuenta
  const moneda        = (formData.get('moneda')     as string)?.trim()
  const saldoRaw      = parseFloat(formData.get('saldo_inicial') as string)
  const saldo_inicial = isNaN(saldoRaw) ? 0 : saldoRaw
  const notas         = (formData.get('notas')      as string)?.trim() || null

  if (!nombre)                          return { ok: false, error: 'El nombre de la cuenta es obligatorio.' }
  if (!empresa_id)                      return { ok: false, error: 'Falta la empresa.' }
  // La moneda solo se fija al crear; al editar no se cambia (los movimientos
  // quedarían inconsistentes) y el campo va deshabilitado, así que no se exige.
  if (!cuenta_id && !moneda)            return { ok: false, error: 'Falta la moneda.' }
  if (!TIPOS_CUENTA.includes(tipo))     return { ok: false, error: 'Tipo de cuenta no válido.' }

  const empresas = await obtenerEmpresas()
  if (!empresas.some(e => e.empresa_id === empresa_id)) {
    return { ok: false, error: 'Empresa no válida.' }
  }

  if (!cuenta_id) {
    // Crear
    if (!await monedaValida(db, session.client_id, moneda)) {
      return { ok: false, error: `La moneda "${moneda}" no está configurada.` }
    }
    const tope = await comprobarLimite(db, session.client_id, 'cuentas_tesoreria')
    if (tope) return { ok: false, error: tope }

    const { error } = await db.from('cuentas').insert({
      cuenta_id:  generarCuentaId(),
      client_id:  session.client_id,
      empresa_id,
      nombre,
      tipo,
      moneda,
      saldo_inicial,
      notas,
      activa:     true,
      updated_at: new Date().toISOString(),
    })
    if (error) return { ok: false, error: error.message }
  } else {
    // Editar — la moneda no se cambia tras crear (los movimientos quedarían inconsistentes)
    const { error } = await db.from('cuentas')
      .update({ nombre, tipo, saldo_inicial, notas, updated_at: new Date().toISOString() })
      .eq('cuenta_id', cuenta_id)
      .eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/portal/tesoreria')
  return { ok: true }
}

// ── Archivar / restaurar cuenta ────────────────────────────────────────────────

export async function archivarCuenta(cuenta_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'Sin permiso para editar en este módulo.' }

  const { error } = await createAdminClient()
    .from('cuentas')
    .update({ activa: false, updated_at: new Date().toISOString() })
    .eq('cuenta_id', cuenta_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/tesoreria')
  return { ok: true }
}

export async function restaurarCuenta(cuenta_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'Sin permiso para editar en este módulo.' }

  const db = createAdminClient()

  // Desarchivar cuenta como crear: el cupo mide lo activo.
  const tope = await comprobarLimite(db, session.client_id, 'cuentas_tesoreria', 1, 'desarchivar')
  if (tope) return { ok: false, error: tope }

  const { error } = await db
    .from('cuentas')
    .update({ activa: true, updated_at: new Date().toISOString() })
    .eq('cuenta_id', cuenta_id)
    .eq('client_id', session.client_id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/portal/tesoreria')
  return { ok: true }
}

// ── Archivar / restaurar cuentas en lote (Fase 1) ───────────────────────────────
// Candado `base` inline (audit-gating). UPDATE atómico de `activa`. No hay borrado:
// una cuenta con movimientos se archiva, nunca se elimina.

export interface ResultadoLoteCuentas { ok: boolean; hechas: number; error?: string }

export async function archivarCuentasEnLote(
  ids: string[], archivar: boolean,
): Promise<ResultadoLoteCuentas> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, hechas: 0, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, hechas: 0, error: 'Sin permiso para editar en este módulo.' }
  if (!ids.length) return { ok: true, hechas: 0 }

  const db = createAdminClient()

  // Restaurar en lote se comprueba entero antes de tocar nada; archivar nunca
  // se bloquea (libera cupo, no lo consume).
  if (!archivar) {
    const { count: aRestaurar } = await db.from('cuentas')
      .select('cuenta_id', { count: 'exact', head: true })
      .eq('client_id', session.client_id).in('cuenta_id', ids).eq('activa', false)
    if (aRestaurar) {
      const tope = await comprobarLimite(db, session.client_id, 'cuentas_tesoreria', aRestaurar, 'desarchivar')
      if (tope) return { ok: false, hechas: 0, error: tope }
    }
  }

  const { data, error } = await db.from('cuentas')
    .update({ activa: !archivar, updated_at: new Date().toISOString() })
    .eq('client_id', session.client_id).in('cuenta_id', ids)
    .select('cuenta_id')
  if (error) return { ok: false, hechas: 0, error: error.message }
  revalidatePath('/portal/tesoreria')
  return { ok: true, hechas: (data ?? []).length }
}

// ── Registrar movimiento manual (INGRESO / EGRESO) ─────────────────────────────
// Si registrar_gasto está activo, crea también un gasto_cobro vinculado
// (GASTO si es EGRESO, COBRO si es INGRESO) y el movimiento queda con
// origen PAGO/COBRO y referencia_id al registro creado.
//
// 🔴 **Una categoría obliga a crear el registro** (fase 5 del clasificador, C7).
// `movimientos_tesoreria.categoria_id` no lo lee ningún informe: el estado de
// resultados se construye sobre `gastos_cobros`. Un movimiento MANUAL con
// categoría era, literalmente, una clasificación que no miraba nadie — el dueño
// etiquetaba «alquiler» y su informe seguía sin alquiler. Así que la categoría
// manda sobre el flag: si la hay, se escribe el registro. La combinación
// «MANUAL + categoría» deja de poder crearse por ningún camino.

export async function registrarMovimiento(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'Sin permiso para editar en este módulo.' }

  const db = createAdminClient()

  const cuenta_id      = (formData.get('cuenta_id') as string)?.trim()
  const tipo           = (formData.get('tipo')      as string)?.trim() as TipoMovimiento
  const montoRaw       = parseFloat(formData.get('monto') as string)
  const fecha          = (formData.get('fecha')     as string)?.trim()
  const concepto       = (formData.get('concepto')  as string)?.trim()
  const categoria_id   = (formData.get('categoria_id') as string)?.trim() || null
  const notas          = (formData.get('notas')     as string)?.trim() || null
  const registrarGasto = formData.get('registrar_gasto') === 'true' || !!categoria_id
  const tercero_id     = (formData.get('tercero_id') as string)?.trim() || null

  if (!cuenta_id)                          return { ok: false, error: 'Falta la cuenta.' }
  if (!TIPOS_MOVIMIENTO.includes(tipo))    return { ok: false, error: 'Tipo de movimiento no válido.' }
  if (isNaN(montoRaw) || montoRaw <= 0)    return { ok: false, error: 'El monto debe ser un número positivo.' }
  if (!concepto)                           return { ok: false, error: 'El concepto es obligatorio.' }

  // Verificar la cuenta y heredar empresa + moneda
  const { data: cuenta } = await db.from('cuentas')
    .select('empresa_id, moneda, activa')
    .eq('cuenta_id', cuenta_id)
    .eq('client_id', session.client_id)
    .single()
  if (!cuenta)        return { ok: false, error: 'Cuenta no encontrada.' }
  if (!cuenta.activa) return { ok: false, error: 'La cuenta está archivada.' }

  // Obtener nombre de categoría si se proporciona categoria_id
  let categoriaNombre: string | null = null
  if (categoria_id) {
    const { data: cat } = await db.from('categorias_gastos')
      .select('nombre')
      .eq('categoria_id', categoria_id)
      .eq('client_id', session.client_id)
      .eq('estado', 'ACTIVO')
      .maybeSingle()
    if (!cat) return { ok: false, error: 'Categoría de gasto no válida o inactiva.' }
    categoriaNombre = cat.nombre
  }

  let gastoId: string | null = null
  const fechaFinal = fecha || hoyEnTz()

  if (registrarGasto) {
    const esGasto = tipo === 'EGRESO'
    gastoId = generarRegistroId(esGasto ? 'GASTO' : 'COBRO')
    const { error: gcErr } = await db.from('gastos_cobros').insert({
      registro_id:  gastoId,
      client_id:    session.client_id,
      empresa_id:   cuenta.empresa_id,
      tipo:         esGasto ? 'GASTO' : 'COBRO',
      fecha:        fechaFinal,
      descripcion:  concepto,
      concepto,                 // mig. 152: la columna que lee la tabla de Gastos
      categoria:    categoriaNombre,
      categoria_id,
      moneda:       cuenta.moneda,
      monto:        montoRaw,
      tercero_id:   tercero_id,
      notas,
      updated_at:   new Date().toISOString(),
    })
    if (gcErr) return { ok: false, error: `No se ha podido crear el registro: ${gcErr.message}` }
  }

  const { error } = await db.from('movimientos_tesoreria').insert({
    movimiento_id: generarMovimientoId(),
    client_id:     session.client_id,
    empresa_id:    cuenta.empresa_id,
    cuenta_id,
    fecha:         fechaFinal,
    tipo,
    monto:         montoRaw,
    moneda:        cuenta.moneda,
    monto_ref:     montoRaw,   // gasto/cobro creado en la misma moneda de la caja
    concepto,
    categoria:     categoriaNombre,
    categoria_id,
    origen:        registrarGasto ? (tipo === 'EGRESO' ? 'PAGO' : 'COBRO') : 'MANUAL',
    referencia_id: gastoId,
    notas,
  })
  if (error) {
    if (gastoId) {
      await db.from('gastos_cobros').delete().eq('registro_id', gastoId).eq('client_id', session.client_id)
    }
    return { ok: false, error: error.message }
  }

  revalidatePath('/portal/tesoreria')
  if (registrarGasto) {
    revalidatePath('/portal/gastos')
    revalidatePath('/portal/cxp')
    revalidatePath('/portal/cxc')
    revalidarFinanzas()
  }
  return { ok: true }
}

// ── Obtener tasa vigente para transferencia entre monedas ─────────────────────
// Busca tasa directa (origen→destino). Si no existe, calcula la inversa (destino→origen).
// Devuelve tasa completa para cálculos y tasaDisplay truncada a 4 decimales para UI.

export async function obtenerTasaTransferencia(
  moneda_origen: string,
  moneda_destino: string,
): Promise<{ ok: boolean; tasa?: number; tasaDisplay?: number; fecha?: string; esInversa?: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }

  if (moneda_origen === moneda_destino) {
    return { ok: true, tasa: 1, tasaDisplay: 1, fecha: hoyEnTz() }
  }

  const db = createAdminClient()

  const { data: directa } = await db.from('tasas_cambio')
    .select('tasa, fecha')
    .eq('client_id', session.client_id)
    .eq('moneda_origen', moneda_origen)
    .eq('moneda_destino', moneda_destino)
    .order('fecha', { ascending: false })
    .order('tasa_id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (directa) {
    const tasaCompleta = Number(directa.tasa)
    return { ok: true, tasa: tasaCompleta, tasaDisplay: Math.trunc(tasaCompleta * 10000) / 10000, fecha: directa.fecha, esInversa: false }
  }

  const { data: inversa } = await db.from('tasas_cambio')
    .select('tasa, fecha')
    .eq('client_id', session.client_id)
    .eq('moneda_origen', moneda_destino)
    .eq('moneda_destino', moneda_origen)
    .order('fecha', { ascending: false })
    .order('tasa_id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (inversa && Number(inversa.tasa) > 0) {
    const tasaCompleta = 1 / Number(inversa.tasa)
    return { ok: true, tasa: tasaCompleta, tasaDisplay: Math.trunc(tasaCompleta * 10000) / 10000, fecha: inversa.fecha, esInversa: true }
  }

  return { ok: false, error: `Sin tasa registrada para ${moneda_origen} → ${moneda_destino}.` }
}

// ── Registrar transferencia entre cuentas (misma o diferente moneda) ───────────
// Crea movimientos agrupados por transfer_grupo:
//   - EGRESO en origen (monto principal)
//   - INGRESO en destino (monto × tasa)
//   - Si fee_envio > 0: gasto_cobros + EGRESO en origen
//   - Si fee_recibo > 0: gasto_cobros + EGRESO en destino

export async function registrarTransferencia(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'Sin permiso para editar en este módulo.' }

  const db = createAdminClient()

  const cuenta_origen  = (formData.get('cuenta_origen')  as string)?.trim()
  const cuenta_destino = (formData.get('cuenta_destino') as string)?.trim()
  const montoRaw       = parseFloat(formData.get('monto') as string)
  const fecha          = (formData.get('fecha')    as string)?.trim()
  const concepto       = (formData.get('concepto') as string)?.trim() || 'Transferencia entre cuentas'
  const notas          = (formData.get('notas')    as string)?.trim() || null
  const tasaRaw        = parseFloat(formData.get('tasa_cambio') as string)
  const feeEnvioRaw    = parseFloat(formData.get('fee_envio') as string)
  const feeReciboRaw   = parseFloat(formData.get('fee_recibo') as string)

  if (!cuenta_origen || !cuenta_destino) return { ok: false, error: 'Faltan la cuenta de origen y la de destino.' }
  if (cuenta_origen === cuenta_destino)  return { ok: false, error: 'El origen y el destino deben ser distintos.' }
  if (isNaN(montoRaw) || montoRaw <= 0)  return { ok: false, error: 'El monto debe ser un número positivo.' }

  const feeEnvio  = isNaN(feeEnvioRaw)  ? 0 : feeEnvioRaw
  const feeRecibo = isNaN(feeReciboRaw) ? 0 : feeReciboRaw

  if (feeEnvio < 0)  return { ok: false, error: 'El fee de envío no puede ser negativo.' }
  if (feeRecibo < 0) return { ok: false, error: 'El fee de recepción no puede ser negativo.' }

  const { data: cuentas } = await db.from('cuentas')
    .select('cuenta_id, nombre, empresa_id, moneda, activa')
    .eq('client_id', session.client_id)
    .in('cuenta_id', [cuenta_origen, cuenta_destino])

  const origen  = cuentas?.find(c => c.cuenta_id === cuenta_origen)
  const destino = cuentas?.find(c => c.cuenta_id === cuenta_destino)
  if (!origen || !destino)               return { ok: false, error: 'Cuenta no encontrada.' }
  if (!origen.activa || !destino.activa) return { ok: false, error: 'Ambas cuentas deben estar activas.' }

  const monedasDiferentes = origen.moneda !== destino.moneda
  let tasa = 1
  let montoDestino = montoRaw

  if (monedasDiferentes) {
    if (isNaN(tasaRaw) || tasaRaw <= 0) {
      return { ok: false, error: 'Falta la tasa de cambio para transferencias entre monedas.' }
    }
    tasa = tasaRaw
    montoDestino = montoRaw * tasa
  }

  // Categoría del sistema «Comisiones bancarias», resuelta-o-creada (mig. 133).
  const catComisiones = await resolverCategoriaSistema(db, session.client_id, 'comisiones_bancarias')

  const comisionesCategoriaId = catComisiones?.categoria_id ?? null
  const comisionesNombre = catComisiones?.nombre ?? 'Comisiones bancarias'

  const grupo      = `TRF-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
  const fechaFinal = fecha || hoyEnTz()

  const movimientos: Record<string, unknown>[] = [
    {
      movimiento_id: generarMovimientoId(),
      client_id:     session.client_id,
      empresa_id:    origen.empresa_id,
      cuenta_id:     origen.cuenta_id,
      fecha:         fechaFinal,
      tipo:          'EGRESO',
      monto:         montoRaw,
      moneda:        origen.moneda,
      concepto:      monedasDiferentes
        ? `${concepto} → ${destino.nombre} (${formatTasa(tasa)} ${destino.moneda}/${origen.moneda})`
        : `${concepto} → ${destino.nombre}`,
      origen:        'TRANSFERENCIA',
      transfer_grupo: grupo,
      notas,
    },
    {
      movimiento_id: generarMovimientoId(),
      client_id:     session.client_id,
      empresa_id:    destino.empresa_id,
      cuenta_id:     destino.cuenta_id,
      fecha:         fechaFinal,
      tipo:          'INGRESO',
      monto:         montoDestino,
      moneda:        destino.moneda,
      concepto:      monedasDiferentes
        ? `${concepto} ← ${origen.nombre} (${formatTasa(tasa)} ${destino.moneda}/${origen.moneda})`
        : `${concepto} ← ${origen.nombre}`,
      origen:        'TRANSFERENCIA',
      transfer_grupo: grupo,
      notas,
    },
  ]

  const gastosCreados: string[] = []

  if (feeEnvio > 0) {
    const gasto_id = generarRegistroId('GASTO')
    gastosCreados.push(gasto_id)
    const { error } = await db.from('gastos_cobros').insert({
      registro_id:  gasto_id,
      client_id:    session.client_id,
      empresa_id:   origen.empresa_id,
      tipo:         'GASTO',
      fecha:        fechaFinal,
      descripcion:  `Comisión transferencia ${origen.nombre} → ${destino.nombre}`,
      categoria:    comisionesNombre,
      categoria_id: comisionesCategoriaId,
      moneda:       origen.moneda,
      monto:        feeEnvio,
      updated_at:   new Date().toISOString(),
    })
    if (error) return { ok: false, error: `No se ha podido crear gasto de fee envío: ${error.message}` }

    movimientos.push({
      movimiento_id: generarMovimientoId(),
      client_id:     session.client_id,
      empresa_id:    origen.empresa_id,
      cuenta_id:     origen.cuenta_id,
      fecha:         fechaFinal,
      tipo:          'EGRESO',
      monto:         feeEnvio,
      moneda:        origen.moneda,
      monto_ref:     feeEnvio,
      concepto:      `Comisión transferencia → ${destino.nombre}`,
      categoria:     comisionesNombre,
      categoria_id:  comisionesCategoriaId,
      origen:        'PAGO',
      referencia_id: gasto_id,
      transfer_grupo: grupo,
      notas,
    })
  }

  if (feeRecibo > 0) {
    const gasto_id = generarRegistroId('GASTO')
    gastosCreados.push(gasto_id)
    const { error } = await db.from('gastos_cobros').insert({
      registro_id:  gasto_id,
      client_id:    session.client_id,
      empresa_id:   destino.empresa_id,
      tipo:         'GASTO',
      fecha:        fechaFinal,
      descripcion:  `Comisión transferencia ${origen.nombre} → ${destino.nombre}`,
      categoria:    comisionesNombre,
      categoria_id: comisionesCategoriaId,
      moneda:       destino.moneda,
      monto:        feeRecibo,
      updated_at:   new Date().toISOString(),
    })
    if (error) return { ok: false, error: `No se ha podido crear gasto de fee recepción: ${error.message}` }

    movimientos.push({
      movimiento_id: generarMovimientoId(),
      client_id:     session.client_id,
      empresa_id:    destino.empresa_id,
      cuenta_id:     destino.cuenta_id,
      fecha:         fechaFinal,
      tipo:          'EGRESO',
      monto:         feeRecibo,
      moneda:        destino.moneda,
      monto_ref:     feeRecibo,
      concepto:      `Comisión transferencia ← ${origen.nombre}`,
      categoria:     comisionesNombre,
      categoria_id:  comisionesCategoriaId,
      origen:        'PAGO',
      referencia_id: gasto_id,
      transfer_grupo: grupo,
      notas,
    })
  }

  const { error } = await db.from('movimientos_tesoreria').insert(movimientos)
  if (error) {
    for (const gid of gastosCreados) {
      await db.from('gastos_cobros').delete().eq('registro_id', gid).eq('client_id', session.client_id)
    }
    return { ok: false, error: error.message }
  }

  revalidatePath('/portal/tesoreria')
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/cxp')
  revalidarFinanzas()
  return { ok: true }
}

// ── Editar un movimiento MANUAL ────────────────────────────────────────────────
//
// Hasta ahora un movimiento solo se podía borrar y volver a crear: para corregir una
// fecha mal escrita había que destruir la fila y perder su código. Se permite editar con
// las MISMAS guardas que el borrado y por la misma razón:
//   · solo `origen='MANUAL'` — un movimiento de cobro/pago es el reflejo de un documento
//     y se corrige desde él, no por detrás;
//   · sin `transfer_grupo` — las dos patas de una transferencia tienen que cuadrar entre
//     sí, y editar una sola dejaría dinero creado o destruido de la nada.
//
// La CUENTA y la MONEDA no se cambian: mover un movimiento de caja es cambiar dos saldos
// a la vez, y si además cambia la moneda el importe deja de significar lo mismo. Para eso
// está borrar y volver a registrar.
export async function editarMovimiento(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'Sin permiso para editar en este módulo.' }

  const db = createAdminClient()

  const movimiento_id = (formData.get('movimiento_id') as string)?.trim()
  const fecha         = (formData.get('fecha')     as string)?.trim()
  const concepto      = (formData.get('concepto')  as string)?.trim()
  const notas         = (formData.get('notas')     as string)?.trim() || null
  const montoRaw      = parseFloat(formData.get('monto') as string)

  if (!movimiento_id)                   return { ok: false, error: 'Movimiento no indicado.' }
  if (!concepto)                        return { ok: false, error: 'El concepto es obligatorio.' }
  if (isNaN(montoRaw) || montoRaw <= 0) return { ok: false, error: 'El monto debe ser un número positivo.' }

  const { data: mov } = await db.from('movimientos_tesoreria')
    .select('origen, transfer_grupo, referencia_id, tipo, moneda')
    .eq('movimiento_id', movimiento_id)
    .eq('client_id', session.client_id)
    .maybeSingle()
  if (!mov) return { ok: false, error: 'Movimiento no encontrado.' }
  if (mov.transfer_grupo) {
    return { ok: false, error: 'Es una transferencia: bórrala y vuelve a registrarla para que las dos patas cuadren.' }
  }
  if (mov.origen !== 'MANUAL') {
    return { ok: false, error: 'Este movimiento proviene de un cobro o pago: la corrección se hace desde su documento.' }
  }

  // 🔴 La CATEGORÍA no se edita aquí, y desde la fase 5 tampoco se pide en pantalla.
  // Un movimiento manual es dinero que se mueve y nada más: clasificarlo en esta
  // tabla no lo mete en el informe —el informe se construye sobre `gastos_cobros`—
  // y le daba al dueño la impresión contraria. Si era un gasto o un cobro, el
  // camino es borrarlo y registrarlo eligiendo qué fue, que sí crea el registro.
  const { error } = await db.from('movimientos_tesoreria')
    .update({
      fecha:        fecha || undefined,
      monto:        montoRaw,
      monto_ref:    montoRaw,
      concepto,
      notas,
    })
    .eq('movimiento_id', movimiento_id)
    .eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/tesoreria')
  revalidarFinanzas()
  return { ok: true }
}

// ── Eliminar movimiento ────────────────────────────────────────────────────────
// Si forma parte de una transferencia, elimina todas las patas (por transfer_grupo)
// y los gastos_cobros asociados a fees.
// Solo se permite borrar movimientos manuales o de transferencia (no cobros/pagos
// independientes: esos se revierten desde Gastos y cobros).

export async function eliminarMovimiento(movimiento_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, error: 'Sin permiso para editar en este módulo.' }

  const db = createAdminClient()

  const { data: mov } = await db.from('movimientos_tesoreria')
    .select('origen, transfer_grupo')
    .eq('movimiento_id', movimiento_id)
    .eq('client_id', session.client_id)
    .single()
  if (!mov) return { ok: false, error: 'Movimiento no encontrado.' }

  if (!mov.transfer_grupo) {
    if (mov.origen === 'COBRO' || mov.origen === 'PAGO') {
      return { ok: false, error: 'Este movimiento proviene de un cobro o pago. Anúlalo desde su documento.' }
    }
    const { error } = await db.from('movimientos_tesoreria')
      .delete()
      .eq('movimiento_id', movimiento_id)
      .eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/portal/tesoreria')
    return { ok: true }
  }

  const { data: grupoMovs } = await db.from('movimientos_tesoreria')
    .select('movimiento_id, origen, referencia_id')
    .eq('client_id', session.client_id)
    .eq('transfer_grupo', mov.transfer_grupo)

  const gastoIds = (grupoMovs ?? [])
    .filter(m => m.origen === 'PAGO' && m.referencia_id)
    .map(m => m.referencia_id)

  if (gastoIds.length > 0) {
    await db.from('gastos_cobros')
      .delete()
      .eq('client_id', session.client_id)
      .in('registro_id', gastoIds)
  }

  const { error } = await db.from('movimientos_tesoreria')
    .delete()
    .eq('client_id', session.client_id)
    .eq('transfer_grupo', mov.transfer_grupo)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/portal/tesoreria')
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/cxp')
  revalidarFinanzas()
  return { ok: true }
}

// ── Eliminar movimientos en lote (Fase 2) ───────────────────────────────────────
// Candado `base` inline (audit-gating). Solo son elegibles los MANUALES sin
// transfer_grupo: reutiliza la guarda de eliminarMovimiento en bucle secuencial.
// Los provenientes de cobro/pago o de transferencias se OMITEN con su motivo (no
// se borran a ciegas: descuadran saldos y estados derivados).

export interface ResultadoLoteMovimientos {
  ok: boolean
  hechas: number
  omitidas: { concepto: string; motivo: string }[]
  error?: string
}

export async function eliminarMovimientosEnLote(ids: string[]): Promise<ResultadoLoteMovimientos> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, hechas: 0, omitidas: [], error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('base'))) return { ok: false, hechas: 0, omitidas: [], error: 'Sin permiso para editar en este módulo.' }
  if (!ids.length) return { ok: true, hechas: 0, omitidas: [] }

  const db = createAdminClient()
  const { data: movs } = await db.from('movimientos_tesoreria')
    .select('movimiento_id, concepto, origen, transfer_grupo')
    .eq('client_id', session.client_id).in('movimiento_id', ids)

  const res: ResultadoLoteMovimientos = { ok: true, hechas: 0, omitidas: [] }
  for (const m of (movs ?? []) as { movimiento_id: string; concepto: string; origen: string; transfer_grupo: string | null }[]) {
    if (m.transfer_grupo) {
      res.omitidas.push({ concepto: m.concepto, motivo: 'es una transferencia (elimínala desde su detalle)' }); continue
    }
    if (m.origen !== 'MANUAL') {
      res.omitidas.push({ concepto: m.concepto, motivo: 'proviene de un cobro o pago (anúlalo desde su documento)' }); continue
    }
    const r = await eliminarMovimiento(m.movimiento_id)   // secuencial; conserva la guarda individual
    if (r.ok) res.hechas++
    else res.omitidas.push({ concepto: m.concepto, motivo: r.error ?? 'No se pudo eliminar' })
  }
  revalidatePath('/portal/tesoreria')
  return res
}
