// Adaptador del SALDO INICIAL de tesorería: la caja REAL que el cliente tiene a
// la fecha de corte, cuenta por cuenta.
//
// No crea cuentas ni movimientos: escribe `cuentas.saldo_inicial`, el mismo campo
// que el formulario de alta de una cuenta (decisión D-B: las dos vías, un solo
// campo). El saldo de una cuenta es `saldo_inicial + Σ INGRESO − Σ EGRESO`, así
// que poner aquí lo que había al empezar deja el saldo de hoy correcto sin
// inventar un movimiento de la nada.
//
// Ojo con no confundirlo con la cuenta técnica de «Apertura» (mig. 130): esa
// absorbe el histórico YA PAGADO y está fuera de los saldos; esto es dinero real.

import { indicePorNombre, memo, parseNumero, totalesPor } from '../util'
import { aFallo, resolverRef } from '../resolver'
import { defEmpresa } from './comunes'
import type { Adaptador, CtxImport, Preparado } from '../tipos'

type DatosSaldo  = { cuenta_id: string; saldo_inicial: number; moneda: string }
type FichaCuenta = {
  cuenta_id: string; nombre: string; moneda: string; empresa_id: string; es_apertura: boolean
}

/** Las cuentas del cliente, una sola vez por lote. */
async function cuentas(ctx: CtxImport): Promise<FichaCuenta[]> {
  return memo(ctx, 'lista|cuentas', async () => {
    const { data } = await ctx.db.from('cuentas')
      .select('cuenta_id, nombre, moneda, empresa_id, es_apertura').eq('client_id', ctx.client_id)
    return (data ?? []) as FichaCuenta[]
  })
}

/**
 * Cuenta de la empresa por su CTA- o por nombre (nunca una de apertura). Una
 * cuenta no se crea desde aquí —necesita tipo, moneda y su sitio en Tesorería—,
 * así que el resolutor solo pregunta: con dos «Caja» o con un nombre que no
 * cuadra, el operador señala cuál es. Pisar el saldo de la cuenta equivocada no
 * deja ningún rastro de que se eligió a ciegas.
 */
async function buscarCuenta(
  ref: string, empresa_id: string, moneda: string, ctx: CtxImport,
): Promise<{ ok: true; ficha: FichaCuenta } | Extract<Preparado, { ok: false }>> {
  const dela = (c: FichaCuenta) => c.empresa_id === empresa_id && !c.es_apertura
  const id = ref.trim().toUpperCase()
  const porId = (await cuentas(ctx)).find(c => dela(c) && c.cuenta_id.toUpperCase() === id)
  if (porId) return { ok: true, ficha: porId }

  // Con moneda se desambigua «Caja» en CUP de «Caja» en USD.
  const suya = (c: FichaCuenta) => dela(c) && (!moneda || c.moneda === moneda)
  const idx  = await indicePorNombre(ctx, 'cuentas', () => cuentas(ctx), c => c.nombre)
  const op   = (c: FichaCuenta) => ({ valor: c.cuenta_id, etiqueta: `${c.nombre} · ${c.moneda}` })
  const r = resolverRef({
    tipo: 'cuenta', etiqueta_tipo: 'Cuenta', texto: ref,
    ambito: empresa_id,
    coincidencias: idx.buscar(ref, suya).map(op),
    parecidos:     idx.sugerir(ref, suya).map(op),
    otras:         idx.todas(dela).map(op),
    creable: false, omitible: false, defecto: 'RECHAZAR',
  }, ctx)
  const fallo = aFallo(r)
  if (fallo) return fallo
  const ficha = (await cuentas(ctx)).find(c => c.cuenta_id === (r as { id: string }).id)
  return ficha
    ? { ok: true, ficha }
    : { ok: false, motivo: `No hay ninguna cuenta "${ref}" en esa empresa: créala en Tesorería.` }
}

