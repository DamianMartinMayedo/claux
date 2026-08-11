// ── i18n del deck público (ES/EN) ────────────────────────────────────────────
//
// El deck puede llevar los dos idiomas dentro y el botón los intercambia EN VIVO
// (mismo enlace, sin traducir por visita: el deck es caché de por vida). El relato y
// el resumen los traduce la IA y se guardan; las etiquetas FIJAS (kickers, rótulos)
// viven aquí, y los NÚMEROS/porcentajes/fechas se reformatean al idioma activo.
//
// Regla: los textos de negocio (relato) NO se traducen aquí —eso es la IA— pero las
// ~30 etiquetas del armazón sí, porque son constantes del producto.

export type Lang = 'es' | 'en'

export const localeDe = (lang: Lang): string => (lang === 'en' ? 'en-US' : 'es-ES')

export const fmtNumL = (n: number, dec: number, lang: Lang): string =>
  new Intl.NumberFormat(localeDe(lang), { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)

// "60,0 %" en ES; "60.0%" en EN (convención de cada locale).
export const fmtPctL = (n: number, lang: Lang): string =>
  lang === 'en' ? `${n.toFixed(1)}%` : `${n.toFixed(1).replace('.', ',')} %`

export function fechaLargaL(f: string | null, lang: Lang): string {
  if (!f) return ''
  const [y, m, d] = f.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(localeDe(lang), { day: '2-digit', month: 'short', year: 'numeric' })
}

// "ago 2026" / "Aug 2026". Espeja etiquetaMes (snapshot.ts) pero con locale.
export function etiquetaMesL(mes: string, lang: Lang): string {
  const [y, m] = mes.split('-').map(Number)
  if (!y || !m) return mes
  return new Date(y, m - 1, 1).toLocaleDateString(localeDe(lang), { month: 'short', year: 'numeric' })
}

// Etiquetas del relato en inglés, por clave (las ES viven en secciones.ts).
export const ETIQUETA_SECCION_EN: Record<string, string> = {
  problema: 'The problem',
  solucion: 'The solution',
  mercado:  'The market',
  modelo:   'Business model',
  equipo:   'The team',
  cierre:   "What I'm raising",
}

export interface DeckLabels {
  kickerPortada: string
  desliza: string
  traccion: string
  ingresosPeriodo: string
  margenBruto: string
  resultadoNeto: string
  mesesRegistrados: (n: number) => string
  deCada: (moneda: string) => string
  comoSeReparte: string
  costeVentas: string
  gastosOperativos: string
  elDetalle: string
  enQueSeVa: string
  ingresos: string
  gastosPersonal: string
  otros: string
  notaDetalle: (moneda: string) => string
  evolucionProyeccion: string
  ingresosEje: (moneda: string) => string
  proyeccionMeses: string
  real: string
  proyeccionLeyenda: (pct: string) => string
  graciasTitulo: string
  hechoCon: string
}

export const DECK_LABELS: Record<Lang, DeckLabels> = {
  es: {
    kickerPortada: 'Dossier para inversores',
    desliza: 'Desliza',
    traccion: 'Tracción',
    ingresosPeriodo: 'Ingresos del período',
    margenBruto: 'Margen bruto',
    resultadoNeto: 'Resultado neto',
    mesesRegistrados: n => (n === 1 ? 'Mes registrado' : 'Meses registrados'),
    deCada: moneda => `De cada ${moneda} que entra`,
    comoSeReparte: 'Cómo se reparte',
    costeVentas: 'Coste de ventas',
    gastosOperativos: 'Gastos operativos',
    elDetalle: 'El detalle',
    enQueSeVa: 'En qué se va',
    ingresos: 'Ingresos',
    gastosPersonal: 'Gastos de personal',
    otros: 'Otros',
    notaDetalle: moneda => `Porcentajes sobre los ingresos del período · Importes en ${moneda}`,
    evolucionProyeccion: 'Evolución y proyección',
    ingresosEje: moneda => `Ingresos · ${moneda}`,
    proyeccionMeses: 'proyección +12 meses',
    real: 'Real',
    proyeccionLeyenda: pct => `Proyección (${pct} mensual) — estimación del negocio, no un resultado`,
    graciasTitulo: 'Muchas gracias',
    hechoCon: 'Hecho con CLAUX',
  },
  en: {
    kickerPortada: 'Investor deck',
    desliza: 'Scroll',
    traccion: 'Traction',
    ingresosPeriodo: 'Revenue for the period',
    margenBruto: 'Gross margin',
    resultadoNeto: 'Net result',
    mesesRegistrados: n => (n === 1 ? 'Month tracked' : 'Months tracked'),
    deCada: moneda => `Of every ${moneda} that comes in`,
    comoSeReparte: 'How it breaks down',
    costeVentas: 'Cost of sales',
    gastosOperativos: 'Operating expenses',
    elDetalle: 'The detail',
    enQueSeVa: 'Where it goes',
    ingresos: 'Revenue',
    gastosPersonal: 'Payroll',
    otros: 'Other',
    notaDetalle: moneda => `Percentages over revenue for the period · Amounts in ${moneda}`,
    evolucionProyeccion: 'Trend and projection',
    ingresosEje: moneda => `Revenue · ${moneda}`,
    proyeccionMeses: 'projection +12 months',
    real: 'Actual',
    proyeccionLeyenda: pct => `Projection (${pct} monthly) — the business's estimate, not a result`,
    graciasTitulo: 'Thank you',
    hechoCon: 'Made with CLAUX',
  },
}
