// ── IA de cara al DUEÑO para la Nómina ──
//
// Dos tareas, las dos sobre datos CONCRETOS (una nómina, un recibo), así que van como
// módulo propio y no como «insight» de sección: `generarInsight` solo sabe de una
// sección entera y su contexto sale del dashboard. El precedente exacto es
// `lib/ia/producto.ts` y `lib/ia/conteo.ts` — la IA recibe los datos ya agregados por
// el servidor, y **solo propone**.
//
// REGLA DURA DE LAS DOS: la IA no escribe nada y **no puede confirmar una nómina**.
// Confirmar es lo único irreversible del módulo (crea deuda con la plantilla y con
// ONAT); lo que aporta aquí es un segundo par de ojos ANTES de ese paso.

import { chat, IaNoConfigurada } from './provider'
import { registrarUso } from './uso'

// ── R8.1 · Revisar el borrador antes de confirmar ────────────────────────────

/** Una línea del borrador con su histórico, ya agregada por el servidor. */
export interface LineaRevision {
  nombre:      string
  cargo:       string | null
  /** Devengado de ESTE período. */
  devengado:   number
  /** Retenciones de este período. */
  retenciones: number
  /** Días trabajados cargados, o null si va el mes completo. */
  dias:        number | null
  /** Devengados de los meses anteriores, del más reciente al más antiguo. */
  historico:   number[]
  /** Causó baja dentro del período: candidato a prorrateo (ver `dias-trabajados.ts`). */
  baja_en_periodo: boolean
  /** Se dio de alta dentro del período. */
  alta_en_periodo: boolean
}

export interface EntradaRevision {
  periodo:  string
  moneda:   string
  /** `MIPYME_CUBA` cambia qué es raro: ahí las retenciones a cero sí lo son. */
  modelo:   string
  lineas:   LineaRevision[]
}

/**
 * Repasa un borrador de nómina y señala lo que se sale de lo normal.
 *
 * Devuelve prosa, no JSON: es un aviso para leer, no un dato que se guarde. Si el
 * proveedor falla o no hay addon, devuelve `null` y la pantalla sigue igual — la
 * revisión es una ayuda, nunca un requisito para confirmar.
 */
export async function revisarNomina(
  clientId: string,
  entrada: EntradaRevision,
): Promise<string | null> {
  if (entrada.lineas.length === 0) return null

  const sys = [
    'Eres un asistente que repasa el BORRADOR de una nómina antes de que el dueño la confirme.',
    'Confirmar es irreversible: registra la deuda con la plantilla y con la agencia tributaria.',
    'Tu trabajo es señalar lo que se SALE DE LO NORMAL comparando cada trabajador con sus meses anteriores.',
    'Mira sobre todo: quien cobra bastante más o menos que su media sin días que lo expliquen;',
    'quien tiene retenciones a cero mientras el resto de su cargo sí las tiene;',
    'líneas con devengado cero; y quien se dio de alta o de baja dentro del mes y aun así cobra el mes completo.',
    'Si todo cuadra, dilo en una frase y no te inventes un problema.',
    'No propongas confirmar ni dar por buena la nómina: eso lo decide el dueño.',
    'Responde en español, en prosa breve, máximo 6 frases. Sin listas, sin markdown, sin tablas.',
    'Nombra a las personas concretas y di la cifra. No inventes ningún número que no esté en los datos.',
  ].join(' ')

  try {
    const { texto, usage } = await chat({
      mensajes: [
        { role: 'system', content: sys },
        { role: 'user', content: `Borrador de nómina (JSON):\n${JSON.stringify(entrada)}` },
      ],
      temperature: 0.2, maxTokens: 1200, clientId,
    })
    await registrarUso(clientId, usage, true)
    return texto.trim() || null
  } catch (e) {
    if (!(e instanceof IaNoConfigurada)) console.error('[ia] revisarNomina', e)
    return null
  }
}

// ── R8.2 · Explicar el recibo al trabajador ──────────────────────────────────

/** El desglose de un recibo, tal y como se imprime, más el mes anterior si lo hay. */
export interface EntradaRecibo {
  trabajador: string
  periodo:    string
  moneda:     string
  salario_base: number
  devengado:  number
  neto:       number
  /** Cada concepto con su signo ya resuelto: `+` suma al bruto, `−` se retiene. */
  conceptos:  { nombre: string; tipo: string; monto: number }[]
  /** Neto del mes anterior, para poder responder «¿por qué cobro menos?». */
  neto_anterior: number | null
  /** Días trabajados cargados este mes, si los hay. */
  dias: number | null
}

/**
 * Explica un recibo en lenguaje llano, para que el dueño se lo pueda leer al trabajador.
 *
 * En Cuba la nómina se explica de viva voz: esta es la conversación que el dueño tiene
 * cada mes y que hoy resuelve de memoria mirando el PDF.
 */
export async function explicarRecibo(
  clientId: string,
  entrada: EntradaRecibo,
): Promise<string | null> {
  const sys = [
    'Eres un asistente que explica una nómina a la persona que la cobra, en lenguaje llano.',
    'Te habla el dueño del negocio, que quiere poder leerle la explicación a su trabajador.',
    'Explica de dónde sale el neto: el salario del período, lo que se le suma y lo que se le retiene, con sus nombres.',
    'Si hay neto del mes anterior y la diferencia es apreciable, di POR QUÉ cambió.',
    'Las retenciones no son un descuento del negocio: son impuestos y contribuciones que se ingresan a la agencia tributaria. Dilo así, sin tecnicismos.',
    'Habla del trabajador en tercera persona («cobra», «se le retiene»), para que el dueño pueda leerlo tal cual.',
    'Responde en español, en prosa breve, máximo 6 frases. Sin listas, sin markdown, sin tablas.',
    'No inventes ninguna cifra que no esté en los datos.',
  ].join(' ')

  try {
    const { texto, usage } = await chat({
      mensajes: [
        { role: 'system', content: sys },
        { role: 'user', content: `Recibo (JSON):\n${JSON.stringify(entrada)}` },
      ],
      temperature: 0.3, maxTokens: 1000, clientId,
    })
    await registrarUso(clientId, usage, true)
    return texto.trim() || null
  } catch (e) {
    if (!(e instanceof IaNoConfigurada)) console.error('[ia] explicarRecibo', e)
    return null
  }
}
