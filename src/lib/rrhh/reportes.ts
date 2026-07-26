// ── Agregación de los reportes de personal — lógica PURA, sin I/O ───────────
//
// Vivía entera dentro de `rrhh-reportes/ReportesView.tsx`, en `useMemo`s. Sale
// aquí porque el Excel se genera en SERVIDOR (el escritor de .xlsx es server-only)
// y necesita exactamente las mismas cifras: dejarla en la vista habría obligado a
// reimplementar plantilla, altas, bajas y coste por departamento en el otro lado
// — dos implementaciones del mismo número, que es como el informe de pantalla y
// el archivo acaban discrepando sin que nadie sepa cuál mira.

export interface EmpleadoRrhh {
  empleado_id: string
  empresa_id:  string
  estado:      string
  departamento?: string | null
  fecha_alta?:  string | null
  fecha_baja?:  string | null
}

export interface NominaRrhh {
  empresa_id: string
  estado:     string
  periodo:    string
  moneda:     string
  total:      number
  lineas:     { empleado_id: string; neto: number }[]
}

export interface MontoMoneda { moneda: string; monto: number }

export interface ReportesRrhh {
  plantilla:   number
  altas:       number
  bajas:       number
  costeAnual:  MontoMoneda[]
  costePorMes: { periodo: string; monedas: MontoMoneda[] }[]
  porDepto:    { departamento: string; activos: number; coste: MontoMoneda[] }[]
  porEmpresa:  { empresa_id: string; nombre: string; activos: number; coste: MontoMoneda[] }[]
}

const SIN_DEPTO = 'Sin departamento'

/** Suma por moneda. Distintas monedas NO se suman en un único número. */
export function porMoneda(entries: MontoMoneda[]): MontoMoneda[] {
  const m = new Map<string, number>()
  for (const e of entries) m.set(e.moneda, (m.get(e.moneda) ?? 0) + e.monto)
  return Array.from(m.entries())
    .map(([moneda, monto]) => ({ moneda, monto }))
    .sort((a, b) => a.moneda.localeCompare(b.moneda))
}

/** Años con nóminas, más el actual, de más reciente a más antiguo. */
export function aniosDisponibles(nominas: { periodo: string }[], anioActual: string): string[] {
  const set = new Set<string>([anioActual])
  for (const n of nominas) if (n.periodo) set.add(n.periodo.slice(0, 4))
  return Array.from(set).sort((a, b) => b.localeCompare(a))
}

export function construirReportesRrhh(
  empleadosTodos: EmpleadoRrhh[],
  nominasTodas: NominaRrhh[],
  empresas: { empresa_id: string; nombre: string }[],
  filtro: { empresaId: string; anio: string },
): ReportesRrhh {
  const { empresaId, anio } = filtro

  // El departamento se resuelve sobre TODA la plantilla, no sobre la filtrada:
  // una nómina puede tener una línea de alguien que ya causó baja o que está en
  // otra empresa, y sin su departamento ese coste caería en «Sin departamento».
  const deptoDe = new Map<string, string>()
  for (const e of empleadosTodos) deptoDe.set(e.empleado_id, e.departamento || SIN_DEPTO)

  const empleados = empleadosTodos.filter(e => !empresaId || e.empresa_id === empresaId)
  const nominas   = nominasTodas.filter(n =>
    (!empresaId || n.empresa_id === empresaId) &&
    n.estado === 'CONFIRMADA' &&
    n.periodo.startsWith(anio))

  const plantilla = empleados.filter(e => e.estado === 'ACTIVO').length
  const altas     = empleados.filter(e => e.fecha_alta?.slice(0, 4) === anio).length
  const bajas     = empleados.filter(e => e.fecha_baja && e.fecha_baja.slice(0, 4) === anio).length

  const costeAnual = porMoneda(nominas.map(n => ({ moneda: n.moneda, monto: n.total })))

  const porPeriodo = new Map<string, MontoMoneda[]>()
  for (const n of nominas) {
    const arr = porPeriodo.get(n.periodo) ?? []
    arr.push({ moneda: n.moneda, monto: n.total })
    porPeriodo.set(n.periodo, arr)
  }
  const costePorMes = Array.from(porPeriodo.entries())
    .map(([periodo, e]) => ({ periodo, monedas: porMoneda(e) }))
    .sort((a, b) => b.periodo.localeCompare(a.periodo))

  const headcount = new Map<string, number>()
  for (const e of empleados) {
    if (e.estado !== 'ACTIVO') continue
    const d = e.departamento || SIN_DEPTO
    headcount.set(d, (headcount.get(d) ?? 0) + 1)
  }
  const costeDepto = new Map<string, MontoMoneda[]>()
  for (const n of nominas) {
    for (const l of n.lineas) {
      const d = deptoDe.get(l.empleado_id) ?? SIN_DEPTO
      const arr = costeDepto.get(d) ?? []
      arr.push({ moneda: n.moneda, monto: l.neto })
      costeDepto.set(d, arr)
    }
  }
  const porDepto = Array.from(new Set<string>([...headcount.keys(), ...costeDepto.keys()]))
    .sort()
    .map(d => ({ departamento: d, activos: headcount.get(d) ?? 0, coste: porMoneda(costeDepto.get(d) ?? []) }))

  // Desglose por empresa SOLO en la vista consolidada: con una empresa filtrada
  // sería la misma cifra otra vez.
  const porEmpresa = empresaId ? [] : empresas
    .map(emp => ({
      empresa_id: emp.empresa_id,
      nombre:     emp.nombre,
      activos:    empleadosTodos.filter(e => e.empresa_id === emp.empresa_id && e.estado === 'ACTIVO').length,
      coste:      porMoneda(
        nominasTodas
          .filter(n => n.empresa_id === emp.empresa_id && n.estado === 'CONFIRMADA' && n.periodo.startsWith(anio))
          .map(n => ({ moneda: n.moneda, monto: n.total })),
      ),
    }))
    .filter(e => e.activos > 0 || e.coste.length > 0)

  return { plantilla, altas, bajas, costeAnual, costePorMes, porDepto, porEmpresa }
}

/** «Enero 2026» a partir de un período 'YYYY-MM'. */
export function formatMesRrhh(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number)
  if (!y || !m) return periodo
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
