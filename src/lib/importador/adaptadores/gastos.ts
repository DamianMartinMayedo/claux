// Adaptador del HISTÓRICO FINANCIERO: gastos y cobros. Son dos entidades del
// mismo adaptador porque comparten tabla (`gastos_cobros`) y difieren en lo que
// el operador teclea (mig. 126): un GASTO se identifica por categoría —y su
// etiqueta se deriva—, un COBRO lleva concepto libre.
//
// Aquí entra TODO el histórico que no son documentos: la nómina de marzo, el
// alquiler, lo que le deben al cliente. Admite filas agregadas (un resumen por
// mes = una fila), que es como se migra de verdad.
//
// Lo pagado y lo pendiente, que es la parte delicada:
//   · El estado NO se guarda, se DERIVA de los movimientos de tesorería que
//     referencian al registro. Así que dejarlo sin más = PENDIENTE, y aparece en
//     CxP/CxC (con `vencimiento` para que el aging tenga sentido).
//   · Lo YA PAGADO se salda contra la cuenta técnica de «Apertura»
//     (`@/lib/tesoreria-core`, mig. 130), fechado en el período del gasto y NUNCA
//     hoy: el resultado devengado cuadra por fecha y la caja real no se toca.

import { etiquetaDeCategoria, generarRegistroId, type TipoRegistro } from '@/lib/gastos-core'
import { generarMovimientoId, obtenerCuentaApertura } from '@/lib/tesoreria-core'
import { memo, norm, parseBooleano, parseFecha, parseNumero, totalesPor } from '../util'
import { defEmpresa, defMoneda } from './comunes'
import type { Adaptador, CampoDef, CtxImport, Preparado } from '../tipos'

const EPS = 0.005

type DatosGasto = {
  registro:  Record<string, unknown>   // fila de `gastos_cobros`
  pagado:    number                    // cuánto se liquida contra «Apertura»
  categoria_nombre: string | null
}

/**
 * Categoría de gasto por nombre; `parent` acota la búsqueda a sus hijas.
 * Null si no existe O si hay más de una con ese nombre: con dos «Alquiler» en el
 * catálogo, elegir una a ciegas clasifica el gasto donde nadie ha decidido.
 */
async function idCategoriaGasto(
  nombre: string, parent: string | null, ctx: CtxImport,
): Promise<string | null> {
  return memo(ctx, `catgas|${parent ?? '-'}|${norm(nombre)}`, async () => {
    let q = ctx.db.from('categorias_gastos').select('categoria_id')
      .eq('client_id', ctx.client_id).eq('estado', 'ACTIVO').ilike('nombre', nombre.trim())
    q = parent ? q.eq('parent_id', parent) : q.is('parent_id', null)
    const { data } = await q.limit(2)
    const filas = (data ?? []) as { categoria_id: string }[]
    return filas.length === 1 ? filas[0].categoria_id : null
  })
}

/** Tercero por nombre dentro de la empresa (proveedor del gasto o cliente del cobro). */
async function idTercero(nombre: string, empresa_id: string, ctx: CtxImport): Promise<string | null> {
  return memo(ctx, `ter|${empresa_id}|${norm(nombre)}`, async () => {
    const { data } = await ctx.db.from('third_parties').select('tercero_id')
      .eq('client_id', ctx.client_id).eq('empresa_id', empresa_id)
      .ilike('nombre', nombre.trim()).limit(1).maybeSingle()
    return (data?.tercero_id as string) ?? null
  })
}

const CAMPOS_COMUNES: CampoDef[] = [
  { campo: 'fecha',       etiqueta: 'Fecha',       obligatorio: true,  alias: ['fecha', 'periodo', 'período', 'mes', 'fecha gasto'], ayuda: 'De un resumen mensual, el último día del mes.', ejemplo: '31/03/2026' },
  { campo: 'monto',       etiqueta: 'Importe',     obligatorio: true,  alias: ['monto', 'importe', 'total', 'valor', 'cantidad'], ejemplo: '12500' },
  { campo: 'moneda',      etiqueta: 'Moneda',      obligatorio: false, alias: ['moneda', 'divisa'], ejemplo: 'CUP' },
  { campo: 'vencimiento', etiqueta: 'Vencimiento', obligatorio: false, alias: ['vencimiento', 'vence', 'fecha vencimiento'], ayuda: 'Solo para lo pendiente. Si falta, se usa la fecha del registro.', ejemplo: '30/04/2026' },
  { campo: 'notas',       etiqueta: 'Notas',       obligatorio: false, alias: ['notas', 'observaciones', 'detalle', 'comentarios'], ejemplo: 'Fila de ejemplo: puedes dejarla, no se importa' },
]

