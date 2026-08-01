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

import { generarRegistroId, type TipoRegistro } from '@/lib/gastos-core'
import { generarMovimientoId, obtenerCuentaApertura } from '@/lib/tesoreria-core'
import { norm, parseBooleano, parseFecha, parseNumero, totalesPor } from '../util'
import {
  defCategoriaFaltante, defEmpresa, defMoneda, defRolNuevas, defTerceroFaltante,
} from './comunes'
import {
  aplicarPlanCategoria, nombresNuevos, resolverCategoriaGasto, type PlanCategoria,
} from './categorias'
import { crearTerceroImportado, resolverTerceroDeFila } from './terceros'
import type { Adaptador, CampoDef, CtxImport, DefaultDef, Preparado } from '../tipos'

const EPS = 0.005

type DatosGasto = {
  /** Fila de `gastos_cobros`. Sin `categoria_id`: ese se resuelve al escribir. */
  registro:  Record<string, unknown>
  pagado:    number                    // cuánto se liquida contra «Apertura»
  categoria_nombre: string | null
  /** Categoría (y subcategoría) ya decidida, pendiente de escribir. */
  plan_categoria: PlanCategoria | null
  /** Nombre del tercero que hay que dar de alta al escribir (política CREAR). */
  tercero_nuevo: string | null
}

/**
 * Categoría de las filas que no traigan ninguna. Solo se ofrecen las ACTIVAS de
 * primer nivel: es un valor que el operador elige a mano, y ahí no tiene sentido
 * proponer una archivada.
 */
