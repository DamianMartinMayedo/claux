// ── Snapshot desde la base contable (server-only) ───────────────────────────
//
// Construye la serie mensual + el desglose del período del dossier LEYENDO la
// base, para el cliente que tiene el módulo `base`. NO usa obtenerReportes:
// esa función da buckets por moneda de UN período (12 meses = 12 llamadas, sin
// serie mensual ni split de coste de ventas). Reutiliza sus REGLAS, no su código:
//   · Ingreso devengado: facturas EMITIDA|COBRADA por fecha_emision.
//   · Ingreso directo:   gastos_cobros COBRO por fecha.
//   · Gasto:             gastos_cobros GASTO por fecha; se parte en coste de
//                        ventas vs. operativo según dossier_costo_ventas.
// Todo se convierte a la moneda de presentación; lo que no tiene tasa se excluye
// y se informa en monedasFaltantes (deck y PDF lo imprimen).

import { createAdminClient } from '@/lib/supabase/admin'
import { ESTADOS_FACTURA_INGRESO } from '@/lib/contabilidad'
import { construirConversor, type DetalleTasa } from '@/lib/tasas'
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
  costoVentas: Map<string, boolean>,
): Promise<SnapshotBase> {
  const ids = empresaIds.length ? empresaIds : ['__none__']

  const [conversor, facRes, gcRes] = await Promise.all([
    construirConversor(db, clientId),
    db.from('facturas').select('moneda, total, fecha_emision')
      .eq('client_id', clientId).in('empresa_id', ids)
      .in('estado', ESTADOS_FACTURA_INGRESO)
      .gte('fecha_emision', desde).lte('fecha_emision', hasta),
    db.from('gastos_cobros').select('tipo, moneda, monto, categoria, fecha')
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
  for (const g of (gcRes.data ?? []) as { tipo: string; moneda: string; monto: number; categoria: string | null; fecha: string }[]) {
    const v = conv(g.monto, g.moneda)
    if (v == null || !g.fecha) continue
    const mes = getMes(g.fecha.slice(0, 7))
    const cat = g.categoria || 'Sin categoría'
    if (g.tipo === 'COBRO') {
      mes.ingresos += v
      const concepto = g.categoria ? cat : 'Otros ingresos'
      ingresoCat.set(concepto, (ingresoCat.get(concepto) ?? 0) + v)
    } else if (costoVentas.get(cat) === true) {
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
