// Adaptador de importación del catálogo: PRODUCTOS (módulo Inventario) y
// SERVICIOS (módulo Servicios). Comparten tabla (`products`) y núcleo de
// escritura (`@/lib/productos-core`), así que comparten adaptador: cambia el
// `tipo`, el candado, la ruta y los campos propios de cada uno.
//
// El stock NO se importa aquí: las existencias iniciales entran por el ledger
// (`inv_aplicar_movimiento`) en su propia entidad. Aquí todo nace con stock 0.

import {
  construirCamposProducto, generarProductoId, siguienteCodigoProducto,
  type TipoProducto,
} from '@/lib/productos-core'
import { PERIODICIDADES as PERIODICIDADES_SUB } from '@/lib/suscripciones'
import { camposProvistos, memo, norm, parseNumero, parseBooleano, primeraDependencia } from '../util'
import { defCategoriaFaltante, defMoneda, defTerceroFaltante } from './comunes'
import { crearCategoriaProducto, resolverCategoriaProducto } from './categorias'
import { crearTerceroImportado, resolverTerceroDeFila } from './terceros'
import type { Adaptador, CampoDef, CtxImport, Preparado } from '../tipos'

/**
 * Los campos de `products` + el código visible (solo se usa al insertar) y lo que
 * está pendiente de crear (proveedor, categoría), que NO son columnas: los quita
 * quien escribe.
 */
type ProveedorNuevo = { nombre: string; empresa_id: string }

type DatosCatalogo = Record<string, unknown> & {
  codigo: string | null
  nombre: string
  proveedor_nuevo?: ProveedorNuevo | null
  categoria_nueva?: string | null
}

/**
 * Da de alta la ficha mínima del proveedor que la fila apuntó (política CREAR).
 * Se hace al escribir, no al validar: el dry-run no toca la base de datos.
 */
async function altaProveedor(nuevo: ProveedorNuevo | null | undefined, ctx: CtxImport): Promise<string | null> {
  if (!nuevo) return null
  return crearTerceroImportado(nuevo.nombre, nuevo.empresa_id, 'PROVEEDOR', ctx)
}

/** Ídem con la categoría del catálogo que la fila apuntó. */
async function altaCategoria(
  nueva: string | null | undefined, tipo: TipoProducto, ctx: CtxImport,
): Promise<string | null> {
  if (!nueva) return null
  return crearCategoriaProducto(nueva, tipo, ctx)
}

/** ¿Hay algún almacén? Mismo guard que el alta manual de un producto físico. */
async function hayAlmacenes(ctx: CtxImport): Promise<boolean> {
  return memo(ctx, 'almacenes', async () => {
    const { count } = await ctx.db.from('almacenes')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', ctx.client_id)
    return !!count
  })
}

const CAMPOS_COMUNES: CampoDef[] = [
  { campo: 'nombre',           etiqueta: 'Nombre',            obligatorio: true,  alias: ['nombre', 'producto', 'articulo', 'artículo', 'servicio', 'descripcion corta'], ejemplo: 'Café molido 500 g' },
  { campo: 'codigo',           etiqueta: 'Código',            obligatorio: false, alias: ['codigo', 'código', 'sku', 'referencia', 'ref', 'cod'], ayuda: 'El del cliente. Si se deja vacío, CLAUX genera el suyo.', ejemplo: 'CAF-500' },
  { campo: 'descripcion',      etiqueta: 'Descripción',       obligatorio: false, alias: ['descripcion', 'descripción', 'detalle'], ejemplo: 'Fila de ejemplo: puedes dejarla, no se importa' },
  { campo: 'categoria',        etiqueta: 'Categoría',         obligatorio: false, alias: ['categoria', 'categoría', 'familia', 'grupo', 'rubro'], ayuda: 'Por nombre. Debe existir ya en el catálogo de categorías.', ejemplo: 'Bebidas' },
  { campo: 'precio',           etiqueta: 'Precio de venta',   obligatorio: false, alias: ['precio', 'pvp', 'precio venta', 'venta', 'importe'], ejemplo: '1500' },
  { campo: 'costo',            etiqueta: 'Costo',             obligatorio: false, alias: ['costo', 'coste', 'precio compra', 'compra'], ejemplo: '900' },
  { campo: 'moneda',           etiqueta: 'Moneda del precio', obligatorio: false, alias: ['moneda', 'divisa'], ejemplo: 'CUP' },
  { campo: 'proveedor',        etiqueta: 'Proveedor',         obligatorio: false, alias: ['proveedor', 'suministrador'], ayuda: 'Por nombre. Debe existir ya como tercero.', ejemplo: 'Comercial Ejemplo S.A.' },
  { campo: 'codigo_proveedor', etiqueta: 'Código del proveedor', obligatorio: false, alias: ['codigo proveedor', 'código proveedor', 'ref proveedor'], ejemplo: 'PRV-CAF-500' },
]

