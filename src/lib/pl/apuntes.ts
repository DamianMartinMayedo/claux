// ── De filas de BD a apuntes del motor de resultados ─────────────────────────
//
// El motor (`@/lib/pl/estado`) come apuntes normalizados, no filas de Supabase. La
// traducción NO es un `map` tonto: decide qué fila suma, en qué renglón cae y qué
// se descarta por ser solo deuda. Vive aquí, en una función pura y sin I/O, porque
// la usan dos sitios que TIENEN que coincidir:
//
//   · el informe de resultados (`obtenerReportes`)
//   · el aviso previo a una operación estructural (F1.5)
//
// Si el aviso calculara con otro criterio, enseñaría un «antes» que no es el que
// el dueño tiene delante en su informe — y el aviso dejaría de valer para nada.

import { cobroEsIngreso, fuenteDeCobro, computaEnResultados } from '@/lib/gastos-core'
import type { ApunteIngreso, ApunteGasto } from './estado'

export interface FilaFacturaPL {
  factura_id: string
  moneda: string
  total: number
  fecha_emision: string
}

/** Una línea de factura, con el producto ya resuelto a su categoría de catálogo. */
export interface FilaLineaFacturaPL {
  documento_id: string
  /** `categoria_id` de `product_categories`, o null si no se pudo resolver. */
  linea_id:     string | null
  total:        number
}

export interface FilaGastoCobroPL {
  tipo: string
  moneda: string
  monto: number
  categoria: string | null
  categoria_id: string | null
  fecha: string
  origen_tipo: string | null
  naturaleza: string | null
  // Tasa congelada de consolidación de la fila (mig. 199). Viaja hasta el apunte
  // para que Reportes convierta ESTA fila a su tasa histórica al «Ver en» la
  // moneda de consolidación. El motor la ignora. null/ausente = a la tasa vigente.
  tasa_consolidacion?: number | null
}

export interface ApuntesPL {
  ingresos: ApunteIngreso[]
  gastos:   ApunteGasto[]
}

const enRango = (f: string, d: string, h: string) => !!f && f >= d && f <= h

/**
 * Reparte el importe de una factura entre las líneas de negocio que vendió.
 *
 * ── La escalera de degradación (decisión ⑤) ──
 *   1. La factura tiene líneas y suman algo → se reparte entre ellas, cada una a
 *      la categoría de su producto.
 *   2. Línea sin producto, o producto sin categoría → a la clave `null`, el cajón.
 *   3. La factura no tiene líneas, o suman cero → entera al cajón.
 *
 * El reparto es PROPORCIONAL al importe de la factura, no la suma cruda de las
 * líneas: un descuento global o un redondeo hacen que las líneas no sumen el
 * total, y un desglose que no cuadra con el renglón del que cuelga se lee como un
 * error de cálculo del informe. Prorratear deja esa diferencia donde de verdad
 * está —repartida entre lo vendido— en vez de suelta en una línea de ajuste.
 *
 * Lo usan el informe del portal y el snapshot del dossier. Dos copias de este
 * reparto son dos documentos que un día contarían la misma venta de dos maneras.
 */
export function repartirFacturaPorLinea(
  total: number,
  lineas: FilaLineaFacturaPL[],
): Map<string | null, number> {
  const salida = new Map<string | null, number>()
  const suma = lineas.reduce((s, l) => s + (Number(l.total) || 0), 0)

  if (!lineas.length || Math.abs(suma) < 0.005) {
    salida.set(null, total)
    return salida
  }

  for (const l of lineas) {
    const parte = ((Number(l.total) || 0) / suma) * total
    salida.set(l.linea_id, (salida.get(l.linea_id) ?? 0) + parte)
  }

  // El prorrateo deja céntimos sueltos. Se cargan a la línea mayor, que es donde
  // menos distorsionan: sin este ajuste la suma de las líneas se separa del total
  // de la factura y el desglose deja de cuadrar con las Ventas.
  const repartido = [...salida.values()].reduce((s, v) => s + v, 0)
  const resto = total - repartido
  if (Math.abs(resto) > 1e-7) {
    let mayor: string | null = null, max = -Infinity
    for (const [k, v] of salida) if (v > max) { max = v; mayor = k }
    salida.set(mayor, (salida.get(mayor) ?? 0) + resto)
  }
  return salida
}