export const adaptadorTesoreriaSaldo: Adaptador = {
  entidad:   'tesoreria_saldo',
  etiqueta:  'Saldos de caja',
  modulos:   ['base'],
  revalidar: '/portal/tesoreria',
  defaults: [defEmpresa],
  campos: [
    { campo: 'cuenta',        etiqueta: 'Cuenta',        obligatorio: true,  alias: ['cuenta', 'caja', 'banco', 'nombre'], ayuda: 'Por nombre. La cuenta tiene que existir ya en Tesorería.', ejemplo: 'Caja principal' },
    { campo: 'saldo_inicial', etiqueta: 'Saldo',         obligatorio: true,  alias: ['saldo', 'saldo inicial', 'importe', 'monto', 'efectivo'], ayuda: 'Lo que hay en esa cuenta a la fecha de corte.', ejemplo: '25000' },
    { campo: 'moneda',        etiqueta: 'Moneda',        obligatorio: false, alias: ['moneda', 'divisa'], ayuda: 'Solo para distinguir dos cuentas con el mismo nombre.', ejemplo: 'CUP' },
  ],

  async preparar(valores, ctx): Promise<Preparado> {
    const empresa_id = (valores.empresa_id ?? '').trim()
    if (!empresa_id || !ctx.empresas.some(e => e.empresa_id === empresa_id))
      return { ok: false, motivo: 'Empresa no válida o no indicada.' }

    const ref = (valores.cuenta ?? '').trim()
    if (!ref) return { ok: false, motivo: 'Falta la cuenta.' }

    const moneda = (valores.moneda ?? '').trim().toUpperCase()
    if (moneda && !ctx.monedas.includes(moneda))
      return { ok: false, motivo: `La moneda "${moneda}" no está configurada en Monedas y Tasas.` }

    const rc = await buscarCuenta(ref, empresa_id, moneda, ctx)
    if (!rc.ok) return rc
    const cuenta = rc.ficha
    if (moneda && cuenta.moneda !== moneda)
      return { ok: false, motivo: `La cuenta "${ref}" es en ${cuenta.moneda}, no en ${moneda}.` }

    const saldo = parseNumero(valores.saldo_inicial)
    if (saldo === undefined) return { ok: false, motivo: 'El saldo no es un número.' }
    if (saldo == null)       return { ok: false, motivo: 'Falta el saldo.' }

    const datos: DatosSaldo = { cuenta_id: cuenta.cuenta_id, saldo_inicial: saldo, moneda: cuenta.moneda }
    return { ok: true, datos, clave: cuenta.cuenta_id }
  },

  // Por moneda, no un total único: sumar pesos con dólares da un número que no
  // significa nada y que nadie puede contrastar con su caja.
  resumen: filas => totalesPor(
    filas,
    f => (f as unknown as DatosSaldo).moneda,
    f => (f as unknown as DatosSaldo).saldo_inicial,
    m => `Saldos ${m}`,
  ),

  /** «Ya existe» = esa cuenta YA tiene saldo inicial puesto (0 no cuenta). */
  async buscarExistente(datos, ctx) {
    const d = datos as DatosSaldo
    const { data } = await ctx.db.from('cuentas')
      .select('saldo_inicial').eq('cuenta_id', d.cuenta_id).eq('client_id', ctx.client_id).maybeSingle()
    return Number(data?.saldo_inicial ?? 0) !== 0 ? d.cuenta_id : null
  },

  /** No inserta filas: pone el saldo la primera vez (la cuenta ya existe). */
  async insertar(datos, ctx) {
    const d = datos as DatosSaldo
    const { error } = await ctx.db.from('cuentas')
      .update({ saldo_inicial: d.saldo_inicial, updated_at: new Date().toISOString() })
      .eq('cuenta_id', d.cuenta_id).eq('client_id', ctx.client_id)
    if (error) throw new Error(error.message)
    return d.cuenta_id
  },

  /** La cuenta ya traía saldo: se pisa con el del archivo (corrección explícita). */
  async actualizar(id, datos, ctx) {
    const d = datos as DatosSaldo
    const { error } = await ctx.db.from('cuentas')
      .update({ saldo_inicial: d.saldo_inicial, updated_at: new Date().toISOString() })
      .eq('cuenta_id', id).eq('client_id', ctx.client_id)
    if (error) throw new Error(error.message)
  },

  // Solo se deshace lo INSERTADO, y aquí insertar significa que el saldo era 0
  // (con saldo puesto se habría saltado o actualizado). Así que deshacer = 0.
  async deshacer(pk, ctx) {
    const { error } = await ctx.db.from('cuentas')
      .update({ saldo_inicial: 0, updated_at: new Date().toISOString() })
      .eq('cuenta_id', pk).eq('client_id', ctx.client_id)
    return error ? error.message : null
  },
}
