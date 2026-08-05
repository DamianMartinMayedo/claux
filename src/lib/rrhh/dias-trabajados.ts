// ── Sugerencia de DÍAS TRABAJADOS — lógica PURA, sin I/O ──────────────────────
//
// Bajo `MIPYME_CUBA`, `dias_trabajados` es un campo que el dueño teclea persona a
// persona y del que cuelga TODO el bloque fiscal: el IRPF, la CESS, el IUFT, la
// Contribución SS y la acumulación de vacaciones se calculan sobre el devengado, y el
// devengado sale de prorratear el salario por esos días. Hasta ahora nada lo calculaba,
// y había dos sitios donde el sistema ya sabía la respuesta:
//
//   · ALTA o BAJA dentro del período. `crearNomina` mete a propósito a quien trabajó
//     parte del mes (mig. anterior a esto), pero deja `dias_trabajados` en NULL, que el
//     motor lee como «mes completo». Quien entró el 20 o causó baja el 5 **cobraba el
//     mes entero**, con todo su bloque fiscal inflado, salvo que el dueño se acordara de
//     abrir su ficha. Era una carencia ya levantada (`nomina-plan-completo.md`, punto 10).
//   · LA SEMANA TIPO de Turnos. La rejilla sabe qué días tiene asignados y cuáles son
//     descanso; multiplicarlo por las veces que cae cada día en el mes es aritmética.
//
// UN SOLO MECANISMO PARA LOS DOS, y a propósito: son la misma pregunta —«¿cuántos días
// le tocaban este mes?»— con dos fuentes. Dos features habrían sido dos formas de
// rellenar el mismo campo y dos sitios donde equivocarse.
//
// **SUGIERE, NO DECIDE.** El resultado se ofrece con un botón y el dueño acepta o
// corrige. Es dinero de una persona concreta y el criterio —si se le pagan los festivos,
// si hubo preaviso— es del negocio, no del software. Y la rejilla es una SEMANA TIPO,
// no un registro de asistencia: dice lo que estaba planificado, no lo que pasó.

export type MotivoSugerencia = 'ALTA' | 'BAJA' | 'TURNOS'

export interface SugerenciaDias {
  /** Días trabajados propuestos, en la misma unidad que `dias_laborables`. */
  dias:        number
  motivo:      MotivoSugerencia
  /** Frase corta para el aviso y para el `title` de la celda. */
  explicacion: string
}

export interface EntradaSugerencia {
  /** 'YYYY-MM'. */
  periodo:         string
  fecha_alta:      string | null
  fecha_baja:      string | null
  /** Los del trabajador (o los de su empresa): lo que vale un mes completo para él. */
  dias_laborables: number
  /**
   * Su semana tipo: siete posiciones, índice 0 = LUNES, `true` si ese día cuenta como
   * trabajado (o sea: tiene turno asignado y ese turno no es de descanso). Sin rejilla
   * se omite, y entonces el prorrateo va por días naturales.
   */
  semana?:         boolean[]
}

/** Último día del mes de un período 'YYYY-MM'. */
function ultimoDia(periodo: string): number {
  const [y, m] = periodo.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** Día de la semana con LUNES = 0, para indexar `semana`. */
function indiceSemana(y: number, m: number, d: number): number {
  return (new Date(y, m - 1, d).getDay() + 6) % 7
}

function redondear1(n: number): number { return Math.round(n * 10) / 10 }

function fmtDia(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  return `${d} de ${MESES[m - 1] ?? ''}`
}

/**
 * Días que le tocaban a esta persona en este período, o `null` si no hay nada que
 * sugerir (trabajó el mes entero y no hay rejilla que diga otra cosa).
 *
 * La prioridad es **alta/baja sobre turnos**: si alguien causó baja el día 5, da igual
 * lo que diga el cuadrante.
 */
export function sugerirDiasTrabajados(e: EntradaSugerencia): SugerenciaDias | null {
  if (!/^\d{4}-\d{2}$/.test(e.periodo)) return null
  const [y, m]   = e.periodo.split('-').map(Number)
  const finMes   = ultimoDia(e.periodo)
  const inicioISO = `${e.periodo}-01`
  const finISO    = `${e.periodo}-${String(finMes).padStart(2, '0')}`

  // El tramo del mes en el que esta persona estuvo de alta.
  const alta = e.fecha_alta ? e.fecha_alta.slice(0, 10) : null
  const baja = e.fecha_baja ? e.fecha_baja.slice(0, 10) : null
  const desde = alta && alta > inicioISO ? alta : inicioISO
  const hasta = baja && baja < finISO    ? baja : finISO
  // Alta posterior al mes, o baja anterior: no le tocaba ningún día. No debería llegar
  // aquí (`crearNomina` no lo incluiría), pero devolver 0 es más honesto que ignorarlo.
  if (desde > hasta) {
    return { dias: 0, motivo: baja ? 'BAJA' : 'ALTA',
             explicacion: 'No estuvo de alta durante este mes.' }
  }

  const parcial = desde !== inicioISO || hasta !== finISO
  const dDesde  = Number(desde.slice(8, 10))
  const dHasta  = Number(hasta.slice(8, 10))

  // ── Con rejilla: se cuentan los días asignados que caen dentro del tramo ──────
  // Vale para los dos casos a la vez: el mes completo y el mes partido por un alta o
  // una baja. Es la misma cuenta, con distintos límites.
  const usaSemana = Array.isArray(e.semana) && e.semana.some(Boolean)
  if (usaSemana) {
    let dias = 0
    for (let d = dDesde; d <= dHasta; d++) {
      if (e.semana![indiceSemana(y, m, d)]) dias++
    }
    // Si el cuadrante da exactamente lo que ya vale un mes completo y además no hubo
    // alta ni baja, no hay nada que sugerir: el aviso solo sale si hay desfase real.
    if (!parcial && Math.abs(dias - e.dias_laborables) < 0.05) return null
    if (parcial) {
      return {
        dias, motivo: baja && baja <= finISO && baja >= inicioISO ? 'BAJA' : 'ALTA',
        explicacion: baja && baja >= inicioISO && baja <= finISO
          ? `Causó baja el ${fmtDia(baja)}: según sus turnos le tocaban ${dias} días.`
          : `Entró el ${fmtDia(desde)}: según sus turnos le tocaban ${dias} días.`,
      }
    }
    return { dias, motivo: 'TURNOS', explicacion: `Según sus turnos le tocaban ${dias} días este mes.` }
  }

  // ── Sin rejilla: prorrateo por días naturales ─────────────────────────────────
  // Solo tiene sentido si el mes está partido; con el mes entero no hay nada que decir.
  if (!parcial) return null
  const naturales = dHasta - dDesde + 1
  const dias = redondear1(e.dias_laborables * (naturales / finMes))
  return baja && baja >= inicioISO && baja <= finISO
    ? { dias, motivo: 'BAJA',
        explicacion: `Causó baja el ${fmtDia(baja)}: trabajó ${naturales} de ${finMes} días.` }
    : { dias, motivo: 'ALTA',
        explicacion: `Entró el ${fmtDia(desde)}: trabajó ${naturales} de ${finMes} días.` }
}
