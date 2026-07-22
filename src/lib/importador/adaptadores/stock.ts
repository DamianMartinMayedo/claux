// Adaptador de importación del STOCK INICIAL — las existencias a la fecha de
// corte. Es la primera entidad de Tier 2 y la primera que toca el LEDGER, así
// que cambian dos cosas respecto a los maestros:
//
//   · No se escribe en `stock_almacenes` ni en `products.stock_actual`: todo
//     entra por la RPC atómica `inv_aplicar_movimiento` (`aplicarMovimiento`),
//     que registra el movimiento y ajusta los dos contadores en una transacción.
//   · «Ya existe» no es un registro repetido, es que ESE producto YA TIENE stock
//     en ESE almacén. Por defecto se salta, que es lo que salva de la desgracia
//     típica del ledger: volver a subir el mismo archivo y duplicar existencias
//     (la idempotencia por lote solo cubre el reintento del MISMO lote).
//     Con ACTUALIZAR se hace un AJUSTE por la diferencia — que es exactamente lo
//     que es un conteo físico —, y con «Crear otro» se suma otra entrada.
//
// Requiere productos y almacenes ya creados: aquí no se da de alta nada.

import { aplicarMovimiento, stockEnAlmacen } from '@/app/actions/portal/_inventario-helpers'
import { memo, norm, parseFecha, parseNumero } from '../util'
import type { Adaptador, CtxImport, Preparado } from '../tipos'

type DatosStock = {
  producto_id: string
  almacen_id:  string
  empresa_id:  string
  cantidad:    number
  costo_unitario: number | null
  fecha:       string
}

/** Producto por código visible, por su PRD-/SRV- o por nombre. */
async function buscarProducto(
  ref: string, ctx: CtxImport,
): Promise<{ producto_id: string; tipo: string } | null> {
  return memo(ctx, `prod|${norm(ref)}`, async () => {
    const cols = 'producto_id, tipo'
    const base = () => ctx.db.from('products').select(cols).eq('client_id', ctx.client_id)
    const porCodigo = await base().eq('codigo', ref.trim()).limit(1).maybeSingle()
    if (porCodigo.data) return porCodigo.data as { producto_id: string; tipo: string }
    const porId = await base().eq('producto_id', ref.trim().toUpperCase()).limit(1).maybeSingle()
    if (porId.data) return porId.data as { producto_id: string; tipo: string }
    const porNombre = await base().ilike('nombre', ref.trim()).limit(1).maybeSingle()
    return (porNombre.data as { producto_id: string; tipo: string }) ?? null
  })
}

/** Almacén por su ALM- (lo que manda el desplegable) o por nombre (el CSV). */
async function buscarAlmacen(
  ref: string, ctx: CtxImport,
): Promise<{ almacen_id: string; empresa_id: string } | null> {
  return memo(ctx, `alm|${norm(ref)}`, async () => {
    const cols = 'almacen_id, empresa_id'
    const base = () => ctx.db.from('almacenes').select(cols).eq('client_id', ctx.client_id)
    const porId = await base().eq('almacen_id', ref.trim().toUpperCase()).limit(1).maybeSingle()
    if (porId.data) return porId.data as { almacen_id: string; empresa_id: string }
    const porNombre = await base().ilike('nombre', ref.trim()).limit(1).maybeSingle()
    return (porNombre.data as { almacen_id: string; empresa_id: string }) ?? null
  })
}

/** numeric(18,3): redondea para que la resta de dos flotantes no invente decimales. */
function redondear(n: number): number {
  return Math.round(n * 1000) / 1000
}

