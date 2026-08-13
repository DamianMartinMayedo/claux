// ── Snapshot desde la base contable (server-only) ───────────────────────────
//
// Construye la serie mensual + el desglose del período del dossier LEYENDO la
// base, para el cliente que tiene el módulo `base`. NO usa obtenerReportes:
// esa función da buckets por moneda de UN período (12 meses = 12 llamadas, sin
// serie mensual ni split de coste de ventas). Reutiliza sus REGLAS, no su código:
//   · Ingreso devengado: facturas EMITIDA|COBRADA por fecha_emision.
//   · Ingreso directo:   gastos_cobros COBRO por fecha.
//   · Gasto:             gastos_cobros GASTO por fecha; se parte en coste de
//                        ventas vs. operativo según el `rol_pl` de su categoría.
// Todo se convierte a la moneda de presentación; lo que no tiene tasa se excluye
// y se informa en monedasFaltantes (deck y PDF lo imprimen).
//
// CONVERGENCIA (F4): la clasificación es la MISMA que la del informe del portal —
// `categorias_gastos.rol_pl`, resuelto por la categoría RAÍZ (mig. 134). Antes
// vivía en `dossier_costo_ventas`, un booleano por NOMBRE de categoría: una
// segunda fuente de verdad sobre el mismo dato, con la que los dos estados de
// resultados del producto podían clasificar distinto el mismo gasto y decirle
// cosas diferentes al dueño y a su inversor. El desglose además hace ROLLUP por
// raíz, igual que el portal: una subcategoría no aparece como hermana de su madre.

import { createAdminClient } from '@/lib/supabase/admin'
import { ESTADOS_FACTURA_INGRESO } from '@/lib/contabilidad'
import { computaEnResultados, fuenteDeCobro } from '@/lib/gastos-core'
import { construirConversor, type DetalleTasa } from '@/lib/tasas'
import { indexarCategorias, esFueraDelResultado, type CategoriaPL } from '@/lib/pl/estado'
import { repartirFacturaPorLinea, type FilaLineaFacturaPL } from '@/lib/pl/apuntes'
import type { FilaSerie } from './snapshot'

// Grupos del desglose = los `rol_pl` de gasto (más INGRESO). La SERIE mensual sigue
// con dos cubos de gasto (coste vs. operativos); el DESGLOSE parte el operativo en
// Personal / Operativos / Depreciación / Otros para el waterfall del estado de
// resultados. Los nombres 'COSTO_VENTAS'/'GASTO_OPERATIVO' se conservan (ya hay
// filas guardadas así).
//
// `DEPRECIACION` (fase 4) tiene grupo propio y no se disuelve en 'GASTO_OPERATIVO'
// porque es la única partida del documento que NO salió de la caja: sin separarla,
// quien lo lee no puede reconstruir cuánto del resultado es dinero de verdad, que
// es justo lo que un inversor o un banco mira primero. La columna `grupo` es texto
// libre en la tabla (mig. 098), así que el grupo nuevo no necesita migración.
export type GrupoLinea = 'INGRESO' | 'COSTO_VENTAS' | 'PERSONAL' | 'GASTO_OPERATIVO' | 'DEPRECIACION' | 'OTRO'

export interface LineaDesglose {
  grupo: GrupoLinea
  concepto: string
  monto: number
  orden: number
  /** Concepto traducido al inglés (mig. 179), para la slide «El detalle» del deck
   *  bilingüe. Opcional: solo lo rellena la traducción con IA; NULL → cae al ES. */
  concepto_en?: string | null
}

export interface SnapshotBase {
  /** Solo los meses que la base CONOCE (con datos). origen 'BASE'. Ordenada. */
  serie: FilaSerie[]
  /** Desglose del período por categoría, para el estado de resultados. */
  lineas: LineaDesglose[]
  /** Monedas presentes sin tasa hacia la de presentación (importes excluidos). */
  monedasFaltantes: string[]
  /** Tasa aplicada por cada moneda foránea presente (para imprimir la conversión). */
  tasasUsadas: Record<string, DetalleTasa>
}

