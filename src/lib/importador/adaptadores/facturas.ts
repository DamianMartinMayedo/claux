// Adaptador del histórico de FACTURAS DE VENTA. Es la puerta que faltaba para
// migrar las ventas de un cliente: hasta ahora el histórico de ingresos solo
// entraba como «Cobros» (`gastos_cobros` tipo COBRO), que caen en el renglón
// «cobros directos» del estado de resultados —no en «Ventas»— y sin cliente ni
// número de documento. Aquí entran como facturas de verdad, con su número
// original, su cliente y su CxC.
//
// Tres decisiones que lo definen:
//
//   · **Se conserva el número del sistema de origen** (`F2025000003`) como
//     `facturas.numero`. Es la clave natural del archivo y la de la base (índice
//     único `(client_id, numero)`), así que reimportar el mismo fichero reconoce
//     lo ya escrito en vez de duplicar la serie entera.
//   · **La factura se escribe ya EMITIDA**, sin pasar por `cambiarEstadoFactura`.
//     Esa acción arrastra efectos que un histórico NO puede tener: CxP automática
//     a proveedores de servicios (`srv_cxp_generar`), movimiento de stock y
//     suscripciones. Se replica solo la asignación de estado y número; el resto
//     —líneas, ajustes, totales, foto de costes— sale del mismo núcleo que el
//     alta manual (`lib/ventas/factura-core.ts`).
//   · **Lo cobrado se salda contra la cuenta técnica de «Apertura»**
//     (`lib/tesoreria-core.ts`, mig. 130), fechado en la emisión y NUNCA hoy: el
//     saldo de la factura se DERIVA de los movimientos que la referencian, así
//     que sin ese apunte una factura ya cobrada en 2025 aparecería en CxC para
//     siempre; y sacándolo de una caja real falsearía el efectivo de hoy.
//
// v1 = una fila del archivo, una factura, una línea. El desglose multi-línea
// (varias filas con el mismo número) es fase 2.

import { calcularTotales, type LineaInput } from '@/app/portal/(app)/ventas/_ventas-helpers'
import { escribirLineasYAjustes, generarIdDocumento } from '@/lib/ventas/factura-core'
import { generarMovimientoId, obtenerCuentaApertura } from '@/lib/tesoreria-core'
import { validarCondicion } from '@/lib/terceros-core'
import { norm, parseFecha, parseNumero, totalesPor } from '../util'
import { defEmpresa, defMoneda, defTerceroFaltante } from './comunes'
import { buscarProductoDeFila } from './stock'
import { crearTerceroImportado, resolverTerceroDeFila } from './terceros'
import type { Adaptador, CampoDef, CtxImport, Preparado } from '../tipos'

const EPS = 0.005

/**
 * Un código de ficha suelto: dos a seis MAYÚSCULAS y dígitos («CLI0042»,
 * «CLI-0042», «PROV 118»). En minúsculas no entra a propósito, para que un
 * nombre real como «Grupo 24» no se confunda con un código.
 */
const CODIGO_SUELTO = /^[A-ZÁÉÍÓÚÑ]{2,6}[-_ ]?\d{2,}$/

/**
 * El nombre del cliente tal y como sale del sistema anterior. Muchas
 * exportaciones meten el CÓDIGO y el nombre en la MISMA celda, en dos líneas
 * («CLI0042 ⏎ Comercial Ejemplo S.A.»), y ahí el código es ruido: sin quitarlo,
 * «cli0042 comercial ejemplo sa» no se parece a la ficha «Comercial Ejemplo
 * S.A.» que el cliente ya tiene, y la migración crea una ficha nueva por cada
 * cliente —justo lo que hay que evitar cuando se sube una cartera entera—.
 *
 * Si TODAS las líneas son códigos, se quedan: un cliente identificado solo por
 * su código es mejor ficha que una fila rechazada.
 */
function nombreDeCliente(celda: string): string {
  const lineas = celda.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean)
  const utiles = lineas.filter(l => !CODIGO_SUELTO.test(l))
  return (utiles.length ? utiles : lineas).join(' ')
}

/**
 * Estados que puede traer el archivo. BORRADOR queda fuera a propósito: un
 * borrador no lleva número fiscal (`numeroProvisional`), y lo que se migra aquí
 * son documentos ya emitidos. COBRADA es cosmética —el saldo real siempre se
 * deriva de los movimientos—, pero se admite porque es como lo dicen los
 * exports: escrita sin columna de importe cobrado, significa cobrada entera.
 */
