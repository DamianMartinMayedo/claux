// ── Snapshot del dossier — lógica pura, sin I/O ─────────────────────────────
//
// Dos piezas que sostienen el módulo y merecen test:
//   · proyectar()     — la recta de crecimiento del deck (una sola palanca).
//   · fusionarSerie()  — la FUSIÓN NO DESTRUCTIVA, el fallo más caro posible.
//     resolverFusion() aplica el plan; la comparten previsualización y guardado.

export type OrigenFila = 'MANUAL' | 'BASE'

export interface FilaSerie {
  mes: string                 // 'YYYY-MM'
  ingresos: number
  costo_ventas: number
  gastos_operativos: number
  moneda: string              // ya convertida a la moneda de presentación
  origen: OrigenFila
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** 'YYYY-MM' → 'ene 2026'. Aquí porque `mes` lo define FilaSerie: rejilla, PDF y deck lo escriben igual. */
export function etiquetaMes(mes: string): string {
  const [y, m] = mes.split('-')
  return `${MESES[Number(m) - 1] ?? mes} ${y}`
}

// ── Proyección ────────────────────────────────────────────────────────────────

function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Proyecta `meses` de ingresos futuros a partir de la MEDIA de los últimos 3
 * meses (no del último: un apagón o un diciembre bueno no deben torcer la recta),
 * compuesta al `crecimientoMensualPct`. Devuelve solo los valores futuros; el
 * histórico ya lo tiene el llamante. Serie vacía → sin proyección.
 */
export function proyectar(
  serie: Array<{ ingresos: number }>,
  crecimientoMensualPct: number,
  meses: number,
): number[] {
  const ult3 = serie.slice(-3)
  if (ult3.length === 0 || meses <= 0) return []

  const base = ult3.reduce((s, f) => s + (Number(f.ingresos) || 0), 0) / ult3.length
  const factor = 1 + (Number(crecimientoMensualPct) || 0) / 100

  const out: number[] = []
  let v = base
  for (let i = 0; i < meses; i++) {
    v = v * factor
    out.push(redondear2(v))
  }
  return out
}

// ── Fusión no destructiva ───────────────────────────────────────────────────

export interface CambioFila {
  mes: string
  antes: FilaSerie
  despues: FilaSerie
}

export interface PlanFusion {
  /** Meses que la base aporta y el dossier no tiene → se añaden. */
  nuevos: FilaSerie[]
  /** Meses BASE del dossier cuyo valor cambió en la base → se actualizan. */
  cambian: CambioFila[]
  /** Meses MANUAL que la base no conoce → intactos (el mensaje "tu trabajo se conserva"). */
  conservados: FilaSerie[]
  /** Meses MANUAL para los que la base AHORA tiene datos distintos → decide el dueño. */
  conflictos: CambioFila[]
}

function mismaFila(a: FilaSerie, b: FilaSerie): boolean {
  return (
    redondear2(a.ingresos) === redondear2(b.ingresos) &&
    redondear2(a.costo_ventas) === redondear2(b.costo_ventas) &&
    redondear2(a.gastos_operativos) === redondear2(b.gastos_operativos)
  )
}

function indexar(serie: FilaSerie[]): Map<string, FilaSerie> {
  const m = new Map<string, FilaSerie>()
  for (const f of serie) m.set(f.mes, f)
  return m
}

/**
 * Calcula el plan de cambios de "actualizar desde mis datos" SIN aplicar nada.
 * Regla de oro: una fila MANUAL nunca se pisa en silencio. `entrante` son las
 * filas que trae la base (origen BASE).
 */
export function fusionarSerie(actual: FilaSerie[], entrante: FilaSerie[]): PlanFusion {
  const idxActual = indexar(actual)
  const idxEntrante = indexar(entrante)

  const plan: PlanFusion = { nuevos: [], cambian: [], conservados: [], conflictos: [] }

  for (const inc of entrante) {
    const cur = idxActual.get(inc.mes)
    if (!cur) {
      plan.nuevos.push({ ...inc, origen: 'BASE' })
    } else if (cur.origen === 'MANUAL') {
      // La base ahora conoce este mes: conflicto solo si difiere (si coincide, no hay nada que decidir).
      if (!mismaFila(cur, inc)) plan.conflictos.push({ mes: inc.mes, antes: cur, despues: { ...inc, origen: 'BASE' } })
    } else {
      // Fila BASE: se refresca si cambió.
      if (!mismaFila(cur, inc)) plan.cambian.push({ mes: inc.mes, antes: cur, despues: { ...inc, origen: 'BASE' } })
    }
  }

  // Meses MANUAL que la base no conoce → se conservan (el trabajo tecleado está a salvo).
  for (const cur of actual) {
    if (cur.origen === 'MANUAL' && !idxEntrante.has(cur.mes)) plan.conservados.push(cur)
  }

  return plan
}

/**
 * Aplica el plan y devuelve la serie final que se escribirá (vía la RPC).
 * `conflictosAceptados` = meses en los que el dueño eligió tomar el dato de la
 * base sobre el suyo manual; el resto de sus meses manuales se respetan siempre.
 */
export function resolverFusion(
  actual: FilaSerie[],
  entrante: FilaSerie[],
  conflictosAceptados: string[] = [],
): FilaSerie[] {
  const aceptados = new Set(conflictosAceptados)
  const resultado = indexar(actual)   // parte de todo lo que ya hay

  for (const inc of entrante) {
    const cur = resultado.get(inc.mes)
    if (!cur) {
      resultado.set(inc.mes, { ...inc, origen: 'BASE' })            // nuevo
    } else if (cur.origen === 'BASE') {
      resultado.set(inc.mes, { ...inc, origen: 'BASE' })            // refresco de una fila de la base
    } else if (aceptados.has(inc.mes)) {
      resultado.set(inc.mes, { ...inc, origen: 'BASE' })            // conflicto que el dueño cedió a la base
    }
    // MANUAL no aceptado → se queda como está (no se toca)
  }

  return [...resultado.values()].sort((a, b) => a.mes.localeCompare(b.mes))
}
