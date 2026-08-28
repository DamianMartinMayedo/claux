// Adaptador de importación de Suscripciones. A diferencia de TODO lo demás en
// el importador, una suscripción no es «una fila = un registro»: es un ACUERDO
// (cliente, empresa, moneda, periodicidad, fechas) con una o varias LÍNEAS (un
// servicio + su precio mensual + su propio descuento cada una, migs. 124/125).
//
// Aquí una fila del CSV = UNA LÍNEA. Varias filas con el mismo cliente y la
// misma fecha de próximo cobro son el MISMO acuerdo (Claudia lo confirmó: el
// punto de unión es cliente + fecha, no hay un Nº de contrato en su origen). El
// motor procesa fila→registro 1:1, así que el «registro» que identifica cada
// fila es la LÍNEA: `buscarExistente`/`insertar`/`actualizar` trabajan sobre
// ella, y el acuerdo se resuelve-o-crea como efecto de escribir su primera línea
// (mismo patrón que `altaProveedor`/`altaCategoria` en `catalogo.ts`).
//
// El importador NUNCA debe disparar el efecto secundario del alta manual
// (`borradorDelPrimerCobro`, factura sola si el acuerdo nace ya vencido): migrar
// historial no puede generar facturas fantasma. Por eso se escribe con el
// núcleo compartido `@/lib/suscripciones-core`, no con la acción del portal.

import {
  PERIODICIDADES, type PeriodicidadSub, type DescuentoModo,
} from '@/lib/suscripciones'
import {
  crearAcuerdoSuscripcion, crearLineaSuscripcion, type CamposAcuerdoSuscripcion,
} from '@/lib/suscripciones-core'
import {
  construirCamposProducto, generarProductoId, siguienteCodigoProducto,
} from '@/lib/productos-core'
import {
  camposProvistos, indicePorNombre, memo, norm, parseBooleano, parseFecha, parseNumero,
  primeraDependencia, totalesPor,
} from '../util'
import { aFallo, resolverRef } from '../resolver'
import { registrarAuxiliar } from '../motor'
import { comprobarLimite } from '@/lib/limites'
import { defEmpresa, defMoneda, defServicioFaltante, defTerceroFaltante, politicaServicio } from './comunes'
import { crearTerceroImportado, resolverTerceroDeFila } from './terceros'
import type { Adaptador, CampoDef, CtxImport, Preparado } from '../tipos'

type DatosLinea = {
  empresa_id:            string
  cliente_id:            string | null
  cliente_nuevo:         string | null
  cliente_nombre:        string
  producto_id:           string | null
  servicio_nuevo:        string | null
  moneda:                string
  periodicidad:          PeriodicidadSub
  fecha_inicio:          string
  fecha_proximo_cobro:   string
  fecha_fin:             string | null
  renovacion_automatica: boolean
  notas:                 string | null
  precio_mensual:        number
  descuento_modo:        DescuentoModo
  descuento_valor:       number
}

interface FichaAcuerdo {
  suscripcion_id:        string
  moneda:                string
  periodicidad:          PeriodicidadSub
  fecha_inicio:          string
  fecha_fin:             string | null
  renovacion_automatica: boolean
}

function claveAcuerdo(empresa_id: string, cliente_id: string, fecha_proximo_cobro: string): string {
  return `acuerdo_sus|${empresa_id}|${cliente_id}|${fecha_proximo_cobro}`
}

/** El acuerdo ya existente para (empresa, cliente, fecha de cobro), o null. Se
 *  cachea por lote para no repetir la consulta en cada línea de un acuerdo de
 *  varios servicios — pero SIEMPRE contra la BD real, nunca solo en memoria:
 *  un acuerdo puede haberse creado en una TANDA anterior y el `ctx` es nuevo en
 *  cada llamada del servidor (§`motor.ts`). */
async function buscarAcuerdo(
  empresa_id: string, cliente_id: string, fecha_proximo_cobro: string, ctx: CtxImport,
): Promise<FichaAcuerdo | null> {
  return memo(ctx, claveAcuerdo(empresa_id, cliente_id, fecha_proximo_cobro), async () => {
    const { data } = await ctx.db.from('suscripciones')
      .select('suscripcion_id, moneda, periodicidad, fecha_inicio, fecha_fin, renovacion_automatica')
      .eq('client_id', ctx.client_id).eq('empresa_id', empresa_id)
      .eq('cliente_id', cliente_id).eq('fecha_proximo_cobro', fecha_proximo_cobro)
      .maybeSingle()
    return (data as FichaAcuerdo | null) ?? null
  })
}

