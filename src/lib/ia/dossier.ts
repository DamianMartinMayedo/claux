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
  /** Lo que el dueño YA escribió en ESTA sección/campo: no se ignora ni se
   *  sobrescribe a ciegas, se toma como punto de partida e indicación. */
  borrador?: string | null
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

  // La semilla del dueño manda: puede ser un texto a medias o una instrucción de
  // qué decir. Se respeta su intención, sus hechos y su tono; no se ignora.
  const borrador = ctx.borrador?.trim()
  const semilla = borrador
    ? `MUY IMPORTANTE: el dueño ya ha escrito esto en esta sección, como punto de partida o como indicación de qué contar y cómo. Respétalo: parte de aquí, conserva sus hechos, su intención y su tono, y devuélvelo desarrollado y bien redactado. Si es una instrucción ("di que...", "a partir de esto..."), síguela. No lo contradigas ni inventes nada que no esté aquí o en los datos: "${borrador}"`
    : ''

  const sys = [
    `Eres un asistente que ayuda al dueño de un negocio pequeño en Cuba a escribir la sección "${seccion.etiqueta}" del dossier con el que va a presentar su negocio a un posible inversor.`,
    ctx.sector ? `El negocio es del sector "${ctx.sector}" y se llama "${ctx.negocio}".` : `El negocio se llama "${ctx.negocio}".`,
    `La pregunta que se le hace al dueño es: "${seccion.pregunta}".`,
    cifras,
    otras,
    semilla,
    `Devuelves SOLO un objeto JSON con la clave: cuerpo.`,
    `cuerpo: un borrador en español de 2 a 4 frases (máx. 500 caracteres), en primera persona del plural o singular, concreto y sobrio. Nada de marketing hueco ni superlativos.`,
    `NUNCA inventes cifras, porcentajes, fechas ni nombres: si no te los he dado arriba, no los menciones. Puedes usar los datos reales que te he pasado, tal cual.`,
    `Es un BORRADOR para que el dueño lo corrija; escribe solo lo que se deduzca de lo que te he dado. No añadas texto fuera del JSON.`,
  ].filter(Boolean).join(' ')

  try {
    const { texto: out, usage } = await chat({
      mensajes: [
        { role: 'system', content: sys },
        { role: 'user', content: borrador ? `Desarrolla y mejora lo que el dueño ya escribió en la sección "${seccion.etiqueta}", siguiendo su indicación.` : `Escribe la sección "${seccion.etiqueta}".` },
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

/**
 * Resumen ejecutivo de la PORTADA: una sola línea de pitch (~120 caracteres) bajo el
 * nombre del negocio. Misma regla dura —la IA no calcula ni una cifra—; las que use
 * llegan ya calculadas por el código. Es lo primero que lee el inversor, así que se
 * pide concreta y sin marketing hueco.
 */
export async function sugerirResumenPortada(
  clientId: string,
  ctx: ContextoSeccion,
): Promise<{ linea: string | null } | null> {
  const cifras = ctx.cifras
    ? `Datos reales ya calculados (NO los recalcules): ingresos ${nf.format(ctx.cifras.ingresos)} ${ctx.moneda} en ${ctx.cifras.meses} meses; margen bruto ${ctx.cifras.margenBrutoPct.toFixed(1)} %; resultado neto ${nf.format(ctx.cifras.resultadoNeto)} ${ctx.moneda}.`
    : ''
  const otras = ctx.otras.length
    ? `Lo que ya ha escrito, para ser coherente: ${ctx.otras.map(o => `[${o.etiqueta}] ${o.cuerpo}`).join(' | ')}`
    : ''

  const borrador = ctx.borrador?.trim()
  const semilla = borrador
    ? `MUY IMPORTANTE: el dueño ya ha escrito esto como línea de portada, sea un borrador a pulir o una indicación de qué destacar. Respeta su intención, sus hechos y su tono; parte de aquí y devuélvelo mejorado, sin inventar nada que no esté aquí o en los datos: "${borrador}"`
    : ''

  const sys = [
    `Eres un asistente que ayuda al dueño de un negocio pequeño en Cuba a escribir la línea de presentación (resumen ejecutivo) que va en la portada del dossier para un inversor, justo debajo del nombre.`,
    ctx.sector ? `El negocio es del sector "${ctx.sector}" y se llama "${ctx.negocio}".` : `El negocio se llama "${ctx.negocio}".`,
    cifras,
    otras,
    semilla,
    `Devuelves SOLO un objeto JSON con la clave: linea.`,
    `linea: UNA sola frase en español, máximo 120 caracteres, que diga qué es el negocio y por qué importa. Concreta y sobria, sin superlativos ni marketing hueco, sin punto final si no hace falta.`,
    `NUNCA inventes cifras, porcentajes, fechas ni nombres: si no te los he dado arriba, no los menciones.`,
    `Es un BORRADOR para que el dueño lo corrija. No añadas texto fuera del JSON.`,
  ].filter(Boolean).join(' ')

  try {
    const { texto: out, usage } = await chat({
      mensajes: [
        { role: 'system', content: sys },
        { role: 'user', content: borrador ? `Mejora la línea de portada que el dueño ya escribió, siguiendo su indicación.` : `Escribe la línea de presentación de la portada.` },
      ],
      json: true, temperature: 0.3, maxTokens: 300, clientId,
    })
    await registrarUso(clientId, usage, true)

    const o = JSON.parse(out) as Record<string, unknown>
    const linea = (typeof o.linea === 'string' && o.linea.trim()) ? o.linea.trim().slice(0, 160) : null
    return { linea }
  } catch (e) {
    if (!(e instanceof IaNoConfigurada)) console.error('[ia] sugerirResumenPortada', e)
    return null
  }
}

/**
 * Traduce el relato + el resumen del dossier al INGLÉS, para el botón ES/EN del deck.
 * Traducción fiel: no reescribe ni adorna, respeta cifras, nombres propios y el tono.
 * Una sola llamada con todo el contenido (más barato que sección a sección).
 */
export async function traducirDossier(
  clientId: string,
  input: { resumen: string | null; secciones: { clave: string; cuerpo: string }[]; conceptos: string[] },
): Promise<{ resumen: string | null; secciones: { clave: string; cuerpo: string }[]; conceptos: { es: string; en: string }[] } | null> {
  // NO se envía `etiqueta`: es un rótulo FIJO del producto (lo pinta el deck desde
  // ETIQUETA_SECCION_EN), no contenido a traducir. Mandarlo solo tentaba al modelo a
  // colar el título dentro del `cuerpo` (p. ej. "The solution\n\n…") y a duplicar la
  // línea de sección en el deck.
  //
  // `conceptos`: los rótulos del desglose («Comida», «Alquiler»…) que pinta la slide
  // «El detalle». Se traducen en la MISMA llamada (más barato) y se emparejan por
  // POSICIÓN a la vuelta.
  const payload = {
    resumen: input.resumen ?? '',
    secciones: input.secciones.map(s => ({ clave: s.clave, cuerpo: s.cuerpo })),
    conceptos: input.conceptos,
  }

  const sys = [
    `You translate a small business's investor deck from Spanish to natural, professional English (US).`,
    `Translate FAITHFULLY: keep the meaning, tone and register; do NOT add, remove, embellish or invent anything. Keep all numbers, percentages, currencies and proper nouns exactly as they are.`,
    `Input is a JSON object with "resumen" (a one-line pitch), "secciones" (an array of {clave, cuerpo}) and "conceptos" (an array of short expense-line labels). Translate "resumen", each "cuerpo" and each string in "conceptos". Do NOT translate or change "clave".`,
    // El cuerpo puede ser una LISTA (p. ej. el equipo: una persona por línea, formato
    // "Nombre — Puesto"). El deck la parsea por líneas y por el guion, así que la
    // estructura es funcional, no cosmética.
    `Preserve the EXACT line structure of each "cuerpo": keep the same number of lines and the same line breaks. Never merge lines, add bullets, or add an introductory sentence or heading.`,
    `If a line has the form "Proper Name — Role" (em-dash), keep the proper name and the "—" separator unchanged and translate ONLY the role.`,
    `For "conceptos": return an array with the SAME length and order, each string translated (short noun labels, e.g. "Comida" → "Food").`,
    `Return ONLY a JSON object: { "resumen": string, "secciones": [{ "clave": string, "cuerpo": string }], "conceptos": string[] }. Keep the same claves and order. If a cuerpo is empty, return it empty. No text outside the JSON.`,
  ].join(' ')

  try {
    const { texto: out, usage } = await chat({
      mensajes: [
        { role: 'system', content: sys },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      json: true, temperature: 0.2, maxTokens: 2600, clientId,
    })
    await registrarUso(clientId, usage, true)

    const o = JSON.parse(out) as Record<string, unknown>
    const resumen = (typeof o.resumen === 'string' && o.resumen.trim()) ? o.resumen.trim() : null
    const arr = Array.isArray(o.secciones) ? o.secciones : []
    const secciones = arr
      .map((s): { clave: string; cuerpo: string } | null => {
        if (!s || typeof s !== 'object') return null
        const r = s as Record<string, unknown>
        if (typeof r.clave !== 'string' || typeof r.cuerpo !== 'string') return null
        return { clave: r.clave, cuerpo: r.cuerpo.trim() }
      })
      .filter((x): x is { clave: string; cuerpo: string } => x !== null)

    // Conceptos emparejados por POSICIÓN con la entrada: solo cuenta si la IA
    // devolvió una traducción no vacía para esa posición; si no, se deja sin traducir
    // (el deck cae al ES). Nunca se inventa un emparejamiento cruzado.
    const outConceptos = Array.isArray(o.conceptos) ? o.conceptos : []
    const conceptos = input.conceptos
      .map((es, i): { es: string; en: string } | null => {
        const en = outConceptos[i]
        return typeof en === 'string' && en.trim() ? { es, en: en.trim() } : null
      })
      .filter((x): x is { es: string; en: string } => x !== null)

    return { resumen, secciones, conceptos }
  } catch (e) {
    if (!(e instanceof IaNoConfigurada)) console.error('[ia] traducirDossier', e)
    return null
  }
}

export interface ContextoRevision {
  negocio: string
  sector: string | null
  moneda: string
  cifras: ContextoSeccion['cifras']
  /** Crecimiento mensual proyectado, en % (lo que enseña el gráfico del deck). */
  crecimientoPct: number
  /** Todas las secciones del relato con contenido. */
  secciones: { etiqueta: string; cuerpo: string }[]
}

/**
 * IA1 — REVISIÓN de coherencia del dossier. La IA LEE y COMENTA; NO calcula ni una
 * cifra (regla dura). Devuelve observaciones accionables: dónde el relato contradice
 * los números, si la proyección es agresiva frente al histórico, qué falta (modelo de
 * negocio, equipo…). Es una segunda lectura antes de enseñarlo, no un veredicto.
 */
export async function revisarDossier(
  clientId: string,
  ctx: ContextoRevision,
): Promise<{ observaciones: string[] } | null> {
  const cifras = ctx.cifras
    ? `Cifras reales ya calculadas (NO las recalcules, tómalas como verdad): ingresos ${nf.format(ctx.cifras.ingresos)} ${ctx.moneda} en ${ctx.cifras.meses} meses; margen bruto ${ctx.cifras.margenBrutoPct.toFixed(1)} %; resultado neto ${nf.format(ctx.cifras.resultadoNeto)} ${ctx.moneda}.`
    : 'El dossier todavía no tiene números.'
  const proy = `Proyección de ingresos en el deck: ${ctx.crecimientoPct.toFixed(1)} % mensual.`
  const relato = ctx.secciones.length
    ? ctx.secciones.map(s => `[${s.etiqueta}] ${s.cuerpo}`).join(' | ')
    : 'No ha escrito ninguna sección del relato.'

  const sys = [
    `Eres un asesor que revisa el dossier con el que el dueño de un negocio pequeño en Cuba va a presentarse a un inversor. Tu trabajo es darle una SEGUNDA LECTURA crítica pero constructiva ANTES de enseñarlo.`,
    ctx.sector ? `El negocio es del sector "${ctx.sector}" y se llama "${ctx.negocio}".` : `El negocio se llama "${ctx.negocio}".`,
    cifras,
    proy,
    `Lo que ha escrito en el relato: ${relato}`,
    `Busca: (1) dónde el relato CONTRADICE los números o promete algo que las cifras no sostienen; (2) si la proyección parece agresiva frente al histórico; (3) qué le FALTA a un dossier de inversión (modelo de negocio, uso de fondos, equipo, mercado) y no está; (4) frases vagas o de marketing hueco que un inversor descartaría.`,
    `NO calcules ni inventes cifras: usa solo las que te he dado. Si algo está bien, no te lo inventes como problema.`,
    `Devuelves SOLO un objeto JSON con la clave: observaciones, un array de 2 a 5 strings. Cada string es una observación concreta y accionable en español, máximo 200 caracteres, en tono cercano y directo (tuteo). Si el dossier está sólido, dilo y señala 1-2 detalles menores.`,
  ].filter(Boolean).join(' ')

  try {
    const { texto: out, usage } = await chat({
      mensajes: [
        { role: 'system', content: sys },
        { role: 'user', content: `Revisa el dossier y dame tus observaciones.` },
      ],
      json: true, temperature: 0.3, maxTokens: 900, clientId,
    })
    await registrarUso(clientId, usage, true)

    const o = JSON.parse(out) as Record<string, unknown>
    const arr = Array.isArray(o.observaciones) ? o.observaciones : []
    const observaciones = arr
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map(x => x.trim().slice(0, 240))
      .slice(0, 6)
    return { observaciones }
  } catch (e) {
    if (!(e instanceof IaNoConfigurada)) console.error('[ia] revisarDossier', e)
    return null
  }
}