/**
 * Los apuntes de un rango, a partir de filas ya traídas.
 *
 * Recibe las filas y no el cliente a propósito: el informe pide un rango ampliado
 * de una vez y parte en memoria (dos viajes a Supabase por informe se notan en 3G),
 * así que el filtro por fechas tiene que poder repetirse sin volver a consultar.
 */
export function apuntesDeFilas(
  facturas: FilaFacturaPL[],
  gastosCobros: FilaGastoCobroPL[],
  desde: string,
  hasta: string,
  // Vacío = no se clasifica el ingreso y todas las ventas salen sin línea. Es lo
  // correcto para quien no necesita el desglose (el aviso previo a una operación
  // estructural mide gasto, no ingreso) y no cuesta nada: el motor se calla.
  lineasFactura: FilaLineaFacturaPL[] = [],
): ApuntesPL {
  const ingresos: ApunteIngreso[] = []
  const gastos:   ApunteGasto[]   = []

  const lineasPorFactura = new Map<string, FilaLineaFacturaPL[]>()
  for (const l of lineasFactura) {
    const arr = lineasPorFactura.get(l.documento_id)
    if (arr) arr.push(l); else lineasPorFactura.set(l.documento_id, [l])
  }

  for (const f of facturas) {
    if (!enRango(f.fecha_emision, desde, hasta)) continue
    const mes = f.fecha_emision.slice(0, 7)
    const reparto = repartirFacturaPorLinea(Number(f.total) || 0, lineasPorFactura.get(f.factura_id) ?? [])
    for (const [linea_id, monto] of reparto) {
      ingresos.push({ moneda: f.moneda, monto, mes, fuente: 'VENTA', linea_id })
    }
  }

  for (const g of gastosCobros) {
    if (!enRango(g.fecha, desde, hasta)) continue
    if (g.tipo === 'COBRO') {
      // Dos preguntas distintas sobre la misma fila, y conviene no mezclarlas:
      //  · `cobroEsIngreso` decide SI SUMA. Una fila que es solo DEUDA (mig. 166) no
      //    es ingreso —el subsidio recupera un anticipo—; sin este filtro infla
      //    ingresos y resultado neto.
      //  · `fuenteDeCobro` decide EN QUÉ RENGLÓN. El cierre del punto de venta es una
      //    venta de mostrador, así que va a «Ventas» junto a las facturas: sin esto el
      //    importe cae en «cobros directos» y un negocio que solo vende por TPV ve su
      //    renglón de Ventas en blanco.
      if (!cobroEsIngreso(g.naturaleza)) continue
      ingresos.push({
        moneda: g.moneda, monto: Number(g.monto), mes: g.fecha.slice(0, 7),
        fuente: fuenteDeCobro(g.origen_tipo),
        // Ni el cierre del punto de venta ni el cobro suelto pasan por el catálogo
        // de productos: no hay líneas que mirar. El cierre de TPV cuenta como venta
        // (`fuenteDeCobro`) y por tanto engorda el cajón «Sin clasificar» del
        // desglose — que es la verdad: ese dinero entró sin decir qué se vendió.
        linea_id: null,
        // Lo que sí tiene el cobro es su categoría, y con ella se desglosan los
        // cobros directos (fase 3). El cierre de TPV la lleva puesta por
        // `ing_venta_local`, así que un negocio de mostrador deja de ver toda su
        // facturación como un número suelto sin nada dentro.
        categoria_id: g.categoria_id,
        categoria:    g.categoria,
        tasa_consolidacion: g.tasa_consolidacion ?? null,
      })
    } else {
      // Un GASTO que es solo DEUDA no es coste: el salario neto y las retenciones de
      // una nómina ya están contados en las filas de COSTE de esa misma nómina, y
      // sumarlos otra vez duplicaría el renglón de Personal.
      if (!computaEnResultados(g.naturaleza)) continue
      gastos.push({
        moneda: g.moneda, monto: Number(g.monto), mes: g.fecha.slice(0, 7),
        categoria_id: g.categoria_id, categoria: g.categoria,
        tasa_consolidacion: g.tasa_consolidacion ?? null,
      })
    }
  }

  return { ingresos, gastos }
}
