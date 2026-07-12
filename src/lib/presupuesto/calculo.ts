// ── Cálculo puro del presupuesto de instalación (Formulario §2) ──
// Determinista, sin efectos, isomórfico (cliente + servidor). El coste de la
// suscripción mensual NO se calcula aquí: sale de modulos_catalogo (en vivo).

import {
  CAMPOS_FASE1, LINEAS_FASE2, CLAVE_BASE,
  FASE1_FIJAS, FASE3_BASE, FASE4_FIJAS, FORMACION_POR_MODULO, FORMACION_CAJA,
  TARIFA_HORA, TARIFA_HISTORICO, EXTRA_TRAMO_USD,
  type TarifaTipo, type FormatoDatos,
} from './config'

export interface InstalacionInput {
  tarifa:    TarifaTipo
  modulos:   string[]                    // claves contratadas (incluye 'base' si aplica)
  volumenes: Record<string, number>      // valores de §1.3
  formato:   FormatoDatos
  historicoHorasManual?: number          // horas de migración de histórico cargadas por el comercial
}

export interface DesgloseFase {
  fase:        string
  horas:       number
  subtotalUsd: number
  detalle?:    string
}

export interface Revision {
  linea:  string
  motivo: string
}

export interface InstalacionResultado {
  desglose:            DesgloseFase[]
  revisiones:          Revision[]
  fase1ExtraUsd:       number
  fase1Disparadores:   string[]
  horasTotal:          number
  costeInstalacionUsd: number
  tarifaHora:          number
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Nº de incrementos de $15 según cuánto excede un valor su límite (tramo). */
function tramosExcedidos(valor: number, limite: number): number {
  if (limite <= 0 || valor <= limite) return 0
  return Math.ceil(valor / limite) - 1   // 2x→1, 3x→2, 4x→3…
}

export function calcularInstalacion(input: InstalacionInput): InstalacionResultado {
  const tarifaHora = TARIFA_HORA[input.tarifa] ?? TARIFA_HORA.estandar
  const modulos = new Set(input.modulos)
  const vol = input.volumenes ?? {}
  const revisiones: Revision[] = []

  // ── Fase 1: alta y configuración base (4h fijas + extras en $) ──
  let maxTramos = 0
  const disparadores: string[] = []
  for (const c of CAMPOS_FASE1) {
    if (c.modulo && !modulos.has(c.modulo)) continue
    const t = tramosExcedidos(num(vol[c.key]), c.limite)
    if (t > 0) {
      disparadores.push(c.label)
      if (t > maxTramos) maxTramos = t
    }
  }
  const fase1ExtraUsd = maxTramos * EXTRA_TRAMO_USD

  // ── Fase 2: migración de datos (solo módulos activos) ──
  let horasFase2 = 0
  for (const l of LINEAS_FASE2) {
    if (!modulos.has(l.modulo)) continue
    const v = num(vol[l.campo])
    horasFase2 += l.horas   // las horas base siempre se cuentan
    if (v > l.limite) {
      revisiones.push({
        linea: l.label,
        motivo: input.formato === 'excel'
          ? 'Alto volumen con plantilla — confirmar horas manualmente con el comercial (las plantillas de importación masiva aún no existen).'
          : 'Excede volumen manual — cotizar horas extra a $40/h (requiere valoración del comercial).',
      })
    }
  }

  // ── Fase 3: formación (2h + adicionales por módulo; caja +2h) ──
  let horasFase3 = FASE3_BASE
  for (const clave of modulos) {
    if (clave === CLAVE_BASE) continue
    horasFase3 += clave === 'caja' ? FORMACION_CAJA : FORMACION_POR_MODULO
  }

  // ── Fase 4: validación y cierre (2h fijas) ──
  const horasFase4 = FASE4_FIJAS

  const horasTotal = FASE1_FIJAS + horasFase2 + horasFase3 + horasFase4

  const desglose: DesgloseFase[] = [
    {
      fase: 'Fase 1 · Alta y configuración base',
      horas: FASE1_FIJAS,
      subtotalUsd: FASE1_FIJAS * tarifaHora + fase1ExtraUsd,
      detalle: fase1ExtraUsd > 0 ? `Incluye +$${fase1ExtraUsd} por exceder límites (${disparadores.join(', ')}).` : undefined,
    },
    {
      fase: 'Fase 2 · Migración de datos',
      horas: horasFase2,
      subtotalUsd: horasFase2 * tarifaHora,
      detalle: revisiones.length > 0 ? `${revisiones.length} línea(s) marcada(s) para revisar.` : undefined,
    },
    {
      fase: 'Fase 3 · Formación',
      horas: horasFase3,
      subtotalUsd: horasFase3 * tarifaHora,
    },
    {
      fase: 'Fase 4 · Validación y cierre',
      horas: horasFase4,
      subtotalUsd: horasFase4 * tarifaHora,
    },
  ]

  let costeInstalacionUsd = horasTotal * tarifaHora + fase1ExtraUsd

  // ── Migración de histórico (§1.5): horas manuales del comercial a $40/h ──
  const histHoras = num(input.historicoHorasManual)
  if (histHoras > 0) {
    const subtotalHist = histHoras * TARIFA_HISTORICO
    desglose.push({
      fase: 'Migración de histórico (cotización manual)',
      horas: histHoras,
      subtotalUsd: subtotalHist,
      detalle: `${histHoras}h × $${TARIFA_HISTORICO}/h (valoración del comercial).`,
    })
    costeInstalacionUsd += subtotalHist
  }

  return {
    desglose,
    revisiones,
    fase1ExtraUsd,
    fase1Disparadores: disparadores,
    horasTotal,
    costeInstalacionUsd,
    tarifaHora,
  }
}