export const adaptadorStockInicial: Adaptador = {
  entidad:   'stock_inicial',
  etiqueta:  'Stock inicial',
  // `inventario` a secas: mover existencias es justo lo que la pieza Servicios
  // no incluye (mismo criterio que `ajustarStock`).
  modulos:   ['inventario'],
  revalidar: '/portal/inventario',
  defaults: [
    {
      campo: 'almacen', etiqueta: 'Almacén', obligatorio: true,
      ayuda: 'Dónde entra lo que no traiga almacén en el archivo.',
      opciones: async ctx => {
        const { data } = await ctx.db.from('almacenes')
          .select('almacen_id, nombre, empresa_id').eq('client_id', ctx.client_id)
          .eq('activo', true).order('nombre')
        const emp = Object.fromEntries(ctx.empresas.map(e => [e.empresa_id, e.nombre]))
        return ((data ?? []) as { almacen_id: string; nombre: string; empresa_id: string }[])
          .map(a => ({
            valor:    a.almacen_id,
            etiqueta: ctx.empresas.length > 1 ? `${a.nombre} · ${emp[a.empresa_id] ?? ''}` : a.nombre,
          }))
      },
    },
    {
      campo: 'fecha', etiqueta: 'Fecha de corte', obligatorio: true, tipo: 'fecha',
      ayuda: 'Las existencias entran con esta fecha. Lo que pase DESPUÉS ya se registra normal.',
    },
  ],
  campos: [
    { campo: 'producto',       etiqueta: 'Producto',       obligatorio: true,  alias: ['producto', 'articulo', 'artículo', 'codigo', 'código', 'sku', 'referencia', 'nombre'], ayuda: 'Por código o por nombre. Tiene que existir ya en el catálogo.', ejemplo: 'CAF-500' },
    { campo: 'cantidad',       etiqueta: 'Cantidad',       obligatorio: true,  alias: ['cantidad', 'existencia', 'existencias', 'stock', 'unidades', 'cant'], ejemplo: '24' },
    { campo: 'almacen',        etiqueta: 'Almacén',        obligatorio: false, alias: ['almacen', 'almacén', 'deposito', 'depósito', 'bodega', 'ubicacion', 'ubicación'], ayuda: 'Por nombre. Si falta, se usa el almacén de arriba.', ejemplo: 'Almacén principal' },
    { campo: 'costo_unitario', etiqueta: 'Costo unitario', obligatorio: false, alias: ['costo', 'coste', 'costo unitario', 'precio compra', 'valor'], ayuda: 'Opcional: valora la entrada en el libro de movimientos.', ejemplo: '900' },
    { campo: 'fecha',          etiqueta: 'Fecha',          obligatorio: false, alias: ['fecha', 'fecha corte', 'fecha inventario'], ejemplo: '31/12/2025' },
  ],

  async preparar(valores, ctx): Promise<Preparado> {
    const refProducto = (valores.producto ?? '').trim()
    if (!refProducto) return { ok: false, motivo: 'Falta el producto.' }
    const producto = await buscarProducto(refProducto, ctx)
    if (!producto) return { ok: false, motivo: `No existe el producto "${refProducto}". Impórtalo antes que el stock.` }
    if (producto.tipo === 'SERVICIO') return { ok: false, motivo: `"${refProducto}" es un servicio, y los servicios no tienen stock.` }

    const refAlmacen = (valores.almacen ?? '').trim()
    if (!refAlmacen) return { ok: false, motivo: 'Falta el almacén.' }
    const almacen = await buscarAlmacen(refAlmacen, ctx)
    if (!almacen) return { ok: false, motivo: `No existe el almacén "${refAlmacen}".` }

    const cantidad = parseNumero(valores.cantidad)
    if (cantidad === undefined) return { ok: false, motivo: 'La cantidad no es un número.' }
    if (cantidad == null || cantidad <= 0) return { ok: false, motivo: 'La cantidad debe ser mayor que cero.' }

    const costo = parseNumero(valores.costo_unitario)
    if (costo === undefined) return { ok: false, motivo: 'El costo unitario no es un número.' }
    if (costo != null && costo < 0) return { ok: false, motivo: 'El costo unitario no puede ser negativo.' }

    const fecha = parseFecha(valores.fecha)
    if (fecha === undefined) return { ok: false, motivo: 'La fecha no se entiende (usa dd/mm/aaaa).' }
    if (!fecha) return { ok: false, motivo: 'Falta la fecha de corte del inventario.' }

    const datos: DatosStock = {
      producto_id: producto.producto_id,
      almacen_id:  almacen.almacen_id,
      empresa_id:  almacen.empresa_id,   // la empresa la pone el almacén, no el operador
      cantidad:    redondear(cantidad),
      costo_unitario: costo,
      fecha,
    }
    return { ok: true, datos, clave: `${datos.producto_id}|${datos.almacen_id}` }
  },

  resumen: filas => [{
    etiqueta: 'Unidades a cargar',
    valor:    filas.reduce((s, f) => s + (f as unknown as DatosStock).cantidad, 0),
  }],

  /** Devuelve la pareja producto+almacén si YA tiene existencias (0 no cuenta). */
  async buscarExistente(datos, ctx) {
    const d = datos as DatosStock
    const actual = await stockEnAlmacen(ctx.db, d.producto_id, d.almacen_id)
    return actual !== 0 ? `${d.producto_id}|${d.almacen_id}` : null
  },

  async insertar(datos, ctx) {
    const d = datos as DatosStock
    const r = await aplicarMovimiento(ctx.db, {
      client_id:      ctx.client_id,
      empresa_id:     d.empresa_id,
      fecha:          d.fecha,
      tipo:           'ENTRADA',
      producto_id:    d.producto_id,
      almacen_id:     d.almacen_id,
      cantidad:       d.cantidad,
      costo_unitario: d.costo_unitario,
      motivo:         `Stock inicial (importación ${ctx.lote_id ?? ''})`.trim(),
      origen:         'MANUAL',
      referencia_id:  ctx.lote_id ?? null,
    })
    return r.movimiento_id
  },

  /**
   * El producto ya tenía existencias: se AJUSTA por la diferencia hasta la
   * cantidad del archivo (un conteo físico), nunca se suma otra entrada entera.
   * En el ledger no se corrige borrando: se corrige con otro movimiento.
   */
  async actualizar(_id, datos, ctx) {
    const d = datos as DatosStock
    const actual = await stockEnAlmacen(ctx.db, d.producto_id, d.almacen_id)
    const delta  = redondear(d.cantidad - actual)
    if (delta === 0) return   // ya cuadra con el archivo
    await aplicarMovimiento(ctx.db, {
      client_id:      ctx.client_id,
      empresa_id:     d.empresa_id,
      fecha:          d.fecha,
      tipo:           'AJUSTE',
      producto_id:    d.producto_id,
      almacen_id:     d.almacen_id,
      cantidad:       delta,                                    // con signo
      costo_unitario: delta > 0 ? d.costo_unitario : null,
      motivo:         `Ajuste a stock inicial (importación ${ctx.lote_id ?? ''})`.trim(),
      origen:         'MANUAL',
      referencia_id:  ctx.lote_id ?? null,
    })
  },

  /**
   * En el ledger no se borra: la entrada se compensa con una SALIDA de la misma
   * cantidad, en la misma fecha. Si esas existencias ya se vendieron o movieron,
   * la RPC devuelve STOCK_NEGATIVO y la fila se queda como está —que es la
   * respuesta correcta: ese stock ya no está para devolverlo.
   */
  async deshacer(pk, ctx) {
    const { data: mov } = await ctx.db.from('movimientos_inventario')
      .select('empresa_id, fecha, tipo, producto_id, almacen_id, cantidad')
      .eq('movimiento_id', pk).eq('client_id', ctx.client_id).maybeSingle()
    if (!mov) return 'No se encuentra el movimiento original.'
    if (mov.tipo !== 'ENTRADA') return 'El movimiento original no es una entrada.'
    try {
      await aplicarMovimiento(ctx.db, {
        client_id:   ctx.client_id,
        empresa_id:  mov.empresa_id as string,
        fecha:       mov.fecha as string,
        tipo:        'SALIDA',
        producto_id: mov.producto_id as string,
        almacen_id:  mov.almacen_id as string,
        cantidad:    Number(mov.cantidad),
        motivo:      `Reverso de stock inicial (importación ${ctx.lote_id ?? ''})`.trim(),
        origen:      'MANUAL',
        referencia_id: ctx.lote_id ?? null,
      })
    } catch (e) {
      return (e as Error).message
    }
    return null
  },
}
