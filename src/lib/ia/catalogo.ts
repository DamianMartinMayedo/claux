// ── IA de cara al DUEÑO para el Catálogo QR ──
// Solo asiste al dueño (nuestro cliente) a rellenar la ficha de un producto: dado
// el nombre y el tipo de negocio, sugiere descripción, ingredientes, alérgenos y
// calorías. Igual que el intérprete del bot (telegram.ts): la IA SOLO propone
// texto estructurado (JSON); el dueño lo revisa y guarda. Si no hay addon o el
// proveedor falla, devuelve null y la UI sigue como llenado manual (coste cero).
//
// NO hay chat público de clientes finales todavía (decisión de fase): eso exige
// medición/rate-limit propios de tráfico anónimo. El resumen del catálogo que
// arma contexto.ts queda diseñado como base pública-segura reutilizable para
// cuando se construya ese chat.

import { chat, IaNoConfigurada } from './provider'
import { registrarUso } from './uso'

export interface SugerenciaItem {
  descripcion:  string | null
  ingredientes: string | null
  alergenos:    string | null
  calorias:     number | null
}

export async function sugerirDatosItem(
  clientId: string,
  nombre: string,
  etiquetaCatalogo: string,
  sector: string | null,
): Promise<SugerenciaItem | null> {
  const contexto = sector ? `El negocio es del sector "${sector}".` : ''
  const sys = [
    `Eres un asistente que ayuda al dueño de un negocio a rellenar la ficha de un producto de su ${etiquetaCatalogo.toLowerCase()}.`,
    contexto,
    `Dado el NOMBRE del producto, devuelves SOLO un objeto JSON con las claves: descripcion, ingredientes, alergenos, calorias.`,
    `descripcion: una frase breve y apetecible en español (máx. 140 caracteres); null si no puedes.`,
    `ingredientes: lista corta separada por comas de ingredientes típicos; null si no aplica al tipo de producto.`,
    `alergenos: alérgenos frecuentes (gluten, lactosa, frutos secos, huevo, marisco…) separados por comas; null si no aplica.`,
    `calorias: estimación entera aproximada por ración si es un alimento; null si no aplica.`,
    `Son SUGERENCIAS estimadas para que el dueño las revise; no afirmes que son exactas. No añadas texto fuera del JSON.`,
  ].filter(Boolean).join(' ')

  try {
    const { texto: out, usage } = await chat({
      mensajes: [{ role: 'system', content: sys }, { role: 'user', content: `Nombre: ${nombre}` }],
      json: true, temperature: 0.2, maxTokens: 900, clientId,
    })
    await registrarUso(clientId, usage, true)

    const o = JSON.parse(out) as Record<string, unknown>
    const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
    const cal = Number(o.calorias)
    return {
      descripcion:  s(o.descripcion),
      ingredientes: s(o.ingredientes),
      alergenos:    s(o.alergenos),
      calorias:     Number.isFinite(cal) && cal > 0 ? Math.round(cal) : null,
    }
  } catch (e) {
    if (!(e instanceof IaNoConfigurada)) console.error('[ia] sugerirDatosItem', e)
    return null
  }
}