const CAMPOS_PRODUCTO: CampoDef[] = [
  { campo: 'unidad',       etiqueta: 'Unidad',       obligatorio: true,  alias: ['unidad', 'ud', 'medida', 'um'], ayuda: 'u, kg, litro, caja…', ejemplo: 'u' },
  { campo: 'stock_minimo', etiqueta: 'Stock mínimo', obligatorio: false, alias: ['stock minimo', 'stock mínimo', 'minimo', 'mínimo'], ejemplo: '10' },
]

const CAMPOS_SERVICIO: CampoDef[] = [
  { campo: 'unidad',               etiqueta: 'Unidad',        obligatorio: false, alias: ['unidad', 'medida'], ayuda: 'Opcional: sesión, hora, mes…', ejemplo: 'mes' },
  { campo: 'es_suscribible',       etiqueta: 'Suscribible',   obligatorio: false, alias: ['suscribible', 'suscripcion', 'suscripción', 'recurrente'], ayuda: 'Sí / No. Habilita facturación recurrente.', ejemplo: 'Sí' },
  { campo: 'periodicidad_defecto', etiqueta: 'Periodicidad',  obligatorio: false, alias: ['periodicidad', 'frecuencia'], ayuda: `Si es suscribible: ${PERIODICIDADES_SUB.join(', ')}`, ejemplo: PERIODICIDADES_SUB[0] },
]