const ESTADOS = ['EMITIDA', 'COBRADA', 'ANULADA']

type DatosFactura = {
  /** Fila de `facturas` lista para escribir, salvo `cliente_id` si hay que crearlo. */
  registro:      Record<string, unknown>
  lineas:        LineaInput[]
  /** Cuánto se salda contra «Apertura» al escribir. */
  cobrado:       number
  /** Nombre de la ficha de cliente que hay que dar de alta (política CREAR). */
  cliente_nuevo: string | null
}

const CAMPOS: CampoDef[] = [
  { campo: 'numero',         etiqueta: 'Nº de factura',   obligatorio: true,  alias: ['numero', 'número', 'factura', 'nº factura', 'no factura', 'nro factura', 'numero factura', 'número factura', 'documento'], ayuda: 'El del sistema anterior. Se conserva tal cual.', ejemplo: 'F2025000003' },
  { campo: 'cliente',        etiqueta: 'Cliente',         obligatorio: true,  alias: ['cliente', 'tercero', 'nombre cliente', 'razon social', 'razón social'], ayuda: 'Por nombre. Si la celda trae también el código del sistema anterior, se ignora.', ejemplo: 'Comercial Ejemplo S.A.' },
  { campo: 'fecha',          etiqueta: 'Fecha',           obligatorio: true,  alias: ['fecha', 'fecha de registro', 'fecha registro', 'fecha emision', 'fecha emisión', 'fecha factura'], ejemplo: '14/03/2025' },
  { campo: 'importe',        etiqueta: 'Importe',         obligatorio: true,  alias: ['importe', 'total', 'monto', 'valor'], ayuda: 'El total de la factura, impuestos incluidos.', ejemplo: '12500' },
  { campo: 'cobrado',        etiqueta: 'Cobrado',         obligatorio: false, alias: ['cobrado', 'liquidado', 'pagado', 'importe cobrado'], ayuda: 'Lo que el cliente ya pagó. El resto queda en CxC.', ejemplo: '12500' },
  { campo: 'pendiente',      etiqueta: 'Pendiente',       obligatorio: false, alias: ['pendiente', 'saldo', 'por cobrar', 'importe pendiente', 'deuda'], ayuda: 'El otro lado de la resta. Sirve tal cual si el archivo no trae lo cobrado.', ejemplo: '' },
  { campo: 'moneda',         etiqueta: 'Moneda',          obligatorio: false, alias: ['moneda', 'divisa'], ejemplo: 'CUP' },
  { campo: 'vencimiento',    etiqueta: 'Vencimiento',     obligatorio: false, alias: ['vencimiento', 'vence', 'fecha vencimiento'], ayuda: 'Solo para lo pendiente. Si falta, se usa la fecha de la factura.', ejemplo: '' },
  { campo: 'estado',         etiqueta: 'Estado',          obligatorio: false, alias: ['estado', 'situacion', 'situación'], ayuda: `${ESTADOS.join(', ')}. Por defecto, Emitida.`, ejemplo: '' },
  { campo: 'condicion_pago', etiqueta: 'Condición de pago', obligatorio: false, alias: ['condicion', 'condición', 'condicion de pago', 'condición de pago', 'forma de pago'], ayuda: 'CONTADO, 15, 30, 60 o 90.', ejemplo: '' },
  { campo: 'concepto',       etiqueta: 'Concepto',        obligatorio: false, alias: ['concepto', 'descripcion', 'descripción', 'detalle'], ayuda: 'Lo que se vendió. Si falta, la línea se rotula con el número de la factura.', ejemplo: '' },
  { campo: 'producto',       etiqueta: 'Artículo',        obligatorio: false, alias: ['producto', 'articulo', 'artículo', 'codigo', 'código', 'sku'], ayuda: 'Por código o por nombre, para enlazar la línea con el catálogo.', ejemplo: '' },
  { campo: 'cantidad',       etiqueta: 'Cantidad',        obligatorio: false, alias: ['cantidad', 'unidades', 'cant'], ejemplo: '' },
  { campo: 'precio_unitario', etiqueta: 'Precio unitario', obligatorio: false, alias: ['precio', 'precio unitario', 'precio unit'], ayuda: 'Con él, la línea sale detallada y su total tiene que cuadrar con el importe.', ejemplo: '' },
  { campo: 'descuento_pct',  etiqueta: 'Descuento (%)',   obligatorio: false, alias: ['descuento', 'descuento %', 'descuento pct', 'dto'], ejemplo: '' },
  { campo: 'notas',          etiqueta: 'Notas',           obligatorio: false, alias: ['notas', 'observaciones', 'comentarios'], ejemplo: 'Fila de ejemplo: puedes dejarla, no se importa' },
  { campo: 'notas_internas', etiqueta: 'Notas internas',  obligatorio: false, alias: ['notas internas', 'observaciones internas'], ejemplo: '' },
]

