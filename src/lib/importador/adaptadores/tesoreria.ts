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

import { memo, norm, parseNumero, totalesPor } from '../util'
import { defEmpresa } from './comunes'
import type { Adaptador, CtxImport, Preparado } from '../tipos'

type DatosSaldo = { cuenta_id: string; saldo_inicial: number; moneda: string }

/** Cuenta de la empresa por su CTA- o por nombre (nunca una de apertura). */
async function buscarCuenta(
  ref: string, empresa_id: string, moneda: string, ctx: CtxImport,
): Promise<{ cuenta_id: string; moneda: string } | null> {
  return memo(ctx, `cta|${empresa_id}|${moneda}|${norm(ref)}`, async () => {
    const base = () => ctx.db.from('cuentas').select('cuenta_id, moneda')
      .eq('client_id', ctx.client_id).eq('empresa_id', empresa_id).eq('es_apertura', false)
    const porId = await base().eq('cuenta_id', ref.trim().toUpperCase()).limit(1).maybeSingle()
    if (porId.data) return porId.data as { cuenta_id: string; moneda: string }
    // Con moneda se desambigua «Caja» en CUP de «Caja» en USD. Si aun así hay dos
    // con el mismo nombre, se falla: pisar el saldo de la cuenta equivocada no
    // deja rastro de que se eligió a ciegas.
    const q = moneda ? base().eq('moneda', moneda) : base()
    const { data } = await q.ilike('nombre', ref.trim()).limit(2)
    const filas = (data ?? []) as { cuenta_id: string; moneda: string }[]
    return filas.length === 1 ? filas[0] : null
  })
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

    const cuenta = await buscarCuenta(ref, empresa_id, moneda, ctx)
    if (!cuenta) return { ok: false, motivo: `No hay una única cuenta "${ref}" en esa empresa: créala en Tesorería, o indica la moneda si hay varias con ese nombre.` }
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