function crearAdaptadorCatalogo(tipo: TipoProducto): Adaptador {
  const esServicio = tipo === 'SERVICIO'
  return {
    entidad:   esServicio ? 'servicios' : 'productos',
    etiqueta:  esServicio ? 'Servicios' : 'Productos',
    modulos:   [esServicio ? 'servicios' : 'inventario'],
    revalidar: esServicio ? '/portal/servicios' : '/portal/productos',
    defaults: [
      defMoneda('moneda', true, 'Moneda de los precios y costos del archivo.'),
      ...(esServicio ? [] : [{
        campo: 'unidad', etiqueta: 'Unidad por defecto', obligatorio: true, valor: 'u',
        ayuda: 'Para las filas que no traigan unidad en el archivo.',
      }]),
      defTerceroFaltante('proveedor'),
      defCategoriaFaltante(),
      {
        // El catálogo no es por empresa, pero una ficha de tercero sí lo es:
        // esta empresa solo se usa si hay que crear el proveedor que falta.
        campo: 'empresa_id', etiqueta: 'Empresa de los proveedores nuevos', obligatorio: false,
        ayuda: 'Solo se usa si hay que crear la ficha de un proveedor que no exista todavía.',
        opciones: async (ctx: CtxImport) =>
          ctx.empresas.map(e => ({ valor: e.empresa_id, etiqueta: e.nombre })),
      },
      {
        campo: 'categoria', etiqueta: 'Categoría por defecto', obligatorio: false,
        ayuda: 'Para las filas sin categoría en el archivo.',
        opciones: async (ctx: CtxImport) => {
          const { data } = await ctx.db.from('product_categories')
            .select('nombre').eq('client_id', ctx.client_id)
            .in('tipo', [tipo, 'AMBAS']).eq('estado', 'ACTIVO').order('nombre')
          return ((data ?? []) as { nombre: string }[]).map(c => ({ valor: c.nombre, etiqueta: c.nombre }))
        },
      },
    ],
    campos: [...CAMPOS_COMUNES, ...(esServicio ? CAMPOS_SERVICIO : CAMPOS_PRODUCTO)],

    // El catálogo no mueve dinero, pero sí conviene ver antes de escribir
    // cuántas fichas de proveedor va a crear el archivo.
    resumen: filas => {
      const nuevos = filas.filter(f => (f as DatosCatalogo).proveedor_nuevo).length
      // Por NOMBRE, no por fila: cien productos de «Bebidas» crean una categoría.
      const cats = new Set(filas.map(f => (f as DatosCatalogo).categoria_nueva).filter(Boolean))
      return [
        ...(nuevos > 0 ? [{ etiqueta: 'Filas con un proveedor nuevo', valor: nuevos, entero: true }] : []),
        ...(cats.size > 0 ? [{ etiqueta: 'Categorías que se crearán', valor: cats.size, entero: true }] : []),
      ]
    },

    async preparar(valores, ctx, deColumna): Promise<Preparado> {
      const nombre = (valores.nombre ?? '').trim()
      if (!nombre) return { ok: false, motivo: 'Falta el nombre.' }

      // Un producto físico necesita dónde guardar existencias (igual que el alta manual).
      if (!esServicio && !(await hayAlmacenes(ctx)))
        return { ok: false, motivo: 'Crea un almacén antes de importar productos físicos.' }

      const unidad = (valores.unidad ?? '').trim()
      if (!esServicio && !unidad) return { ok: false, motivo: 'Falta la unidad.' }

      const precio = parseNumero(valores.precio)
      if (precio === undefined) return { ok: false, motivo: 'El precio no es un número.' }
      const costo = parseNumero(valores.costo)
      if (costo === undefined) return { ok: false, motivo: 'El costo no es un número.' }

      const moneda = (valores.moneda ?? '').trim().toUpperCase()
      if ((precio != null || costo != null) && !ctx.monedas.includes(moneda))
        return { ok: false, motivo: moneda
          ? `La moneda "${moneda}" no está configurada en Monedas y Tasas.`
          : 'Indica la moneda de los precios.' }

      // Categoría y proveedor se DECIDEN aquí y se escriben al insertar: validar
      // no toca la base de datos, y crear lo que falte es una escritura. Los dos
      // se resuelven aunque el primero falle, para preguntar por ambos en la
      // misma pasada (revalidar cuesta una consulta por fila).
      let fallo: Extract<Preparado, { ok: false }> | null = null

      let categoria_id:    string | null = null
      let categoria_nueva: string | null = null
      const categoria = (valores.categoria ?? '').trim()
      if (categoria) {
        const rc = await resolverCategoriaProducto(categoria, tipo, valores, ctx)
        if (!rc.ok) fallo = rc
        else {
          categoria_id    = rc.categoria_id
          categoria_nueva = rc.crear
        }
      }

      let proveedor_id:    string | null = null
      let proveedor_nuevo: string | null = null
      const proveedor = (valores.proveedor ?? '').trim()
      if (proveedor) {
        const rp = await resolverTerceroDeFila(proveedor, null, 'proveedor', valores, ctx)
        if (!rp.ok) fallo ??= rp
        else {
          proveedor_id = rp.tercero.tercero_id
          if (rp.tercero.crear) {
            // La ficha de un tercero pertenece a una empresa; con varias, el
            // operador tiene que decir a cuál (el catálogo no lo dice).
            if (!(valores.empresa_id ?? '').trim())
              return { ok: false, motivo: `Para crear la ficha de "${proveedor}" indica la empresa de los proveedores nuevos.` }
            proveedor_nuevo = rp.tercero.crear
          }
        }
      }
      if (fallo) return fallo

      const stock_minimo = parseNumero(valores.stock_minimo)
      if (stock_minimo === undefined) return { ok: false, motivo: 'El stock mínimo no es un número.' }

      const suscribible = parseBooleano(valores.es_suscribible)
      if (suscribible === undefined) return { ok: false, motivo: 'Suscribible debe ser Sí o No.' }

      const periodicidad = (valores.periodicidad_defecto ?? '').trim().toUpperCase()
      if (periodicidad && !PERIODICIDADES_SUB.includes(periodicidad as typeof PERIODICIDADES_SUB[number]))
        return { ok: false, motivo: `Periodicidad no válida (${PERIODICIDADES_SUB.join(', ')}).` }

      const campos = construirCamposProducto({
        nombre, tipo, unidad,
        codigo_proveedor: valores.codigo_proveedor,
        descripcion:      valores.descripcion,
        categoria_id,
        proveedor_id,
        precios: precio != null ? { [moneda]: precio } : {},
        costos:  costo  != null ? { [moneda]: costo  } : {},
        es_suscribible:       !!suscribible,
        periodicidad_defecto: periodicidad || null,
        stock_minimo,
      })

      const codigo = (valores.codigo ?? '').trim() || null
      // `codigo` NO está: el código visible es la identidad del producto en el
      // mundo del cliente y no se reescribe al actualizar. Precios y costos sí
      // van siempre: se fusionan, y vacío no borra nada.
      const provistos = [...camposProvistos(deColumna, {
        nombre:               'nombre',
        descripcion:          'descripcion',
        unidad:               'unidad',
        categoria:            'categoria_id',
        proveedor:            'proveedor_id',
        codigo_proveedor:     'codigo_proveedor',
        stock_minimo:         'stock_minimo',
        es_suscribible:       'es_suscribible',
        periodicidad_defecto: 'periodicidad_defecto',
      }), 'precios', 'costos']
        // Un proveedor o una categoría que no se pudieron resolver no vacían los
        // que ya tenía la ficha.
        .filter(c => c !== 'proveedor_id' || proveedor_id || proveedor_nuevo)
        .filter(c => c !== 'categoria_id' || categoria_id || categoria_nueva)

      return {
        ok: true,
        datos: {
          ...campos,
          codigo,
          categoria_nueva,
          proveedor_nuevo: proveedor_nuevo
            ? { nombre: proveedor_nuevo, empresa_id: (valores.empresa_id ?? '').trim() }
            : null,
        },
        clave: codigo ? `cod|${norm(codigo)}` : `nom|${norm(nombre)}`,
        provistos: [
          ...provistos,
          ...(proveedor_nuevo ? ['proveedor_nuevo'] : []),
          ...(categoria_nueva ? ['categoria_nueva'] : []),
        ],
      }
    },

    async buscarExistente(datos, ctx) {
      const { codigo, nombre } = datos as DatosCatalogo
      const q = ctx.db.from('products').select('producto_id').eq('client_id', ctx.client_id)
      const { data } = codigo
        ? await q.eq('codigo', codigo).limit(1).maybeSingle()
        : await q.eq('tipo', tipo).ilike('nombre', nombre).limit(1).maybeSingle()
      return (data?.producto_id as string) ?? null
    },

    async insertar(datos, ctx) {
      const { codigo, proveedor_nuevo, categoria_nueva, ...campos } = datos as DatosCatalogo
      const producto_id = generarProductoId(tipo)
      const { error } = await ctx.db.from('products').insert({
        producto_id,
        client_id:    ctx.client_id,
        codigo:       codigo ?? await siguienteCodigoProducto(ctx.db, ctx.client_id, tipo),
        estado:       'ACTIVO',
        stock_actual: 0,
        created_at:   new Date().toISOString(),
        ...campos,
        categoria_id: campos.categoria_id ?? await altaCategoria(categoria_nueva, tipo, ctx),
        proveedor_id: campos.proveedor_id ?? await altaProveedor(proveedor_nuevo, ctx),
      })
      if (error) throw new Error(error.message)
      return producto_id
    },

    async actualizar(id, datos, ctx) {
      // `datos` llega ya recortado a lo que el archivo trae (motor). El código
      // visible se descarta por si acaso: nunca se reescribe.
      const campos: Partial<DatosCatalogo> = { ...datos }
      delete campos.codigo
      // Lo apuntado no es una columna: se convierte en ficha aquí.
      const nuevo = campos.proveedor_nuevo
      delete campos.proveedor_nuevo
      if (nuevo) campos.proveedor_id = await altaProveedor(nuevo, ctx)
      const catNueva = campos.categoria_nueva
      delete campos.categoria_nueva
      if (catNueva) campos.categoria_id = await altaCategoria(catNueva, tipo, ctx)
      // Precios y costos se FUSIONAN con los que ya tiene: reimportar una lista
      // en otra moneda añade esa moneda en vez de borrar la anterior.
      const { data: prev } = await ctx.db.from('products')
        .select('precios, costos').eq('producto_id', id).eq('client_id', ctx.client_id).maybeSingle()
      const mezcla = (viejo: unknown, nuevo: unknown) => ({
        ...(typeof viejo === 'object' && viejo !== null ? viejo : {}),
        ...(nuevo as Record<string, number>),
      })
      const { error } = await ctx.db.from('products').update({
        ...campos,
        precios: mezcla(prev?.precios, campos.precios),
        costos:  mezcla(prev?.costos,  campos.costos),
      }).eq('producto_id', id).eq('client_id', ctx.client_id)
      if (error) throw new Error(error.message)
    },

    // Mismas dependencias que el borrado manual de un producto: si ya se vendió,
    // se compró o se movió, la ficha se queda. El stock no bloquea por sí solo
    // porque para tenerlo hace falta un movimiento, que sí bloquea.
    async deshacer(pk, ctx) {
      const dep = await primeraDependencia(ctx, pk, [
        { tabla: 'documento_lineas',       columna: 'producto_id', etiqueta: 'ventas u ofertas' },
        { tabla: 'compra_lineas',          columna: 'producto_id', etiqueta: 'compras' },
        { tabla: 'movimientos_inventario', columna: 'producto_id', etiqueta: 'movimientos de inventario' },
        { tabla: 'catalogo_items',         columna: 'producto_id', etiqueta: 'entradas en el catálogo público' },
        { tabla: 'caja_ticket_lineas',     columna: 'producto_id', etiqueta: 'tickets de caja' },
        { tabla: 'suscripcion_lineas',     columna: 'producto_id', etiqueta: 'líneas de suscripción' },
      ])
      if (dep) return dep
      await ctx.db.from('producto_precios_historial').delete().eq('producto_id', pk)
      await ctx.db.from('stock_almacenes').delete().eq('producto_id', pk)
      const { error } = await ctx.db.from('products').delete()
        .eq('producto_id', pk).eq('client_id', ctx.client_id)
      return error ? error.message : null
    },
  }
}

export const adaptadorProductos = crearAdaptadorCatalogo('PRODUCTO')
export const adaptadorServicios = crearAdaptadorCatalogo('SERVICIO')