// ── Servicio de la línea: vincular a uno existente o crear uno simplificado ───

type FichaServicio = { producto_id: string; nombre: string; es_suscribible: boolean }

async function indiceServicios(ctx: CtxImport) {
  return indicePorNombre(ctx, 'servicios_sub', async () => {
    const { data } = await ctx.db.from('products')
      .select('producto_id, nombre, es_suscribible')
      .eq('client_id', ctx.client_id).eq('tipo', 'SERVICIO')
    return (data ?? []) as FichaServicio[]
  }, s => s.nombre)
}

interface ServicioDeFila { producto_id: string | null; crear: string | null }

async function resolverServicioDeFila(
  nombre: string, valores: Record<string, string>, ctx: CtxImport,
): Promise<{ ok: true; servicio: ServicioDeFila } | Extract<Preparado, { ok: false }>> {
  const idx    = await indiceServicios(ctx)
  const opcion = (s: FichaServicio) => ({ valor: s.producto_id, etiqueta: s.nombre })

  const r = resolverRef({
    tipo: 'servicio', etiqueta_tipo: 'Servicio', texto: nombre,
    coincidencias: idx.buscar(nombre).map(opcion),
    parecidos:     idx.sugerir(nombre).map(opcion),
    otras:         idx.todas().map(opcion),
    creable:  true,
    omitible: false,   // una línea sin servicio no tiene sentido
    aviso:    'El servicio nuevo se crea solo con el nombre y el precio de esta línea; el resto se completa después en Servicios.',
    defecto:  politicaServicio(valores),
  }, ctx)

  const fallo = aFallo(r)
  if (fallo) return fallo
  return {
    ok: true,
    servicio: {
      producto_id: r.estado === 'USAR'  ? r.id   : null,
      crear:       r.estado === 'CREAR' ? nombre : null,
    },
  }
}

/** Una suscripción a un servicio no suscribible no tiene sentido: vincularlo lo corrige. */
async function asegurarSuscribible(producto_id: string, ctx: CtxImport): Promise<void> {
  const idx   = await indiceServicios(ctx)
  const ficha = idx.todas(s => s.producto_id === producto_id)[0]
  if (!ficha || ficha.es_suscribible) return
  const { error } = await ctx.db.from('products')
    .update({ es_suscribible: true, updated_at: new Date().toISOString() })
    .eq('producto_id', producto_id).eq('client_id', ctx.client_id)
  if (error) throw new Error(error.message)
  ficha.es_suscribible = true
}

/** Da de alta el servicio MÍNIMO que la línea nombró y no existía: nombre,
 *  suscribible, y el precio de catálogo = el precio mensual de ESTA línea. */
async function crearServicioImportado(
  nombre: string, moneda: string, precio_mensual: number, ctx: CtxImport,
): Promise<string> {
  const idx = await indiceServicios(ctx)
  const ya  = idx.buscar(nombre)[0]
  if (ya) { await asegurarSuscribible(ya.producto_id, ctx); return ya.producto_id }

  // El servicio nace «de paso», pero es una ficha real que el dueño verá y usará:
  // consume cupo como cualquier otra. Si no cabe, se lanza y el motor deja esta
  // fila en ERROR con el motivo — la suscripción no puede existir sin su servicio.
  const tope = await comprobarLimite(ctx.db, ctx.client_id, 'servicios')
  if (tope) throw new Error(tope)

  const producto_id = generarProductoId('SERVICIO')
  const campos = construirCamposProducto({
    nombre, tipo: 'SERVICIO', es_suscribible: true,
    precios: { [moneda]: precio_mensual },
  })
  const { error } = await ctx.db.from('products').insert({
    producto_id, client_id: ctx.client_id,
    codigo:       await siguienteCodigoProducto(ctx.db, ctx.client_id, 'SERVICIO'),
    estado:       'ACTIVO', stock_actual: 0, created_at: new Date().toISOString(),
    ...campos,
  })
  if (error) throw new Error(error.message)
  idx.anotar(nombre, { producto_id, nombre: nombre.trim(), es_suscribible: true })
  await registrarAuxiliar(ctx, 'servicios', producto_id)
  return producto_id
}