interface FilaMes {
  ingresos: number
  costo_ventas: number
  gastos_operativos: number
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Las líneas de un puñado de facturas, con el producto ya resuelto a su categoría
 * de catálogo, más los nombres de esas categorías.
 *
 * Tres viajes encadenados y no uno con joins porque el cliente de Supabase no
 * atraviesa `documento_lineas → products → product_categories` sin FK declaradas
 * entre ellas. Cada uno va acotado por la lista de ids del anterior.
 */
async function lineasDeVenta(
  db: ReturnType<typeof createAdminClient>,
  clientId: string,
  facturaIds: string[],
): Promise<{ lineas: Map<string, FilaLineaFacturaPL[]>; nombres: Map<string, string> }> {
  const lineas  = new Map<string, FilaLineaFacturaPL[]>()
  const nombres = new Map<string, string>()
  if (!facturaIds.length) return { lineas, nombres }

  const { data: lins } = await db.from('documento_lineas')
    .select('documento_id, producto_id, total')
    .eq('documento_tipo', 'FACTURA').in('documento_id', facturaIds)
  const filas = (lins ?? []) as { documento_id: string; producto_id: string | null; total: number }[]
  if (!filas.length) return { lineas, nombres }

  const prodIds = [...new Set(filas.map(l => l.producto_id).filter((id): id is string => !!id))]
  const lineaDeProducto = new Map<string, string>()
  if (prodIds.length) {
    const { data: prods } = await db.from('products')
      .select('producto_id, categoria_id')
      .eq('client_id', clientId).in('producto_id', prodIds)
      .not('categoria_id', 'is', null)
    for (const p of (prods ?? []) as { producto_id: string; categoria_id: string }[]) {
      lineaDeProducto.set(p.producto_id, p.categoria_id)
    }
  }

  const catIds = [...new Set(lineaDeProducto.values())]
  if (catIds.length) {
    const { data: cats } = await db.from('product_categories')
      .select('categoria_id, nombre')
      .eq('client_id', clientId).in('categoria_id', catIds)
    for (const c of (cats ?? []) as { categoria_id: string; nombre: string }[]) {
      nombres.set(c.categoria_id, c.nombre)
    }
  }

  for (const l of filas) {
    const fila: FilaLineaFacturaPL = {
      documento_id: l.documento_id,
      linea_id:     l.producto_id ? (lineaDeProducto.get(l.producto_id) ?? null) : null,
      total:        Number(l.total) || 0,
    }
    const arr = lineas.get(l.documento_id)
    if (arr) arr.push(fila); else lineas.set(l.documento_id, [fila])
  }
  return { lineas, nombres }
}

export async function construirSnapshotDesdeBase(
  db: ReturnType<typeof createAdminClient>,
  clientId: string,
  empresaIds: string[],
  desde: string,
  hasta: string,
  monedaPresentacion: string,
  categorias: CategoriaPL[],
  categoriasExcluidas: Set<string> = new Set(),
): Promise<SnapshotBase> {
  const ids = empresaIds.length ? empresaIds : ['__none__']
  const idx = indexarCategorias(categorias)
  const porNombreRaiz = new Map(categorias.filter(c => !c.parent_id).map(c => [c.nombre.trim().toLowerCase(), c]))

  /**
   * La categoría RAÍZ de una fila de `gastos_cobros`, por FK y, si falta, por
   * nombre. La usan los dos lados —el cobro y el gasto— porque es la misma
   * pregunta: el rol y el nombre del renglón viven en la raíz (mig. 134).
   */
  const raizDeCobro = (categoria_id: string | null, categoria: string | null) => {
    const fila = (categoria_id ? idx.porId.get(categoria_id) : undefined)
      ?? (categoria ? porNombreRaiz.get(categoria.trim().toLowerCase()) : undefined)
    return fila ? (idx.raizDe.get(fila.categoria_id) ?? fila) : null
  }

  const [conversor, facRes, gcRes] = await Promise.all([
    construirConversor(db, clientId),
    db.from('facturas').select('factura_id, moneda, total, fecha_emision')
      .eq('client_id', clientId).in('empresa_id', ids)
      .in('estado', ESTADOS_FACTURA_INGRESO)
      .gte('fecha_emision', desde).lte('fecha_emision', hasta),
    db.from('gastos_cobros').select('tipo, moneda, monto, categoria, categoria_id, fecha, origen_tipo, naturaleza')
      .eq('client_id', clientId).in('empresa_id', ids)
      .gte('fecha', desde).lte('fecha', hasta),
  ])

  const meses = new Map<string, FilaMes>()
  const getMes = (mes: string): FilaMes => {
    let f = meses.get(mes)
    if (!f) { f = { ingresos: 0, costo_ventas: 0, gastos_operativos: 0 }; meses.set(mes, f) }
    return f
  }

  const monedasFaltantes = new Set<string>()
  const monedasVistas = new Set<string>()
  // Desglose de período por (grupo, concepto). El gasto no-coste se parte por rol.
  const ingresoCat = new Map<string, number>()      // concepto → monto
  const costoCat = new Map<string, number>()
  const personalCat = new Map<string, number>()
  const operativoCat = new Map<string, number>()
  const depreciacionCat = new Map<string, number>()
  const otroCat = new Map<string, number>()

  // Convierte a la moneda de presentación; null → registra la moneda como faltante.
  const conv = (monto: number, moneda: string): number | null => {
    const v = conversor.convertir(Number(monto) || 0, moneda, monedaPresentacion)
    if (v == null) { monedasFaltantes.add(moneda); return null }
    if (moneda !== monedaPresentacion) monedasVistas.add(moneda)
    return v
  }

  // ── Ingresos devengados (facturas), desglosados por línea de negocio ────────
  //
  // El desglose del ingreso usa el MISMO reparto que el informe del portal
  // (`repartirFacturaPorLinea`, fase 3). Sin eso, el documento que se le enseña a
  // un inversor tendría una sola línea «Ventas» por toda la facturación —cierto,
  // pero mudo— mientras la pantalla del dueño ya sabe decir de qué vive el
  // negocio. Lo que no se pueda clasificar se queda en «Ventas»: es la escalera
  // de degradación, y un cliente sin catálogo categorizado ve exactamente lo de
  // antes.
  const facturas = (facRes.data ?? []) as { factura_id: string; moneda: string; total: number; fecha_emision: string }[]
  const lineaPorFactura = await lineasDeVenta(db, clientId, facturas.map(f => f.factura_id))

  for (const f of facturas) {
    const v = conv(f.total, f.moneda)
    if (v == null || !f.fecha_emision) continue
    getMes(f.fecha_emision.slice(0, 7)).ingresos += v
    // Se reparte el importe YA convertido: convertir cada trozo por separado
    // metería un redondeo por línea y el desglose dejaría de sumar el total.
    for (const [linea_id, monto] of repartirFacturaPorLinea(v, lineaPorFactura.lineas.get(f.factura_id) ?? [])) {
      const concepto = (linea_id && lineaPorFactura.nombres.get(linea_id)) || 'Ventas'
      ingresoCat.set(concepto, (ingresoCat.get(concepto) ?? 0) + monto)
    }
  }

  // ── gastos_cobros: COBRO → ingreso; GASTO → coste de ventas u operativo ──
  // La categoría se resuelve por FK y, si falta, por nombre; después se SUBE a su
  // raíz, que es la que tiene el `rol_pl` y la que da nombre a la línea del
  // desglose. Sin subir, «Suministros · Electricidad» saldría suelta al lado de
  // «Suministros» como si fueran dos gastos distintos del mismo nivel.
  for (const g of (gcRes.data ?? []) as { tipo: string; moneda: string; monto: number; categoria: string | null; categoria_id: string | null; fecha: string; origen_tipo: string | null; naturaleza: string | null }[]) {
    const v = conv(g.monto, g.moneda)
    if (v == null || !g.fecha) continue
    // Una fila que es solo DEUDA (mig. 166) no entra en el documento por ninguno de
    // los dos lados. Aquí importa el doble que en cualquier otro informe: además de
    // descuadrar las cifras, se pintaría como una LÍNEA del desglose («Subsidios por
    // cobrar», «Nómina · salario neto») en el documento que se le enseña a un asesor o
    // a un inversor.
    if (!computaEnResultados(g.naturaleza)) continue
    const mes = getMes(g.fecha.slice(0, 7))

    if (g.tipo === 'COBRO') {
      mes.ingresos += v
      // El cierre del punto de venta va a la línea «Ventas», la misma que las facturas:
      // es una venta de mostrador, no un ingreso suelto. En el documento que se le enseña
      // a un asesor o a un inversor, un restaurante con TPV enseñaría toda su facturación
      // real bajo «Otros ingresos» — que es lo que hay que llamar mal contado.
      // El cobro suelto se agrupa por su categoría RAÍZ, igual que el gasto de
      // abajo y que el informe del portal (fase 3). Con el texto crudo,
      // «Suscripciones · Mensual» y «Suscripciones · Anual» salían como dos
      // líneas distintas del documento, y renombrar la categoría partía la
      // serie. La raíz es además la que lleva el `rol_pl`, así que agrupar por
      // ella es lo que hace que el desglose del dossier y el del informe digan
      // lo mismo del mismo dinero.
      //
      // Las categorías apartadas del dossier NO se aplican aquí: apartar es un
      // gesto sobre el GASTO (el paso que lo ofrece solo lista gasto) y el
      // importe ya se sumó a `mes.ingresos`. Saltarlo dejaría el desglose de
      // ingresos sin cuadrar con el total del mes, que es peor que la línea de
      // más.
      const rz = raizDeCobro(g.categoria_id, g.categoria)
      const concepto = fuenteDeCobro(g.origen_tipo) === 'VENTA'
        ? 'Ventas'
        : (rz?.nombre ?? g.categoria?.trim() ?? 'Otros ingresos')
      ingresoCat.set(concepto, (ingresoCat.get(concepto) ?? 0) + v)
      continue
    }

    const raiz = raizDeCobro(g.categoria_id, g.categoria)
    if (raiz && categoriasExcluidas.has(raiz.categoria_id)) continue
    const cat  = raiz?.nombre ?? (g.categoria?.trim() || 'Sin categoría')

    const rol = raiz?.rol_pl
    // 🔴 Lo que no es gasto no entra en el documento por ninguno de los dos lados
    // (fase 2). Sin este corte, el `else` de abajo —que es un cajón de sastre—
    // metería un refrigerador o una retirada del dueño en «gastos operativos», y
    // el dossier le enseñaría a un banco o a un inversor un negocio que perdió
    // dinero justo el mes que invirtió en sí mismo. Es el mismo criterio que la
    // línea de `computaEnResultados` de arriba: lo que no es resultado, no sale.
    // El dinero no desaparece: sigue en Tesorería y en el bloque de fuera del
    // resultado del informe del portal. Lo que no hace es fingir ser un gasto.
    if (rol && esFueraDelResultado(rol)) continue
    if (rol === 'COSTE_VENTAS') {
      mes.costo_ventas += v
      costoCat.set(cat, (costoCat.get(cat) ?? 0) + v)
    } else {
      // La SERIE agrupa todo lo no-coste en gastos_operativos (no cambia); el
      // DESGLOSE lo parte por rol para poder enseñar Personal, Operativos,
      // Depreciación y Otros por separado y calcular el resultado operativo (EBIT).
      //
      // El impuesto sobre utilidades cae en «Otros», que en este documento es el
      // renglón de DEBAJO del resultado operativo: es exactamente donde le toca, y
      // el dossier no necesita —ni tiene sitio para— un piso más de waterfall.
      mes.gastos_operativos += v
      const destino =
        rol === 'PERSONAL'     ? personalCat :
        rol === 'DEPRECIACION' ? depreciacionCat :
        (rol === 'OTRO' || rol === 'IMPUESTO_UTILIDAD') ? otroCat :
        operativoCat
      destino.set(cat, (destino.get(cat) ?? 0) + v)
    }
  }

  // ── Serie mensual (solo meses con datos), origen BASE ──
  const serie: FilaSerie[] = [...meses.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mes, f]) => ({
      mes,
      ingresos: round2(f.ingresos),
      costo_ventas: round2(f.costo_ventas),
      gastos_operativos: round2(f.gastos_operativos),
      moneda: monedaPresentacion,
      origen: 'BASE' as const,
    }))

  // ── Desglose del período (líneas), por grupo, mayor primero ──
  const lineas: LineaDesglose[] = []
  let orden = 0
  const volcar = (grupo: LineaDesglose['grupo'], m: Map<string, number>) => {
    for (const [concepto, monto] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
      lineas.push({ grupo, concepto, monto: round2(monto), orden: orden++ })
    }
  }
  volcar('INGRESO', ingresoCat)
  volcar('COSTO_VENTAS', costoCat)
  volcar('PERSONAL', personalCat)
  volcar('GASTO_OPERATIVO', operativoCat)
  volcar('DEPRECIACION', depreciacionCat)
  volcar('OTRO', otroCat)

  // ── Tasas usadas (para imprimir "1 <presentación> = X <foránea>") ──
  const tasasUsadas: Record<string, DetalleTasa> = {}
  for (const moneda of monedasVistas) {
    const d = conversor.detalle(monedaPresentacion, moneda)
    if (d) tasasUsadas[moneda] = d
  }

  return { serie, lineas, monedasFaltantes: [...monedasFaltantes].sort(), tasasUsadas }
}
