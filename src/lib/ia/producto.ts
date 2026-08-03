// ── IA de cara al DUEÑO para Productos y Servicios ──
// Asiste al dueño a rellenar la ficha de un producto/servicio de su catálogo
// interno. Igual que catalogo.ts/telegram.ts: la IA SOLO propone (JSON); el dueño lo
// revisa y guarda. Sin addon o si el proveedor falla, devuelve null y la UI sigue
// como llenado manual (coste cero).
//
// UNA sola llamada para descripción + unidad + categoría, no tres: el addon tiene
// tope blando (~500 conversaciones/mes) y gastar tres donde cabe una es quemarle la
// cuota al cliente.
//
// Las dos listas son CERRADAS y las pone el código, nunca el modelo:
//   · la unidad tiene que ser una de las del selector;
//   · la categoría tiene que ser una de las del CLIENTE, y se verifica que exista
//     antes de preseleccionarla. La IA no crea categorías.

import { chat, IaNoConfigurada } from './provider'
import { registrarUso } from './uso'

export interface SugerenciaProducto {
  descripcion:  string | null
  unidad:       string | null
  categoria_id: string | null
  /** Solo servicios: si se presta por suscripción y con qué ciclo. */
  es_suscribible: boolean | null
  periodicidad:   string | null
}

/** Lista CERRADA, como la de unidades: el modelo no puede inventarse un ciclo. */
const PERIODICIDADES_IA = ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL']

export async function sugerirDatosProducto(
  clientId: string,
  nombre: string,
  esServicio: boolean,
  sector: string | null,
  unidades: string[],
  categorias: { categoria_id: string; nombre: string }[],
): Promise<SugerenciaProducto | null> {
  const que = esServicio ? 'servicio' : 'producto'
  const contexto = sector ? `El negocio es del sector "${sector}".` : ''
  const listaCat = categorias.map(c => `${c.categoria_id}=${c.nombre}`).join(' | ')

  const sys = [
    `Eres un asistente que ayuda al dueño de un negocio a rellenar la ficha de un ${que} de su catálogo.`,
    contexto,
    `Dado el NOMBRE, devuelves SOLO un objeto JSON con las claves: descripcion, unidad, categoria_id${esServicio ? ', es_suscribible, periodicidad' : ''}.`,
    `descripcion: una frase breve, clara y comercial en español (máx. 160 caracteres); null si no puedes.`,
    `unidad: EXACTAMENTE una de esta lista, copiada tal cual, o null si ninguna encaja: ${unidades.join(', ')}.`,
    categorias.length
      ? `categoria_id: EXACTAMENTE uno de los identificadores de esta lista (formato id=nombre), o null si ninguna encaja: ${listaCat}. No inventes identificadores ni categorías nuevas.`
      : `categoria_id: null (este negocio todavía no tiene categorías).`,
    esServicio
      ? `es_suscribible: true solo si es un servicio que se cobra de forma RECURRENTE (mantenimiento, soporte, membresía, cuota, alquiler); false si es un trabajo puntual. periodicidad: EXACTAMENTE una de ${PERIODICIDADES_IA.join(', ')} si es_suscribible es true, o null.`
      : '',
    `Son SUGERENCIAS para que el dueño las revise. No añadas texto fuera del JSON.`,
  ].filter(Boolean).join(' ')

  try {
    const { texto: out, usage } = await chat({
      mensajes: [{ role: 'system', content: sys }, { role: 'user', content: `Nombre: ${nombre}` }],
      json: true, temperature: 0.3, maxTokens: 500, clientId,
    })
    await registrarUso(clientId, usage, true)

    const o = JSON.parse(out) as Record<string, unknown>
    const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

    // Se VERIFICA lo que devuelve: una unidad inventada rompería el selector y un
    // categoria_id inventado guardaría una referencia a nada.
    const unidad = s(o.unidad)
    const cat    = s(o.categoria_id)
    // La periodicidad se verifica igual que la unidad: un valor inventado rompería el
    // selector y, peor, se guardaría como ciclo de cobro.
    const per = s(o.periodicidad)
    return {
      descripcion:  s(o.descripcion),
      unidad:       unidad && unidades.includes(unidad) ? unidad : null,
      categoria_id: cat && categorias.some(c => c.categoria_id === cat) ? cat : null,
      es_suscribible: esServicio && o.es_suscribible === true ? true : esServicio ? false : null,
      periodicidad:   esServicio && per && PERIODICIDADES_IA.includes(per) ? per : null,
    }
  } catch (e) {
    if (!(e instanceof IaNoConfigurada)) console.error('[ia] sugerirDatosProducto', e)
    return null
  }
}