// ── Adaptador ──────────────────────────────────────────────────────────────────

const CAMPOS: CampoDef[] = [
  { campo: 'cliente',               etiqueta: 'Cliente',                obligatorio: true,  alias: ['cliente', 'nombre cliente', 'tercero'], ejemplo: 'Restaurante Ejemplo S.A.' },
  { campo: 'servicio',              etiqueta: 'Servicio',               obligatorio: true,  alias: ['servicio', 'producto', 'plan'], ayuda: 'Por nombre. Si no existe, se puede vincular o crear en el paso de revisar.', ejemplo: 'Internet Wifi mensual' },
  { campo: 'precio_mensual',        etiqueta: 'Precio mensual',         obligatorio: true,  alias: ['precio mensual', 'precio', 'importe mensual'], ayuda: 'Siempre por mes, aunque la periodicidad sea otra.', ejemplo: '1500' },
  { campo: 'descuento_modo',        etiqueta: 'Descuento (modo)',       obligatorio: false, alias: ['descuento modo', 'tipo descuento'], ayuda: 'PORCENTAJE o MONTO_FIJO (por defecto PORCENTAJE).', ejemplo: 'PORCENTAJE' },
  { campo: 'descuento_valor',       etiqueta: 'Descuento (valor)',      obligatorio: false, alias: ['descuento', 'descuento valor'], ejemplo: '0' },
  { campo: 'moneda',                etiqueta: 'Moneda',                 obligatorio: false, alias: ['moneda', 'divisa'], ejemplo: 'CUP' },
  { campo: 'periodicidad',          etiqueta: 'Periodicidad',           obligatorio: false, alias: ['periodicidad', 'frecuencia'], ayuda: PERIODICIDADES.join(', '), ejemplo: 'MENSUAL' },
  { campo: 'fecha_proximo_cobro',   etiqueta: 'Fecha de próximo cobro', obligatorio: true,  alias: ['proximo cobro', 'próximo cobro', 'fecha cobro', 'fecha de cobro'], ejemplo: '01/08/2026' },
  { campo: 'fecha_inicio',          etiqueta: 'Fecha de inicio',        obligatorio: false, alias: ['fecha inicio', 'inicio', 'fecha alta'], ayuda: 'Si se deja vacía, se usa la fecha de próximo cobro.', ejemplo: '' },
  { campo: 'fecha_fin',             etiqueta: 'Fecha de fin',           obligatorio: false, alias: ['fecha fin', 'fin', 'vencimiento'], ejemplo: '' },
  { campo: 'renovacion_automatica', etiqueta: 'Renovación automática',  obligatorio: false, alias: ['renovacion', 'renovación', 'renovacion automatica'], ayuda: 'Sí / No (por defecto Sí).', ejemplo: 'Sí' },
  { campo: 'notas',                 etiqueta: 'Notas',                  obligatorio: false, alias: ['notas', 'observaciones'], ejemplo: '' },
]

