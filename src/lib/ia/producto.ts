// ── IA de cara al DUEÑO para Productos y Servicios ──
// Asiste al dueño a redactar la descripción de un producto/servicio de su catálogo
// interno. Igual que catalogo.ts/telegram.ts: la IA SOLO propone texto (JSON); el
// dueño lo revisa y guarda. Sin addon o si el proveedor falla, devuelve null y la
// UI sigue como llenado manual (coste cero).

import { chat, IaNoConfigurada } from './provider'
import { registrarUso } from './uso'

export async function sugerirDescripcionProducto(
  clientId: string,
  nombre: string,
  esServicio: boolean,
  sector: string | null,
): Promise<string | null> {
  const que = esServicio ? 'servicio' : 'producto'
  const contexto = sector ? `El negocio es del sector "${sector}".` : ''
  const sys = [
    `Eres un asistente que ayuda al dueño de un negocio a redactar la descripción de un ${que} de su catálogo.`,
    contexto,
    `Dado el NOMBRE, devuelves SOLO un objeto JSON con la clave "descripcion": una frase breve, clara y comercial en español (máx. 160 caracteres). Si no puedes, "descripcion": null.`,
    `Es una SUGERENCIA para que el dueño la revise. No añadas texto fuera del JSON.`,
  ].filter(Boolean).join(' ')

  try {
    const { texto: out, usage } = await chat({
      mensajes: [{ role: 'system', content: sys }, { role: 'user', content: `Nombre: ${nombre}` }],
      json: true, temperature: 0.3, maxTokens: 300, clientId,
    })
    await registrarUso(clientId, usage, true)

    const o = JSON.parse(out) as Record<string, unknown>
    const d = o.descripcion
    return (typeof d === 'string' && d.trim()) ? d.trim() : null
  } catch (e) {
    if (!(e instanceof IaNoConfigurada)) console.error('[ia] sugerirDescripcionProducto', e)
    return null
  }
}