export const adaptadorFacturas: Adaptador = {
  entidad:   'facturas',
  etiqueta:  'Facturas de venta',
  modulos:   ['base'],
  // El número es clave natural única: dos filas con el mismo número son un error
  // del archivo, no dos ventas distintas (a diferencia de gastos y cobros).
  repetible: false,
  // Todavía no se le pone delante al cliente: el histórico de ventas lo sube el
  // equipo bajo impersonación, que es donde se puede revisar antes de escribir.
  soloEquipo: true,
  revalidar: '/portal/ventas',
  defaults: [
    defEmpresa,
    defMoneda('moneda', true, 'La de las filas que no traigan moneda propia.'),
    // Sin «dejar vacío»: `facturas.cliente_id` es NOT NULL, así que la política
    // real es crear la ficha o rechazar la fila.
    defTerceroFaltante('cliente'),
  ],
  campos: CAMPOS,

  // Totales por moneda: si un «1.500» se hubiera leído como 1,5, el total lo
  // canta antes de escribir nada en los libros.
  resumen: filas => {
    const d = (f: Record<string, unknown>) => f as unknown as DatosFactura
    const nuevos = new Set(filas.map(f => d(f).cliente_nuevo).filter(Boolean))
    return [
      ...totalesPor(filas, f => d(f).registro.moneda as string, f => d(f).registro.total as number,
        m => `Total facturado ${m}`),
      ...totalesPor(filas.filter(f => d(f).cobrado > EPS),
        f => d(f).registro.moneda as string, f => d(f).cobrado, m => `Ya cobrado ${m}`),
      { etiqueta: 'Facturas', valor: filas.length, entero: true },
      ...(nuevos.size > 0 ? [{ etiqueta: 'Clientes nuevos', valor: nuevos.size, entero: true }] : []),
    ]
  },

  async preparar(valores, ctx): Promise<Preparado> {
    const numero = (valores.numero ?? '').trim()
    if (!numero) return { ok: false, motivo: 'Falta el número de la factura.' }

    const empresa_id = (valores.empresa_id ?? '').trim()
    if (!empresa_id || !ctx.empresas.some(e => e.empresa_id === empresa_id))
      return { ok: false, motivo: 'Empresa no válida o no indicada.' }

    const moneda = (valores.moneda ?? '').trim().toUpperCase()
    if (!moneda) return { ok: false, motivo: 'Falta la moneda.' }
    if (!ctx.monedas.includes(moneda))
      return { ok: false, motivo: `La moneda "${moneda}" no está configurada en Monedas y Tasas.` }

    const importe = parseNumero(valores.importe)
    if (importe === undefined)         return { ok: false, motivo: 'El importe no es un número.' }
    if (importe == null || importe <= 0) return { ok: false, motivo: 'El importe debe ser mayor que cero.' }

    const fecha = parseFecha(valores.fecha)
    if (fecha === undefined) return { ok: false, motivo: 'La fecha no se entiende (usa dd/mm/aaaa).' }
    if (!fecha)              return { ok: false, motivo: 'Falta la fecha de la factura.' }

    const vencimiento = parseFecha(valores.vencimiento)
    if (vencimiento === undefined) return { ok: false, motivo: 'El vencimiento no se entiende (usa dd/mm/aaaa).' }

    const estadoPedido = (valores.estado ?? '').trim().toUpperCase()
    if (estadoPedido && !ESTADOS.includes(estadoPedido))
      return { ok: false, motivo: `Estado no válido: usa ${ESTADOS.join(', ')}.` }

    // ── La línea ────────────────────────────────────────────────────────────
    // Sin detalle (el caso de una migración normal), la factura entra con UNA
    // línea resumen por su importe. Con precio unitario, la línea sale detallada
    // y su total tiene que cuadrar con el importe declarado: elegir uno de los
    // dos en silencio es meter un número inventado en los libros.
    const cantidadCol = parseNumero(valores.cantidad)
    if (cantidadCol === undefined) return { ok: false, motivo: 'La cantidad no es un número.' }
    if (cantidadCol != null && cantidadCol <= 0) return { ok: false, motivo: 'La cantidad debe ser mayor que cero.' }

    const precioCol = parseNumero(valores.precio_unitario)
    if (precioCol === undefined) return { ok: false, motivo: 'El precio unitario no es un número.' }
    if (precioCol != null && precioCol < 0) return { ok: false, motivo: 'El precio unitario no puede ser negativo.' }

    const descuentoCol = parseNumero(valores.descuento_pct)
    if (descuentoCol === undefined) return { ok: false, motivo: 'El descuento no es un número.' }
    if (descuentoCol != null && (descuentoCol < 0 || descuentoCol > 100))
      return { ok: false, motivo: 'El descuento tiene que ir entre 0 y 100.' }
    if (descuentoCol != null && descuentoCol > 0 && precioCol == null)
      return { ok: false, motivo: 'El descuento de la línea necesita el precio unitario.' }

    const concepto = (valores.concepto ?? '').trim()
    const notas    = (valores.notas ?? '').trim()

    // El artículo es OPCIONAL: una línea de texto libre no tiene catálogo detrás.
    // Por eso va `omitible`: el nombre que no se parece a nada deja la línea sin
    // vínculo en vez de tirar la factura entera.
    let producto_id: string | null = null
    let fallo: Extract<Preparado, { ok: false }> | null = null
    const refProducto = (valores.producto ?? '').trim()
    if (refProducto) {
      const rp = await buscarProductoDeFila(refProducto, ctx, true)
      if (!rp.ok) fallo = rp
      else producto_id = rp.ficha?.producto_id ?? null
    }

    // El cliente se resuelve AUNQUE el artículo haya fallado: devolver al primer
    // tropiezo obligaría a revalidar el archivo entero una vez por tipo de
    // nombre, y cada pasada es una consulta por fila.
    const nombreCliente = nombreDeCliente(valores.cliente ?? '')
    if (!nombreCliente) return { ok: false, motivo: 'Falta el cliente.' }
    let cliente_id:    string | null = null
    let cliente_nuevo: string | null = null
    const rc = await resolverTerceroDeFila(nombreCliente, empresa_id, 'cliente', valores, ctx)
    if (!rc.ok) fallo ??= rc
    else {
      cliente_id    = rc.tercero.tercero_id
      cliente_nuevo = rc.tercero.crear
      // `facturas.cliente_id` es NOT NULL: aquí no hay «dejarlo vacío».
      if (!cliente_id && !cliente_nuevo)
        fallo ??= { ok: false, motivo: `El cliente "${nombreCliente}" es obligatorio: no se puede dejar en blanco.` }
    }
    if (fallo) return fallo

    const linea: LineaInput = precioCol != null
      ? {
          producto_id,
          descripcion:     concepto || notas || `Venta según factura ${numero}`,
          cantidad:        cantidadCol ?? 1,
          precio_unitario: precioCol,
          descuento_pct:   descuentoCol ?? 0,
        }
      : {
          producto_id,
          descripcion:     concepto || notas || `Venta según factura ${numero}`,
          cantidad:        cantidadCol ?? 1,
          // Sin precio en el archivo, el importe ES la línea (repartido si la
          // fila declara cantidad).
          precio_unitario: importe / (cantidadCol ?? 1),
          descuento_pct:   0,
        }

    const totales = calcularTotales([linea], [])
    if (precioCol != null && Math.abs(totales.total - importe) > 0.01) {
      return {
        ok: false,
        motivo: `La línea suma ${totales.total.toFixed(2)} y el importe dice ${importe.toFixed(2)}: corrige uno de los dos.`,
      }
    }
    const total = totales.total

    // ── Lo cobrado ──────────────────────────────────────────────────────────
    // El export típico trae las DOS caras de la misma resta (cobrado y
    // pendiente). Vale cualquiera de ellas, y con las dos se comprueban entre
    // ellas: es lo que caza una columna mal mapeada antes de escribir el
    // histórico entero, no después.
    const cobradoCol   = parseNumero(valores.cobrado)
    const pendienteCol = parseNumero(valores.pendiente)
    if (cobradoCol   === undefined) return { ok: false, motivo: 'El importe cobrado no es un número.' }
    if (pendienteCol === undefined) return { ok: false, motivo: 'El importe pendiente no es un número.' }
    if (pendienteCol != null && pendienteCol < 0)
      return { ok: false, motivo: 'El importe pendiente no puede ser negativo.' }
    if (cobradoCol != null && pendienteCol != null
        && Math.abs(total - cobradoCol - pendienteCol) > 0.01) {
      return {
        ok: false,
        motivo: `El importe (${total.toFixed(2)}) no cuadra con lo cobrado (${cobradoCol.toFixed(2)}) más lo pendiente (${pendienteCol.toFixed(2)}).`,
      }
    }

    // «Cobrada» sin columna de importe cobrado quiere decir cobrada entera.
    let cobrado = cobradoCol
      ?? (pendienteCol != null ? total - pendienteCol
        : estadoPedido === 'COBRADA' ? total : 0)
    if (cobrado < 0)           return { ok: false, motivo: 'El importe cobrado no puede ser negativo.' }
    if (cobrado > total + EPS) return { ok: false, motivo: 'El importe cobrado supera al de la factura.' }
    cobrado = Math.min(cobrado, total)

    if (estadoPedido === 'ANULADA' && cobrado > EPS)
      return { ok: false, motivo: 'Una factura anulada no puede llevar importe cobrado.' }

    // COBRADA es cosmético —el saldo se deriva de los movimientos—, pero el
    // listado y CxC leen el estado, así que tiene que decir la verdad.
    const estado = estadoPedido === 'ANULADA' ? 'ANULADA'
      : cobrado >= total - EPS ? 'COBRADA' : 'EMITIDA'
    const pendiente = estado === 'EMITIDA' && cobrado < total - EPS

    const registro = {
      numero,
      empresa_id,
      cliente_id,
      fecha_emision: fecha,
      // Lo pendiente sin vencimiento vence el mismo día de la emisión: es deuda
      // vieja, y dejarla sin fecha la esconde del aging de CxC.
      fecha_vencimiento: vencimiento ?? (pendiente ? fecha : null),
      moneda,
      estado,
      condicion_pago: validarCondicion((valores.condicion_pago ?? '').trim().toUpperCase()),
      subtotal:       totales.subtotal,
      total,
      notas:          notas || null,
      notas_internas: (valores.notas_internas ?? '').trim() || null,
      // Un histórico no mueve existencias: lo vendido ya salió del almacén del
      // sistema anterior, y el stock inicial se importa a su fecha de corte.
      descuenta_stock: false,
      almacen_id:      null,
      emitida_at:      fecha,
    }

    const datos: DatosFactura = { registro, lineas: [linea], cobrado, cliente_nuevo }
    return {
      ok: true,
      datos: datos as unknown as Record<string, unknown>,
      // El número identifica la factura, y por eso es la clave: dos filas con el
      // mismo número son la misma factura escrita dos veces.
      clave: `${empresa_id}|${norm(numero)}`,
    }
  },

  /**
   * Misma factura = mismo número. Se compara solo por `(client_id, numero)`
   * porque es el índice único de la tabla: una factura con ese número en OTRA
   * empresa del cliente tampoco se podría escribir, así que encontrarla y
   * dejarla decidir a la política del lote es mejor que reventar al insertar.
   */
  async buscarExistente(datos, ctx) {
    const { registro } = datos as unknown as DatosFactura
    const { data } = await ctx.db.from('facturas').select('factura_id')
      .eq('client_id', ctx.client_id)
      .eq('numero', registro.numero as string)
      .limit(1).maybeSingle()
    return (data?.factura_id as string) ?? null
  },

  async insertar(datos, ctx) {
    const d = datos as unknown as DatosFactura
    const factura_id = generarIdDocumento('FAC')
    // Puro y con la misma entrada que en `preparar`: los totales de la cabecera
    // y los de las líneas salen del mismo cálculo.
    const totales = calcularTotales(d.lineas, [])

    const { error } = await ctx.db.from('facturas').insert({
      factura_id,
      client_id: ctx.client_id,
      ...d.registro,
      cliente_id: await resolverCliente(d, ctx),
      updated_at: new Date().toISOString(),
    })
    if (error) throw new Error(error.message)

    await escribirLineasYAjustes(
      ctx.db, 'FACTURA', factura_id, d.lineas, [], totales,
      ctx.client_id, d.registro.moneda as string,
    )
    if (d.cobrado > EPS) await saldar(ctx, factura_id, d, d.cobrado)

    // La serie fiscal sube hasta donde llegue el histórico, para que la primera
    // factura que el cliente emita desde CLAUX continúe su numeración en vez de
    // volver a la 1. El año es el de la emisión, que es con el que
    // `cambiarEstadoFactura` pedirá el siguiente correlativo; se lee del texto
    // de la fecha y no con `new Date`, que cortaría el 1 de enero.
    const correlativo = correlativoDeNumero(d.registro.numero as string)
    if (correlativo != null) {
      await sembrarConsecutivo(
        ctx, d.registro.empresa_id as string,
        Number((d.registro.fecha_emision as string).slice(0, 4)), correlativo,
      )
    }
    return factura_id
  },

  /**
   * La factura ya estaba: se completan los huecos (vencimiento, notas) y se
   * salda lo que falte. Ni las líneas ni los totales se reescriben —eso es una
   * factura distinta, no una corrección— y ningún dato se vacía: en el ledger se
   * corrige añadiendo.
   */
  async actualizar(id, datos, ctx) {
    const d = datos as unknown as DatosFactura
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (d.registro.fecha_vencimiento) patch.fecha_vencimiento = d.registro.fecha_vencimiento
    if (d.registro.notas)             patch.notas             = d.registro.notas
    if (d.registro.notas_internas)    patch.notas_internas    = d.registro.notas_internas
    const { error } = await ctx.db.from('facturas').update(patch)
      .eq('factura_id', id).eq('client_id', ctx.client_id)
    if (error) throw new Error(error.message)

    if (d.cobrado > EPS) {
      const { data: movs } = await ctx.db.from('movimientos_tesoreria')
        .select('monto, monto_ref').eq('client_id', ctx.client_id).eq('referencia_id', id)
      const ya = ((movs ?? []) as { monto: number; monto_ref: number | null }[])
        .reduce((s, m) => s + Number(m.monto_ref ?? m.monto), 0)
      // El techo lo pone la factura GUARDADA, no el archivo: aquí no se
      // reescriben los totales, así que un importe distinto en el archivo no
      // puede saldar de más la que ya está escrita.
      const { data: fac } = await ctx.db.from('facturas').select('total')
        .eq('factura_id', id).eq('client_id', ctx.client_id).maybeSingle()
      const total = Number(fac?.total ?? d.registro.total)
      const falta = Math.round((Math.min(d.cobrado, total) - ya) * 100) / 100
      if (falta > EPS) {
        await saldar(ctx, id, d, falta)
        // Al quedar saldada del todo, el estado persistido tiene que decirlo:
        // CxC y el listado de Ventas lo leen.
        if (ya + falta >= total - EPS) {
          await ctx.db.from('facturas')
            .update({ estado: 'COBRADA', updated_at: new Date().toISOString() })
            .eq('factura_id', id).eq('client_id', ctx.client_id).eq('estado', 'EMITIDA')
        }
      }
    }
  },

  /**
   * Se lleva la factura, sus líneas y las liquidaciones de «Apertura» que creó
   * el propio importador. Si mientras tanto se cobró de verdad desde una caja,
   * no se toca: ese movimiento es dinero real y no lo borra una importación.
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
        return 'Tiene cobros reales registrados: anúlalos antes de deshacer.'
      await ctx.db.from('movimientos_tesoreria').delete()
        .in('movimiento_id', ids.map(m => m.movimiento_id))
    }
    // Líneas y ajustes cuelgan del documento, no del cliente: la pareja
    // (tipo, id) es su única identidad.
    await ctx.db.from('documento_lineas').delete()
      .eq('documento_tipo', 'FACTURA').eq('documento_id', pk)
    await ctx.db.from('documento_ajustes').delete()
      .eq('documento_tipo', 'FACTURA').eq('documento_id', pk)

    const { error } = await ctx.db.from('facturas').delete()
      .eq('factura_id', pk).eq('client_id', ctx.client_id)
    return error ? error.message : null
  },
}

/**
 * El cliente con el que se escribe la factura: el que ya existía, o la ficha
 * mínima que se crea ahora si el operador eligió crearla. Se resuelve al
 * escribir y no en `preparar` porque validar no puede tocar la base de datos.
 */
async function resolverCliente(d: DatosFactura, ctx: CtxImport): Promise<string> {
  if (d.registro.cliente_id) return d.registro.cliente_id as string
  return crearTerceroImportado(
    d.cliente_nuevo as string, d.registro.empresa_id as string, 'CLIENTE', ctx,
  )
}

/**
 * El correlativo que lleva dentro un número de factura, sea del sistema anterior
 * o de CLAUX. Se toma la ÚLTIMA tirada de dígitos y se le quita el año pegado
 * delante, que es como lo escriben los dos formatos: `F2025000003` → 3,
 * `FA20260001` → 1, `F-2025-000003` → 3, `INV-00123` → 123.
 *
 * Sin quitar el año, el consecutivo saltaría a 2.025.000.003 y la siguiente
 * factura de CLAUX nacería con ese número: peor que no sembrar nada.
 */
function correlativoDeNumero(numero: string): number | null {
  const tiradas = numero.match(/\d+/g)
  if (!tiradas) return null
  let d = tiradas[tiradas.length - 1]
  if (d.length > 4 && /^(19|20)\d{2}/.test(d)) d = d.slice(4)
  const n = parseInt(d, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Sube la marca de la serie fiscal a la altura del histórico importado.
 *
 * Sin esto, la primera factura que el cliente emita desde CLAUX arranca en 1 —
 * `siguienteCorrelativo` lee `consecutivos_venta`, y ahí no hay nada— mientras
 * su histórico va por la 420. No revienta (los formatos no chocan: CLAUX escribe
 * `F{letra}{año}{4 dígitos}` y el sistema anterior `F{año}{6 dígitos}`), pero
 * parte la serie en dos, que es lo primero que pregunta una inspección.
 *
 * **Solo sube, nunca baja.** Es la propiedad que hace segura la importación
 * mensual: el archivo de cada mes vuelve a traer meses ya subidos, y también
 * puede llegar después de que el cliente haya emitido facturas propias más
 * altas. Bajar la marca reemitiría números ya usados. Por lo mismo, `deshacer`
 * NO la devuelve atrás: deshacer una importación es reversible, gastar dos veces
 * un número fiscal no.
 *
 * El alto de cada empresa+año se cachea durante la tanda, así que un archivo con
 * los números en orden hace UNA escritura por serie, no una por fila.
 */
async function sembrarConsecutivo(
  ctx: CtxImport, empresa_id: string, anio: number, correlativo: number,
): Promise<void> {
  const clave = `consec|${empresa_id}|${anio}`
  if (correlativo <= ((ctx.cache.get(clave) as number | undefined) ?? 0)) return
  ctx.cache.set(clave, correlativo)

  const { data } = await ctx.db.from('consecutivos_venta').select('ultimo_numero')
    .eq('client_id', ctx.client_id).eq('empresa_id', empresa_id)
    .eq('tipo', 'FACTURA').eq('anio', anio).maybeSingle()
  const ya = Number(data?.ultimo_numero ?? 0)
  if (correlativo <= ya) { ctx.cache.set(clave, ya); return }

  await ctx.db.from('consecutivos_venta').upsert({
    client_id: ctx.client_id, empresa_id, tipo: 'FACTURA', anio,
    ultimo_numero: correlativo, updated_at: new Date().toISOString(),
  }, { onConflict: 'client_id,empresa_id,tipo,anio' })
}

/** Movimiento de cobro contra la cuenta técnica de «Apertura». */
async function saldar(
  ctx: CtxImport, factura_id: string, d: DatosFactura, importe: number,
): Promise<void> {
  const empresa_id = d.registro.empresa_id as string
  const moneda     = d.registro.moneda as string
  const cuenta_id  = await obtenerCuentaApertura(ctx.db, ctx.client_id, empresa_id, moneda)
  const { error } = await ctx.db.from('movimientos_tesoreria').insert({
    movimiento_id: generarMovimientoId(),
    client_id:     ctx.client_id,
    empresa_id,
    cuenta_id,
    fecha:         d.registro.fecha_emision as string,   // el período de la venta, nunca hoy
    tipo:          'INGRESO',
    monto:         importe,
    moneda,
    // Misma moneda que la factura: la apertura es por moneda, así que el importe
    // aplicado al documento y el que mueve la cuenta son el mismo.
    monto_ref:     importe,
    concepto:      `Cobro · ${d.registro.numero as string}`,
    origen:        'COBRO',
    referencia_id: factura_id,
    notas:         `Saldado en la migración de datos (${ctx.lote_id ?? 'importación'}).`,
  })
  if (error) throw new Error(error.message)
}