function crearAdaptadorGastoCobro(tipo: TipoRegistro): Adaptador {
  const esGasto = tipo === 'GASTO'
  const verbo   = esGasto ? 'Pagado' : 'Cobrado'

  const propios: CampoDef[] = esGasto
    ? [
        { campo: 'categoria',    etiqueta: 'Categoría',    obligatorio: true,  alias: ['categoria', 'categoría', 'tipo gasto', 'concepto', 'partida'], ayuda: 'Por nombre. Tiene que existir en las categorías de gastos.', ejemplo: 'Alquiler' },
        { campo: 'subcategoria', etiqueta: 'Subcategoría', obligatorio: false, alias: ['subcategoria', 'subcategoría', 'detalle categoria'], ejemplo: 'Local' },
        { campo: 'tercero',      etiqueta: 'Proveedor',    obligatorio: false, alias: ['proveedor', 'tercero', 'acreedor', 'suministrador'], ayuda: 'Por nombre. Opcional.', ejemplo: 'Comercial Ejemplo S.A.' },
      ]
    : [
        { campo: 'concepto', etiqueta: 'Concepto', obligatorio: true,  alias: ['concepto', 'descripcion', 'descripción', 'detalle', 'motivo'], ejemplo: 'Alquiler de local a terceros' },
        { campo: 'tercero',  etiqueta: 'Cliente',  obligatorio: false, alias: ['cliente', 'tercero', 'deudor'], ayuda: 'Por nombre. Opcional.', ejemplo: 'Comercial Ejemplo S.A.' },
      ]

  const cobro: CampoDef[] = [
    { campo: 'pagado',       etiqueta: verbo,               obligatorio: false, alias: esGasto ? ['pagado', 'liquidado', 'saldado'] : ['cobrado', 'liquidado', 'recibido'], ayuda: `Sí / No. Con «Sí» se da por ${verbo.toLowerCase()} el importe entero.`, ejemplo: 'Sí' },
    { campo: 'monto_pagado', etiqueta: `Importe ${verbo.toLowerCase()}`, obligatorio: false, alias: esGasto ? ['monto pagado', 'importe pagado', 'abonado'] : ['monto cobrado', 'importe cobrado'], ayuda: 'Para pagos parciales. Manda sobre la casilla de arriba.', ejemplo: '12500' },
  ]

  return {
    entidad:   esGasto ? 'gastos' : 'cobros',
    etiqueta:  esGasto ? 'Gastos' : 'Cobros',
    modulos:   ['base'],
    revalidar: '/portal/gastos',
    defaults: [
      defEmpresa,
      defMoneda('moneda', true, 'La de las filas que no traigan moneda propia.'),
    ],
    campos: [...propios, ...CAMPOS_COMUNES, ...cobro],

    // Totales por moneda: si un «1.500» se hubiera leído como 1,5, el total lo
    // canta antes de escribir nada.
    resumen: filas => {
      const reg = (f: Record<string, unknown>) => (f as unknown as DatosGasto).registro
      return [
        ...totalesPor(filas, f => reg(f).moneda as string, f => reg(f).monto as number,
          m => `Total ${esGasto ? 'gastos' : 'cobros'} ${m}`),
        ...totalesPor(filas.filter(f => (f as unknown as DatosGasto).pagado > EPS),
          f => reg(f).moneda as string, f => (f as unknown as DatosGasto).pagado,
          m => `Ya ${verbo.toLowerCase()} ${m}`),
      ]
    },

    async preparar(valores, ctx): Promise<Preparado> {
      const empresa_id = (valores.empresa_id ?? '').trim()
      if (!empresa_id || !ctx.empresas.some(e => e.empresa_id === empresa_id))
        return { ok: false, motivo: 'Empresa no válida o no indicada.' }

      const moneda = (valores.moneda ?? '').trim().toUpperCase()
      if (!moneda) return { ok: false, motivo: 'Falta la moneda.' }
      if (!ctx.monedas.includes(moneda))
        return { ok: false, motivo: `La moneda "${moneda}" no está configurada en Monedas y Tasas.` }

      const monto = parseNumero(valores.monto)
      if (monto === undefined)          return { ok: false, motivo: 'El importe no es un número.' }
      if (monto == null || monto <= 0)  return { ok: false, motivo: 'El importe debe ser mayor que cero.' }

      const fecha = parseFecha(valores.fecha)
      if (fecha === undefined) return { ok: false, motivo: 'La fecha no se entiende (usa dd/mm/aaaa).' }
      if (!fecha)              return { ok: false, motivo: 'Falta la fecha.' }

      const vencimiento = parseFecha(valores.vencimiento)
      if (vencimiento === undefined) return { ok: false, motivo: 'El vencimiento no se entiende (usa dd/mm/aaaa).' }

      // Etiqueta y clasificación: el gasto la deriva de su categoría; el cobro
      // lleva concepto libre (misma regla que el alta manual, mismo núcleo).
      let descripcion: string
      let categoria_id: string | null = null
      let categoria_nombre: string | null = null

      if (esGasto) {
        const cat = (valores.categoria ?? '').trim()
        if (!cat) return { ok: false, motivo: 'Falta la categoría del gasto.' }
        const raizId = await idCategoriaGasto(cat, null, ctx)
        if (!raizId) return { ok: false, motivo: `No hay una única categoría activa llamada "${cat}": créala, o desduplícala si hay varias con ese nombre.` }

        categoria_id = raizId
        const sub = (valores.subcategoria ?? '').trim()
        if (sub) {
          const subId = await idCategoriaGasto(sub, raizId, ctx)
          if (!subId) return { ok: false, motivo: `No hay una única subcategoría "${sub}" dentro de "${cat}".` }
          categoria_id = subId
        }
        const etq = await etiquetaDeCategoria(ctx.db, ctx.client_id, categoria_id)
        if (!etq) return { ok: false, motivo: 'Categoría no válida o inactiva.' }
        categoria_nombre = etq.nombre
        descripcion      = etq.descripcion
      } else {
        descripcion = (valores.concepto ?? '').trim()
        if (!descripcion) return { ok: false, motivo: 'Falta el concepto del cobro.' }
      }

      let tercero_id: string | null = null
      const tercero = (valores.tercero ?? '').trim()
      if (tercero) {
        tercero_id = await idTercero(tercero, empresa_id, ctx)
        if (!tercero_id) return { ok: false, motivo: `No existe "${tercero}" como tercero de esa empresa.` }
      }

      // Cuánto está ya saldado: el importe parcial manda sobre el Sí/No.
      const marcado = parseBooleano(valores.pagado)
      if (marcado === undefined) return { ok: false, motivo: `"${verbo}" debe ser Sí o No.` }
      const parcial = parseNumero(valores.monto_pagado)
      if (parcial === undefined) return { ok: false, motivo: 'El importe saldado no es un número.' }
      const pagado = parcial != null ? parcial : (marcado ? monto : 0)
      if (pagado < 0)            return { ok: false, motivo: 'El importe saldado no puede ser negativo.' }
      if (pagado > monto + EPS)  return { ok: false, motivo: 'El importe saldado supera al importe del registro.' }

      const registro = {
        empresa_id,
        tipo,
        fecha,
        // Lo pendiente sin vencimiento se vence el mismo día del registro: es deuda
        // vieja, y dejarla sin fecha la esconde del aging de CxC/CxP.
        vencimiento: vencimiento ?? (pagado < monto - EPS ? fecha : null),
        tercero_id,
        categoria:   categoria_nombre,
        categoria_id,
        descripcion,
        moneda,
        monto,
        notas:       (valores.notas ?? '').trim() || null,
      }
      const datos: DatosGasto = { registro, pagado, categoria_nombre }
      return {
        ok: true,
        datos: datos as unknown as Record<string, unknown>,
        clave: `${empresa_id}|${tipo}|${fecha}|${moneda}|${monto.toFixed(2)}|${norm(descripcion)}`,
      }
    },

    /** Mismo registro = misma empresa, fecha, importe, moneda y etiqueta. */
    async buscarExistente(datos, ctx) {
      const { registro } = datos as unknown as DatosGasto
      const { data } = await ctx.db.from('gastos_cobros').select('registro_id')
        .eq('client_id', ctx.client_id)
        .eq('empresa_id', registro.empresa_id as string)
        .eq('tipo', tipo)
        .eq('fecha', registro.fecha as string)
        .eq('moneda', registro.moneda as string)
        .eq('monto', registro.monto as number)
        .eq('descripcion', registro.descripcion as string)
        .limit(1).maybeSingle()
      return (data?.registro_id as string) ?? null
    },

    async insertar(datos, ctx) {
      const d = datos as unknown as DatosGasto
      const registro_id = generarRegistroId(tipo)
      const { error } = await ctx.db.from('gastos_cobros').insert({
        registro_id,
        client_id:   ctx.client_id,
        ...d.registro,
        origen_tipo: 'IMPORTACION',
        origen_id:   ctx.lote_id ?? null,
        updated_at:  new Date().toISOString(),
      })
      if (error) throw new Error(error.message)
      if (d.pagado > EPS) await saldar(ctx, registro_id, d, d.pagado)
      return registro_id
    },

    /**
     * El registro ya estaba: se completan los huecos (vencimiento, tercero,
     * notas) y se salda lo que falte. Nunca se vacía un dato ni se quita un
     * movimiento: en el ledger se corrige añadiendo, no borrando.
     */
    async actualizar(id, datos, ctx) {
      const d = datos as unknown as DatosGasto
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (d.registro.vencimiento) patch.vencimiento = d.registro.vencimiento
      if (d.registro.tercero_id)  patch.tercero_id  = d.registro.tercero_id
      if (d.registro.notas)       patch.notas       = d.registro.notas
      const { error } = await ctx.db.from('gastos_cobros').update(patch)
        .eq('registro_id', id).eq('client_id', ctx.client_id)
      if (error) throw new Error(error.message)

      if (d.pagado > EPS) {
        const { data: movs } = await ctx.db.from('movimientos_tesoreria')
          .select('monto, monto_ref').eq('client_id', ctx.client_id).eq('referencia_id', id)
        const ya = ((movs ?? []) as { monto: number; monto_ref: number | null }[])
          .reduce((s, m) => s + Number(m.monto_ref ?? m.monto), 0)
        const falta = Math.round((d.pagado - ya) * 100) / 100
        if (falta > EPS) await saldar(ctx, id, d, falta)
      }
    },

    /**
     * Se lleva el registro y las liquidaciones de «Apertura» que creó el propio
     * importador. Si mientras tanto se pagó de verdad desde una caja, no se toca:
     * ese movimiento es dinero real y no lo borra una importación.
     */
    async deshacer(pk, ctx) {
      const { data: movs } = await ctx.db.from('movimientos_tesoreria')
        .select('movimiento_id, cuenta_id').eq('client_id', ctx.client_id).eq('referencia_id', pk)
      const ids = ((movs ?? []) as { movimiento_id: string; cuenta_id: string }[])
      if (ids.length) {
        const { data: ctas } = await ctx.db.from('cuentas')
          .select('cuenta_id').eq('client_id', ctx.client_id).eq('es_apertura', true)
        const apertura = new Set(((ctas ?? []) as { cuenta_id: string }[]).map(c => c.cuenta_id))
        if (ids.some(m => !apertura.has(m.cuenta_id)))
          return 'Tiene pagos o cobros reales registrados: anúlalos antes de deshacer.'
        await ctx.db.from('movimientos_tesoreria').delete()
          .in('movimiento_id', ids.map(m => m.movimiento_id))
      }
      const { error } = await ctx.db.from('gastos_cobros').delete()
        .eq('registro_id', pk).eq('client_id', ctx.client_id)
      return error ? error.message : null
    },
  }

  /** Movimiento de liquidación contra la cuenta técnica de «Apertura». */
  async function saldar(ctx: CtxImport, registro_id: string, d: DatosGasto, importe: number): Promise<void> {
    const empresa_id = d.registro.empresa_id as string
    const moneda     = d.registro.moneda as string
    const cuenta_id  = await obtenerCuentaApertura(ctx.db, ctx.client_id, empresa_id, moneda)
    const { error } = await ctx.db.from('movimientos_tesoreria').insert({
      movimiento_id: generarMovimientoId(),
      client_id:     ctx.client_id,
      empresa_id,
      cuenta_id,
      fecha:         d.registro.fecha as string,   // el período del gasto, nunca hoy
      tipo:          esGasto ? 'EGRESO' : 'INGRESO',
      monto:         importe,
      moneda,
      monto_ref:     importe,                      // misma moneda: la apertura es por moneda
      concepto:      `${esGasto ? 'Pago' : 'Cobro'} · ${d.registro.descripcion as string}`,
      categoria:     d.categoria_nombre,
      categoria_id:  d.registro.categoria_id ?? null,
      origen:        esGasto ? 'PAGO' : 'COBRO',
      referencia_id: registro_id,
      notas:         `Saldado en la migración de datos (${ctx.lote_id ?? 'importación'}).`,
    })
    if (error) throw new Error(error.message)
  }
}

export const adaptadorGastos = crearAdaptadorGastoCobro('GASTO')
export const adaptadorCobros = crearAdaptadorGastoCobro('COBRO')