export const adaptadorSuscripciones: Adaptador = {
  entidad:   'suscripciones',
  etiqueta:  'Suscripciones',
  modulos:   ['servicios'],
  revalidar: '/portal/suscripciones',
  defaults: [
    defEmpresa,
    defMoneda('moneda', true, 'Se aplica a las filas que no traigan moneda propia.'),
    {
      campo: 'periodicidad', etiqueta: 'Periodicidad', obligatorio: true, valor: 'MENSUAL',
      ayuda: 'Se aplica a las filas que no traigan periodicidad propia.',
      opciones: async () => PERIODICIDADES.map(p => ({ valor: p, etiqueta: p })),
    },
    defTerceroFaltante('cliente'),
    defServicioFaltante(),
  ],
  campos: CAMPOS,

  resumen: filas => [
    ...totalesPor(filas,
      f => (f as DatosLinea).moneda,
      f => (f as DatosLinea).precio_mensual,
      m => `Ingreso mensual nuevo (${m})`),
    ...(() => {
      const clientes = new Set(filas.map(f => (f as DatosLinea).cliente_nuevo).filter(Boolean))
      return clientes.size ? [{ etiqueta: 'Clientes nuevos', valor: clientes.size, entero: true }] : []
    })(),
    ...(() => {
      const servicios = new Set(filas.map(f => (f as DatosLinea).servicio_nuevo).filter(Boolean))
      return servicios.size ? [{ etiqueta: 'Servicios nuevos', valor: servicios.size, entero: true }] : []
    })(),
  ],

  async preparar(valores, ctx, deColumna): Promise<Preparado> {
    const nombreCliente = (valores.cliente ?? '').trim()
    if (!nombreCliente) return { ok: false, motivo: 'Falta el cliente.' }
    const nombreServicio = (valores.servicio ?? '').trim()
    if (!nombreServicio) return { ok: false, motivo: 'Falta el servicio.' }

    const empresa_id = (valores.empresa_id ?? '').trim()
    if (!empresa_id || !ctx.empresas.some(e => e.empresa_id === empresa_id))
      return { ok: false, motivo: 'Empresa no válida o no indicada.' }

    const moneda = (valores.moneda ?? '').trim().toUpperCase()
    if (!moneda || !ctx.monedas.includes(moneda))
      return { ok: false, motivo: moneda ? `La moneda "${moneda}" no está configurada.` : 'Indica la moneda.' }

    const periodicidad = (valores.periodicidad ?? '').trim().toUpperCase()
    if (!PERIODICIDADES.includes(periodicidad as PeriodicidadSub))
      return { ok: false, motivo: `Periodicidad no válida (${PERIODICIDADES.join(', ')}).` }

    const precioRaw = parseNumero(valores.precio_mensual)
    if (precioRaw === undefined) return { ok: false, motivo: 'El precio mensual no es un número.' }
    if (precioRaw == null)       return { ok: false, motivo: 'Falta el precio mensual.' }
    if (precioRaw < 0)           return { ok: false, motivo: 'El precio mensual no puede ser negativo.' }

    const descuento_modo = ((valores.descuento_modo ?? '').trim().toUpperCase() || 'PORCENTAJE') as DescuentoModo
    if (!['PORCENTAJE', 'MONTO_FIJO'].includes(descuento_modo))
      return { ok: false, motivo: 'El modo de descuento debe ser PORCENTAJE o MONTO_FIJO.' }
    const descuentoRaw = parseNumero(valores.descuento_valor)
    if (descuentoRaw === undefined) return { ok: false, motivo: 'El descuento no es un número.' }
    const descuento_valor = descuentoRaw ?? 0
    if (descuento_valor < 0) return { ok: false, motivo: 'El descuento no puede ser negativo.' }
    if (descuento_modo === 'PORCENTAJE' && descuento_valor > 100)
      return { ok: false, motivo: 'Un descuento en porcentaje no puede pasar del 100 %.' }

    const fecha_proximo_cobro = parseFecha(valores.fecha_proximo_cobro)
    if (fecha_proximo_cobro === undefined) return { ok: false, motivo: 'La fecha de próximo cobro no es una fecha válida.' }
    if (!fecha_proximo_cobro)              return { ok: false, motivo: 'Falta la fecha de próximo cobro.' }

    const fechaInicioRaw = parseFecha(valores.fecha_inicio)
    if (fechaInicioRaw === undefined) return { ok: false, motivo: 'La fecha de inicio no es una fecha válida.' }
    const fecha_inicio = fechaInicioRaw || fecha_proximo_cobro

    const fecha_fin = parseFecha(valores.fecha_fin)
    if (fecha_fin === undefined) return { ok: false, motivo: 'La fecha de fin no es una fecha válida.' }

    const renovacionRaw = parseBooleano(valores.renovacion_automatica)
    if (renovacionRaw === undefined) return { ok: false, motivo: 'Renovación automática debe ser Sí o No.' }
    const renovacion_automatica = renovacionRaw ?? true

    // Consistencia entre líneas del MISMO acuerdo (mismo cliente+fecha) dentro
    // de esta pasada: si una fila trae otra moneda/periodicidad/fechas, no se
    // asume cuál vale — se avisa. No detecta el caso repartido en dos TANDAS de
    // un archivo que además está creando el acuerdo por primera vez (el commit
    // sí lo detecta siempre, contra la cabecera ya escrita: ver `insertar`).
    const claveGrupo = `grupo_sus|${empresa_id}|${norm(nombreCliente)}|${fecha_proximo_cobro}`
    const cabecera = { moneda, periodicidad, fecha_inicio, fecha_fin, renovacion_automatica }
    const previa = ctx.cache.get(claveGrupo) as typeof cabecera | undefined
    if (previa) {
      const distinta = previa.moneda !== cabecera.moneda || previa.periodicidad !== cabecera.periodicidad
        || previa.fecha_inicio !== cabecera.fecha_inicio || previa.fecha_fin !== cabecera.fecha_fin
        || previa.renovacion_automatica !== cabecera.renovacion_automatica
      if (distinta) {
        return { ok: false, motivo: `Esta fila no coincide con el resto del acuerdo de "${nombreCliente}" en ${fecha_proximo_cobro} (moneda, periodicidad, fechas o renovación distintas).` }
      }
    } else {
      ctx.cache.set(claveGrupo, cabecera)
    }

    // Cliente y servicio se resuelven aunque uno falle, para preguntar por los
    // dos en la misma pasada (mismo patrón que el catálogo con proveedor/categoría).
    let fallo: Extract<Preparado, { ok: false }> | null = null

    let cliente_id: string | null = null
    let cliente_nuevo: string | null = null
    const rc = await resolverTerceroDeFila(nombreCliente, empresa_id, 'cliente', valores, ctx)
    if (!rc.ok) fallo = rc
    else {
      cliente_id    = rc.tercero.tercero_id
      cliente_nuevo = rc.tercero.crear
      if (!cliente_id && !cliente_nuevo) {
        fallo ??= { ok: false, motivo: `El cliente "${nombreCliente}" es obligatorio: no se puede dejar en blanco.` }
      }
    }

    let producto_id: string | null = null
    let servicio_nuevo: string | null = null
    const rs = await resolverServicioDeFila(nombreServicio, valores, ctx)
    if (!rs.ok) fallo ??= rs
    else {
      producto_id    = rs.servicio.producto_id
      servicio_nuevo = rs.servicio.crear
    }
    if (fallo) return fallo

    const datos: DatosLinea = {
      empresa_id, cliente_id, cliente_nuevo, cliente_nombre: nombreCliente,
      producto_id, servicio_nuevo,
      moneda, periodicidad: periodicidad as PeriodicidadSub,
      fecha_inicio, fecha_proximo_cobro, fecha_fin, renovacion_automatica,
      notas: (valores.notas ?? '').trim() || null,
      precio_mensual: precioRaw, descuento_modo, descuento_valor,
    }

    return {
      ok: true,
      datos,
      clave: `${empresa_id}|${cliente_id ?? `nuevo:${norm(nombreCliente)}`}|${fecha_proximo_cobro}|${producto_id ?? `nuevo:${norm(nombreServicio)}`}`,
      // Al ACTUALIZAR solo se tocan precio y descuento de la línea: los campos
      // de cabecera del acuerdo no se reescriben al reimportar (eso es edición
      // manual en el portal; `insertar` sí valida que no cambien en silencio).
      provistos: camposProvistos(deColumna, {
        precio_mensual:  'precio_mensual',
        descuento_modo:  'descuento_modo',
        descuento_valor: 'descuento_valor',
      }),
    }
  },

  async buscarExistente(datos, ctx) {
    const d = datos as DatosLinea
    if (!d.cliente_id || !d.producto_id) return null   // alguno se crea al escribir: nada que buscar todavía
    const acuerdo = await buscarAcuerdo(d.empresa_id, d.cliente_id, d.fecha_proximo_cobro, ctx)
    if (!acuerdo) return null
    const { data } = await ctx.db.from('suscripcion_lineas')
      .select('linea_id').eq('suscripcion_id', acuerdo.suscripcion_id).eq('producto_id', d.producto_id)
      .limit(1).maybeSingle()
    return (data?.linea_id as string) ?? null
  },

  async insertar(datos, ctx) {
    const d = datos as DatosLinea
    const cliente_id = d.cliente_id ?? await crearTerceroImportado(d.cliente_nuevo!, d.empresa_id, 'CLIENTE', ctx)

    let producto_id = d.producto_id
    if (!producto_id) producto_id = await crearServicioImportado(d.servicio_nuevo!, d.moneda, d.precio_mensual, ctx)
    else await asegurarSuscribible(producto_id, ctx)

    const acuerdo = await buscarAcuerdo(d.empresa_id, cliente_id, d.fecha_proximo_cobro, ctx)
    let suscripcion_id: string
    if (acuerdo) {
      // Cabecera ya escrita (por una línea anterior de este mismo lote, o de un
      // lote previo): si esta fila trae otros datos, no se pisan en silencio.
      if (acuerdo.moneda !== d.moneda || acuerdo.periodicidad !== d.periodicidad
        || acuerdo.fecha_inicio !== d.fecha_inicio || acuerdo.fecha_fin !== d.fecha_fin
        || acuerdo.renovacion_automatica !== d.renovacion_automatica) {
        throw new Error(`El acuerdo de "${d.cliente_nombre}" en ${d.fecha_proximo_cobro} ya existe con otra moneda, periodicidad o fechas: esta fila no coincide.`)
      }
      suscripcion_id = acuerdo.suscripcion_id
    } else {
      const campos: CamposAcuerdoSuscripcion = {
        empresa_id: d.empresa_id, cliente_id, moneda: d.moneda, periodicidad: d.periodicidad,
        fecha_inicio: d.fecha_inicio, fecha_proximo_cobro: d.fecha_proximo_cobro,
        fecha_fin: d.fecha_fin, renovacion_automatica: d.renovacion_automatica, notas: d.notas,
      }
      suscripcion_id = await crearAcuerdoSuscripcion(ctx.db, ctx.client_id, campos)
      // La siguiente línea de este acuerdo en la misma tanda tiene que verlo: si
      // no, lo daría por inexistente y crearía una cabecera duplicada.
      ctx.cache.set(claveAcuerdo(d.empresa_id, cliente_id, d.fecha_proximo_cobro), {
        suscripcion_id, moneda: d.moneda, periodicidad: d.periodicidad,
        fecha_inicio: d.fecha_inicio, fecha_fin: d.fecha_fin, renovacion_automatica: d.renovacion_automatica,
      } as FichaAcuerdo)
    }

    return crearLineaSuscripcion(ctx.db, ctx.client_id, suscripcion_id, {
      producto_id, precio_mensual: d.precio_mensual,
      descuento_modo: d.descuento_modo, descuento_valor: d.descuento_valor,
    })
  },

  async actualizar(id, datos, ctx) {
    if (!Object.keys(datos).length) return
    const { error } = await ctx.db.from('suscripcion_lineas').update(datos)
      .eq('linea_id', id).eq('client_id', ctx.client_id)
    if (error) throw new Error(error.message)
  },

  // `pk` es una LÍNEA. Si su acuerdo ya se facturó, no se toca (mismo rastro de
  // idempotencia que usa la facturación de suscripciones). Si era la última
  // línea del acuerdo, se borra también la cabecera: un acuerdo sin líneas no
  // se ve ni se puede cobrar (mismo invariante que protege el alta manual).
  async deshacer(pk, ctx) {
    const { data: linea } = await ctx.db.from('suscripcion_lineas')
      .select('suscripcion_id').eq('linea_id', pk).eq('client_id', ctx.client_id).maybeSingle()
    if (!linea) return null
    const suscripcion_id = linea.suscripcion_id as string

    const dep = await primeraDependencia(ctx, suscripcion_id, [
      { tabla: 'documento_lineas', columna: 'suscripcion_id', etiqueta: 'facturas' },
    ])
    if (dep) return dep

    const { error } = await ctx.db.from('suscripcion_lineas').delete()
      .eq('linea_id', pk).eq('client_id', ctx.client_id)
    if (error) return error.message

    const { count } = await ctx.db.from('suscripcion_lineas')
      .select('*', { count: 'exact', head: true }).eq('suscripcion_id', suscripcion_id)
    if (!count) {
      await ctx.db.from('suscripciones').delete()
        .eq('suscripcion_id', suscripcion_id).eq('client_id', ctx.client_id)
    }
    return null
  },
}
