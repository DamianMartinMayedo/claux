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
import { cobroEsIngreso, fuenteDeCobro } from '@/lib/gastos-core'
import { construirConversor, type DetalleTasa } from '@/lib/tasas'
import { indexarCategorias, type CategoriaPL } from '@/lib/pl/estado'
import type { FilaSerie } from './snapshot'

export interface LineaDesglose {
  grupo: 'INGRESO' | 'COSTO_VENTAS' | 'GASTO_OPERATIVO'
  concepto: string
  monto: number
  orden: number
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
    db.from('gastos_cobros').select('tipo, moneda, monto, categoria, categoria_id, fecha, origen_tipo')
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
  // Desglose de período por (grupo, concepto).
  const ingresoCat = new Map<string, number>()      // concepto → monto
  const costoCat = new Map<string, number>()
  const operativoCat = new Map<string, number>()

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
  for (const g of (gcRes.data ?? []) as { tipo: string; moneda: string; monto: number; categoria: string | null; categoria_id: string | null; fecha: string; origen_tipo: string | null }[]) {
    const v = conv(g.monto, g.moneda)
    if (v == null || !g.fecha) continue
    const mes = getMes(g.fecha.slice(0, 7))

    if (g.tipo === 'COBRO') {
      // El COBRO de un anticipo no es ingreso (`cobroEsIngreso`). Aquí importaba el
      // doble: además de inflar los ingresos, el subsidio se pintaba como una LÍNEA
      // del desglose («Subsidios por cobrar») en el documento que se le enseña a un
      // asesor o a un inversor.
      if (!cobroEsIngreso(g.origen_tipo)) continue
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

    if (raiz?.rol_pl === 'COSTE_VENTAS') {
      mes.costo_ventas += v
      costoCat.set(cat, (costoCat.get(cat) ?? 0) + v)
    } else {
      mes.gastos_operativos += v
      operativoCat.set(cat, (operativoCat.get(cat) ?? 0) + v)
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
  volcar('GASTO_OPERATIVO', operativoCat)

  // ── Tasas usadas (para imprimir "1 <presentación> = X <foránea>") ──
  const tasasUsadas: Record<string, DetalleTasa> = {}
  for (const moneda of monedasVistas) {
    const d = conversor.detalle(monedaPresentacion, moneda)
    if (d) tasasUsadas[moneda] = d
  }

  return { serie, lineas, monedasFaltantes: [...monedasFaltantes].sort(), tasasUsadas }
}
