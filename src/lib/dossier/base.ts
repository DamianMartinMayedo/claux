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
import { indexarCategorias, type CategoriaPL } from '@/lib/pl/estado'
import type { FilaSerie } from './snapshot'

// Grupos del desglose = los cuatro `rol_pl` (más INGRESO). La SERIE mensual sigue
// con dos cubos de gasto (coste vs. operativos); el DESGLOSE parte el operativo en
// Personal / Operativos / Otros para el waterfall del estado de resultados. Los
// nombres 'COSTO_VENTAS'/'GASTO_OPERATIVO' se conservan (ya hay filas guardadas así).
export type GrupoLinea = 'INGRESO' | 'COSTO_VENTAS' | 'PERSONAL' | 'GASTO_OPERATIVO' | 'OTRO'

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

export async function construirSnapshotDesdeBase(
  db: ReturnType<typeof createAdminClient>,
  clientId: string,
  empresaIds: string[],
  desde: string,
  hasta: string,
  monedaPresentacion: string,
  categorias: CategoriaPL[],
): Promise<SnapshotBase> {
  const ids = empresaIds.length ? empresaIds : ['__none__']
  const idx = indexarCategorias(categorias)
  const porNombreRaiz = new Map(categorias.filter(c => !c.parent_id).map(c => [c.nombre.trim().toLowerCase(), c]))

  const [conversor, facRes, gcRes] = await Promise.all([
    construirConversor(db, clientId),
    db.from('facturas').select('moneda, total, fecha_emision')
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
  const otroCat = new Map<string, number>()

  // Convierte a la moneda de presentación; null → registra la moneda como faltante.
  const conv = (monto: number, moneda: string): number | null => {
    const v = conversor.convertir(Number(monto) || 0, moneda, monedaPresentacion)
    if (v == null) { monedasFaltantes.add(moneda); return null }
    if (moneda !== monedaPresentacion) monedasVistas.add(moneda)
    return v
  }

  // ── Ingresos devengados (facturas) ──
  for (const f of (facRes.data ?? []) as { moneda: string; total: number; fecha_emision: string }[]) {
    const v = conv(f.total, f.moneda)
    if (v == null || !f.fecha_emision) continue
    getMes(f.fecha_emision.slice(0, 7)).ingresos += v
    ingresoCat.set('Ventas', (ingresoCat.get('Ventas') ?? 0) + v)
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
      const concepto = fuenteDeCobro(g.origen_tipo) === 'VENTA'
        ? 'Ventas'
        : (g.categoria?.trim() || 'Otros ingresos')
      ingresoCat.set(concepto, (ingresoCat.get(concepto) ?? 0) + v)
      continue
    }

    const fila = (g.categoria_id ? idx.porId.get(g.categoria_id) : undefined)
      ?? (g.categoria ? porNombreRaiz.get(g.categoria.trim().toLowerCase()) : undefined)
    const raiz = fila ? (idx.raizDe.get(fila.categoria_id) ?? fila) : null
    const cat  = raiz?.nombre ?? (g.categoria?.trim() || 'Sin categoría')

    const rol = raiz?.rol_pl
    if (rol === 'COSTE_VENTAS') {
      mes.costo_ventas += v
      costoCat.set(cat, (costoCat.get(cat) ?? 0) + v)
    } else {
      // La SERIE agrupa todo lo no-coste en gastos_operativos (no cambia); el
      // DESGLOSE lo parte por rol para poder enseñar Personal, Operativos y Otros
      // por separado y calcular el resultado operativo (EBIT).
      mes.gastos_operativos += v
      const destino = rol === 'PERSONAL' ? personalCat : rol === 'OTRO' ? otroCat : operativoCat
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
  volcar('OTRO', otroCat)

  // ── Tasas usadas (para imprimir "1 <presentación> = X <foránea>") ──
  const tasasUsadas: Record<string, DetalleTasa> = {}
  for (const moneda of monedasVistas) {
    const d = conversor.detalle(monedaPresentacion, moneda)
    if (d) tasasUsadas[moneda] = d
  }

  return { serie, lineas, monedasFaltantes: [...monedasFaltantes].sort(), tasasUsadas }
}
