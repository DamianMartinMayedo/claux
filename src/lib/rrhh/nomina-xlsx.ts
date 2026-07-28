// ── Exportación de una nómina a Excel — server-only ───────────────────────────
//
// Reutiliza `lib/exportar/excel.ts`, el mismo escritor que usan las plantillas del
// importador y los reportes financieros. NO se usa SheetJS: sería una segunda
// librería de Excel en el proyecto, viviría en el bundle del cliente y rompería la
// regla de descargas directas. El CSV se retiró en su día precisamente para llegar
// aquí — en CSV los importes viajan como texto y el asesor no puede sumarlos sin
// reescribir la columna.
//
// Dos formatos, porque las dos nóminas responden preguntas distintas:
//   · MIPYME_CUBA → el desglose fiscal completo, que es lo que se presenta
//   · General     → lo que el modelo general de verdad calcula, sin inventar columnas
//
// Las columnas de datos personales (documento, cargo, cuenta bancaria) se incluyen
// SOLO si algún trabajador las tiene: una columna entera vacía no informa de nada y
// hace el archivo más difícil de leer.

import {
  construirXlsxBase64, texto, numero, anchoPara, MARCA,
  type CeldaEstilo, type HojaExcel,
} from '@/lib/exportar/excel'
import { NOMBRE_CONCEPTO_FISCAL, type ConceptoFiscal } from '@/lib/rrhh/nomina-cuba'

const CABECERA: CeldaEstilo = {
  fontWeight:      'bold',
  color:           MARCA.blanco,
  backgroundColor: MARCA.teal,
  align:           'center',
  wrap:            true,
}
const MONEDA_FMT = '#,##0.00'

export interface LineaExport {
  empleado_nombre: string
  documento:       string | null
  cargo:           string | null
  salario_base:    number
  devengado:       number
  deducciones:     number
  neto:            number
  vacaciones_acumuladas_periodo: number
  vacaciones_pagadas_periodo:    number
  subsidios:       number
  /** Importe por concepto fiscal, para las columnas del formato cubano. */
  porConcepto:     Partial<Record<ConceptoFiscal, number>>
}

export interface NominaExport {
  periodo:  string
  moneda:   string
  empresa:  string
  estado:   string
  esCuba:   boolean
  lineas:   LineaExport[]
}

/** «Enero 2026» a partir de 'YYYY-MM'. */
function mesLargo(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number)
  if (!y || !m) return periodo
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export async function nominaAXlsx(nom: NominaExport): Promise<{ base64: string; nombre: string }> {
  const hayDocumento = nom.lineas.some(l => !!l.documento)
  const hayCargo     = nom.lineas.some(l => !!l.cargo)

  // Cada columna: cabecera + cómo se saca de la línea. Definirlas juntas evita el
  // clásico desajuste de una cabecera que ya no corresponde a su dato.
  type Col = { cab: string; val: (l: LineaExport) => string | number | null; num?: boolean }
  const cols: Col[] = [{ cab: 'Trabajador', val: l => l.empleado_nombre }]
  if (hayDocumento) cols.push({ cab: 'Documento', val: l => l.documento })
  if (hayCargo)     cols.push({ cab: 'Cargo',     val: l => l.cargo })

  cols.push({ cab: 'Salario básico', val: l => l.salario_base, num: true })

  if (nom.esCuba) {
    cols.push(
      { cab: 'Vacaciones acumuladas', val: l => l.vacaciones_acumuladas_periodo, num: true },
      { cab: 'Vacaciones pagadas',    val: l => l.vacaciones_pagadas_periodo,    num: true },
      { cab: 'Total devengado',       val: l => l.devengado,                     num: true },
      { cab: 'Subsidios',             val: l => l.subsidios,                     num: true },
      { cab: NOMBRE_CONCEPTO_FISCAL.CESS, val: l => l.porConcepto.CESS ?? 0,     num: true },
      { cab: NOMBRE_CONCEPTO_FISCAL.IRPF, val: l => l.porConcepto.IRPF ?? 0,     num: true },
      { cab: 'Total retenciones',     val: l => l.deducciones,                   num: true },
      { cab: 'Neto a pagar',          val: l => l.neto,                          num: true },
      { cab: NOMBRE_CONCEPTO_FISCAL.IUFT,           val: l => l.porConcepto.IUFT ?? 0,           num: true },
      { cab: NOMBRE_CONCEPTO_FISCAL.SS_EMPRESA_125, val: l => l.porConcepto.SS_EMPRESA_125 ?? 0, num: true },
      { cab: NOMBRE_CONCEPTO_FISCAL.SS_EMPRESA_15,  val: l => l.porConcepto.SS_EMPRESA_15 ?? 0,  num: true },
    )
  } else {
    // El modelo general no calcula desglose fiscal, así que no se pintan columnas
    // que estarían siempre a cero: un cero se lee como «no le retuvieron nada».
    cols.push(
      { cab: 'Devengado',   val: l => l.devengado,   num: true },
      { cab: 'Deducciones', val: l => l.deducciones, num: true },
      { cab: 'Neto',        val: l => l.neto,        num: true },
    )
  }

  const filas = [
    cols.map(c => texto(c.cab, CABECERA)),
    ...nom.lineas.map(l => cols.map(c =>
      c.num ? numero(Number(c.val(l) ?? 0), { format: MONEDA_FMT })
            : texto(String(c.val(l) ?? '')))),
  ]

  // Fila de totales: es lo primero que mira quien recibe el archivo.
  filas.push(cols.map((c, i) => {
    if (i === 0) return texto('TOTAL', { fontWeight: 'bold' })
    if (!c.num)  return texto('')
    const suma = nom.lineas.reduce((s, l) => s + Number(c.val(l) ?? 0), 0)
    return numero(suma, { format: MONEDA_FMT, fontWeight: 'bold' })
  }))

  const hoja: HojaExcel = {
    nombre:   mesLargo(nom.periodo).slice(0, 31),   // Excel corta el nombre de hoja a 31
    filas,
    columnas: cols.map(c => ({ width: anchoPara(c.cab) })),
  }

  const base64 = await construirXlsxBase64([hoja])
  const limpio = nom.empresa.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')
  return { base64, nombre: `Nomina-${limpio}-${nom.periodo}.xlsx` }
}
