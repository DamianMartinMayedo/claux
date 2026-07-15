// ── IA de cara al DUEÑO para el Dossier del negocio ──
// Ayuda a redactar UNA sección del relato. Mismo contrato que catalogo.ts: la IA
// SOLO propone texto (JSON), el dueño lo revisa y guarda; sin addon o si el
// proveedor falla, devuelve null y la sección se escribe a mano (coste cero).
//
// REGLA DURA: la IA no calcula NI UN NÚMERO. Las cifras llegan al prompt YA
// CALCULADAS por el código (estadoDeResultados) y la IA solo las redacta. Un
// modelo estimando el margen de un paladar y un inversor comprobándolo contra el
// estado de resultados de al lado es la forma más rápida de perder el trato — y
// el dossier existe justamente para no perderlo.

import { chat, IaNoConfigurada } from './provider'
import { registrarUso } from './uso'
import type { EspecSeccion } from '@/lib/dossier/secciones'

export interface SugerenciaSeccion {
  cuerpo: string | null
}

export interface ContextoSeccion {
  negocio: string
  sector: string | null
  moneda: string
  /** Cifras ya calculadas por el código; null si el dossier aún no tiene números. */
  cifras: {
    ingresos: number
    margenBrutoPct: number
    resultadoNeto: number
    meses: number
  } | null
  /** Lo que el dueño ya escribió en otras secciones, para no contradecirle. */
  otras: { etiqueta: string; cuerpo: string }[]
}

const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })

export async function sugerirSeccionDossier(
  clientId: string,
  seccion: EspecSeccion,
  ctx: ContextoSeccion,
): Promise<SugerenciaSeccion | null> {
  // Las cifras van al prompt como DATO, nunca como algo a deducir.
  const cifras = ctx.cifras
    ? `Datos reales ya calculados de su negocio (NO los recalcules, NO los cambies): ingresos totales ${nf.format(ctx.cifras.ingresos)} ${ctx.moneda} en ${ctx.cifras.meses} meses; margen bruto ${ctx.cifras.margenBrutoPct.toFixed(1)} %; resultado neto ${nf.format(ctx.cifras.resultadoNeto)} ${ctx.moneda}.`
    : ''

  const otras = ctx.otras.length
    ? `Esto ya lo ha escrito él en otras secciones; sé coherente y no lo repitas: ${ctx.otras.map(o => `[${o.etiqueta}] ${o.cuerpo}`).join(' | ')}`
    : ''

  const sys = [
    `Eres un asistente que ayuda al dueño de un negocio pequeño en Cuba a escribir la sección "${seccion.etiqueta}" del dossier con el que va a presentar su negocio a un posible inversor.`,
    ctx.sector ? `El negocio es del sector "${ctx.sector}" y se llama "${ctx.negocio}".` : `El negocio se llama "${ctx.negocio}".`,
    `La pregunta que se le hace al dueño es: "${seccion.pregunta}".`,
    cifras,
    otras,
    `Devuelves SOLO un objeto JSON con la clave: cuerpo.`,
    `cuerpo: un borrador en español de 2 a 4 frases (máx. 500 caracteres), en primera persona del plural o singular, concreto y sobrio. Nada de marketing hueco ni superlativos.`,
    `NUNCA inventes cifras, porcentajes, fechas ni nombres: si no te los he dado arriba, no los menciones. Puedes usar los datos reales que te he pasado, tal cual.`,
    `Es un BORRADOR para que el dueño lo corrija; escribe solo lo que se deduzca de lo que te he dado. No añadas texto fuera del JSON.`,
  ].filter(Boolean).join(' ')

  try {
    const { texto: out, usage } = await chat({
      mensajes: [
        { role: 'system', content: sys },
        { role: 'user', content: `Escribe la sección "${seccion.etiqueta}".` },
      ],
      json: true, temperature: 0.2, maxTokens: 700, clientId,
    })
    // Manual y a propósito: si se olvida, el consumo es invisible y el tope de
    // ~500 conv/mes infra-cuenta en silencio.
    await registrarUso(clientId, usage, true)

    const o = JSON.parse(out) as Record<string, unknown>
    const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
    return { cuerpo: s(o.cuerpo) }
  } catch (e) {
    if (!(e instanceof IaNoConfigurada)) console.error('[ia] sugerirSeccionDossier', e)
    return null
  }
}