const defCategoriaDefecto: DefaultDef = {
  campo:       'categoria',
  etiqueta:    'Categoría por defecto',
  obligatorio: false,
  ayuda:       'Para las filas que no traigan categoría en el archivo.',
  opciones:    async (ctx: CtxImport) => {
    const { data } = await ctx.db.from('categorias_gastos')
      .select('nombre').eq('client_id', ctx.client_id)
      .eq('estado', 'ACTIVO').is('parent_id', null).order('nombre')
    return ((data ?? []) as { nombre: string }[]).map(c => ({ valor: c.nombre, etiqueta: c.nombre }))
  },
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
    // Dos filas idénticas pueden ser dos hechos distintos: el mismo cliente paga
    // dos veces lo mismo el mismo día. Con «Crear otro» se importan las dos.
    repetible: true,
    modulos:   ['base'],
    revalidar: '/portal/gastos',
    defaults: [
      defEmpresa,
      defMoneda('moneda', true, 'La de las filas que no traigan moneda propia.'),
      ...(esGasto ? [defCategoriaDefecto, defCategoriaFaltante(), defRolNuevas] : []),
      defTerceroFaltante(esGasto ? 'proveedor' : 'cliente', true),
    ],
    campos: [...propios, ...CAMPOS_COMUNES, ...cobro],

    // Totales por moneda: si un «1.500» se hubiera leído como 1,5, el total lo
    // canta antes de escribir nada.
    resumen: filas => {
      const reg = (f: Record<string, unknown>) => (f as unknown as DatosGasto).registro
      const nuevos = filas.filter(f => (f as unknown as DatosGasto).tercero_nuevo).length
      // Categorías por NOMBRE, no por fila: el archivo repite la misma categoría
      // en cien filas y crea una sola.
      const cats = new Set(filas.flatMap(f => {
        const plan = (f as unknown as DatosGasto).plan_categoria
        return plan ? nombresNuevos(plan) : []
      }))
      return [
        ...totalesPor(filas, f => reg(f).moneda as string, f => reg(f).monto as number,
          m => `Total ${esGasto ? 'gastos' : 'cobros'} ${m}`),
        ...totalesPor(filas.filter(f => (f as unknown as DatosGasto).pagado > EPS),
          f => reg(f).moneda as string, f => (f as unknown as DatosGasto).pagado,
          m => `Ya ${verbo.toLowerCase()} ${m}`),
        // Que se vea ANTES de escribir cuántas fichas va a crear el archivo.
        ...(nuevos > 0
          ? [{ etiqueta: `Filas con un ${esGasto ? 'proveedor' : 'cliente'} nuevo`, valor: nuevos, entero: true }]
          : []),
        ...(cats.size > 0
          ? [{ etiqueta: 'Categorías que se crearán', valor: cats.size, entero: true }]
          : []),
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
      // lleva concepto libre (misma regla que el alta manual, mismo núcleo). La
      // categoría se DECIDE aquí y se escribe al insertar: validar no toca la
      // base de datos, y crear la que falta es una escritura.
      let descripcion = ''
      let plan_categoria: PlanCategoria | null = null
      let categoria_nombre: string | null = null
      // Si la categoría no cuadra, el tercero se resuelve IGUAL antes de rendirse:
      // devolver al primer tropiezo obligaría al operador a decidir las
      // categorías, revalidar el archivo entero y decidir los proveedores en otra
      // pasada. Cada pasada son N consultas y la conexión es la que es.
      let fallo: Extract<Preparado, { ok: false }> | null = null

      if (esGasto) {
        const cat = (valores.categoria ?? '').trim()
        if (!cat) return { ok: false, motivo: 'Falta la categoría del gasto.' }
        const rc = await resolverCategoriaGasto(cat, (valores.subcategoria ?? '').trim(), valores, ctx)
        if (!rc.ok) fallo = rc
        else {
          plan_categoria   = rc.plan
          categoria_nombre = rc.plan.nombre
          descripcion      = rc.plan.descripcion
        }
      } else {
        descripcion = (valores.concepto ?? '').trim()
        if (!descripcion) return { ok: false, motivo: 'Falta el concepto del cobro.' }
      }

      // El tercero que el archivo nombra y no tenemos: lo decide el operador en
      // el asistente. Crear la ficha se APUNTA aquí y se hace al escribir
      // (`insertar`), por lo mismo.
      let tercero_id:    string | null = null
      let tercero_nuevo: string | null = null
      let sinTercero:    string | null = null
      const tercero = (valores.tercero ?? '').trim()
      if (tercero) {
        const rt = await resolverTerceroDeFila(
          tercero, empresa_id, esGasto ? 'proveedor' : 'cliente', valores, ctx,
        )
        if (!rt.ok) fallo ??= rt
        else {
          tercero_id    = rt.tercero.tercero_id
          tercero_nuevo = rt.tercero.crear
          sinTercero    = rt.tercero.sin_ficha
        }
      }
      if (fallo) return fallo

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
        descripcion,
        // El «Concepto» de la plantilla (mig. 152). Hasta ahora, en un GASTO se PERDÍA:
        // la columna era obligatoria en el archivo, el operador la rellenaba, y la
        // etiqueta guardada era la de la categoría. Ahora tiene sitio propio y el
        // histórico importado llega con el texto que el cliente escribió.
        concepto:    (valores.concepto ?? '').trim() || descripcion,
        moneda,
        monto,
        // Si el operador eligió no crear la ficha, el nombre no se tira: queda
        // escrito en las notas, que es donde se puede recuperar después.
        notas: [(valores.notas ?? '').trim(), sinTercero && `${esGasto ? 'Proveedor' : 'Cliente'}: ${sinTercero}`]
          .filter(Boolean).join(' · ') || null,
      }
      const datos: DatosGasto = { registro, pagado, categoria_nombre, plan_categoria, tercero_nuevo }
      return {
        ok: true,
        datos: datos as unknown as Record<string, unknown>,
        // El TERCERO forma parte de la identidad de la fila, y no es un adorno: se
        // migra la cartera entera de golpe, así que la fecha, el importe y el
        // concepto COINCIDEN a propósito en decenas de filas («Cuota de julio»,
        // 500 CUP, mismo día) y lo único que las distingue es de quién es cada
        // una. Sin esto, 30 cobros de 30 clientes eran uno solo.
        //
        // Por `tercero_id` cuando la ficha ya existe, y por el nombre del archivo
        // cuando todavía no (el operador pidió crearla, o dejarla sin ficha): en
        // una migración lo NORMAL es que ninguna exista aún, así que quedarse solo
        // con el id dejaría todas esas filas con la misma clave vacía y no
        // arreglaría nada.
        //
        // Las NOTAS, en cambio, NO entran: son texto libre, no identidad. Que dos
        // facturas del mismo cliente, día e importe solo se distingan por un
        // «Factura No. 56» escrito ahí es precisamente lo que hay que AVISAR para
        // que el operador decida, no algo que el importador deba resolver solo
        // (§`motor.ts`, decisión de repetidas). La comprobación contra la BASE sí
        // las mira, y esa asimetría es a propósito: aquí se avisa, allí se
        // reconoce lo ya escrito.
        clave: [
          empresa_id, tipo, fecha, moneda, monto.toFixed(2), norm(descripcion),
          tercero_id ?? (tercero ? `nom:${norm(tercero)}` : 'sin'),
        ].join('|'),
      }
    },

    /**
     * Mismo registro = misma empresa, fecha, importe, moneda, etiqueta, TERCERO y
     * NOTAS. Las notas están aquí y NO en la clave del archivo a propósito: dos
     * filas que solo se diferencian en ellas se avisan para que el operador
     * decida, pero una vez escritas son dos registros distintos, y al reimportar
     * el archivo cada uno tiene que reconocer el suyo en vez de fundirse con el
     * otro (que es lo que haría la comparación gruesa).
     *
     * Con la ficha ya creada se compara por `tercero_id`; sin ella, el registro
     * que buscamos también se escribió sin tercero. Al repetir el mismo archivo la
     * comparación acierta igual: la ficha que creó la primera pasada ya existe, la
     * fila la encuentra y llega aquí con su id. Lo que sí crea dos registros es
     * cambiar de idea entre pasadas (primero «sin ficha», después «crearla»), y es
     * correcto: son dos decisiones distintas sobre quién es el tercero.
     */
    async buscarExistente(datos, ctx) {
      const { registro } = datos as unknown as DatosGasto
      const q = ctx.db.from('gastos_cobros').select('registro_id')
        .eq('client_id', ctx.client_id)
        .eq('empresa_id', registro.empresa_id as string)
        .eq('tipo', tipo)
        .eq('fecha', registro.fecha as string)
        .eq('moneda', registro.moneda as string)
        .eq('monto', registro.monto as number)
        .eq('descripcion', registro.descripcion as string)
      const tercero_id = registro.tercero_id as string | null
      const notas      = registro.notas as string | null
      const conTercero = tercero_id ? q.eq('tercero_id', tercero_id) : q.is('tercero_id', null)
      const { data } = await (notas ? conTercero.eq('notas', notas) : conTercero.is('notas', null))
        .limit(1).maybeSingle()
      return (data?.registro_id as string) ?? null
    },

    async insertar(datos, ctx) {
      const d = datos as unknown as DatosGasto
      const registro_id  = generarRegistroId(tipo)
      const categoria_id = await resolverCategoria(d, ctx)
      const { error } = await ctx.db.from('gastos_cobros').insert({
        registro_id,
        client_id:   ctx.client_id,
        ...d.registro,
        categoria_id,
        tercero_id:  await resolverTercero(d, ctx),
        origen_tipo: 'IMPORTACION',
        origen_id:   ctx.lote_id ?? null,
        updated_at:  new Date().toISOString(),
      })
      if (error) throw new Error(error.message)
      if (d.pagado > EPS) await saldar(ctx, registro_id, d, d.pagado, categoria_id)
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
      const tercero_id = await resolverTercero(d, ctx)
      if (d.registro.vencimiento) patch.vencimiento = d.registro.vencimiento
      if (tercero_id)             patch.tercero_id  = tercero_id
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
        if (falta > EPS) await saldar(ctx, id, d, falta, await resolverCategoria(d, ctx))
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

  /**
   * La categoría con la que se escribe la fila. Lo que el plan tuviera pendiente
   * —crear la categoría, crear la subcategoría, reactivar la archivada— se hace
   * aquí, al escribir, y no en `preparar`: validar no toca la base de datos.
   */
  async function resolverCategoria(d: DatosGasto, ctx: CtxImport): Promise<string | null> {
    return d.plan_categoria ? aplicarPlanCategoria(d.plan_categoria, ctx) : null
  }

  /**
   * El tercero con el que se escribe la fila: el que ya existía, o la ficha
   * mínima que se crea ahora si el operador eligió crearla. Se resuelve al
   * escribir y no en `preparar` porque validar no puede tocar la base de datos.
   */
  async function resolverTercero(d: DatosGasto, ctx: CtxImport): Promise<string | null> {
    if (d.registro.tercero_id) return d.registro.tercero_id as string
    if (!d.tercero_nuevo)      return null
    return crearTerceroImportado(
      d.tercero_nuevo, d.registro.empresa_id as string, esGasto ? 'PROVEEDOR' : 'CLIENTE', ctx,
    )
  }

  /** Movimiento de liquidación contra la cuenta técnica de «Apertura». */
  async function saldar(
    ctx: CtxImport, registro_id: string, d: DatosGasto, importe: number,
    categoria_id: string | null,
  ): Promise<void> {
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
      categoria_id,
      origen:        esGasto ? 'PAGO' : 'COBRO',
      referencia_id: registro_id,
      notas:         `Saldado en la migración de datos (${ctx.lote_id ?? 'importación'}).`,
    })
    if (error) throw new Error(error.message)
  }
}

export const adaptadorGastos = crearAdaptadorGastoCobro('GASTO')
export const adaptadorCobros = crearAdaptadorGastoCobro('COBRO')
