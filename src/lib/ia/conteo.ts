// ── IA de cara al DUEÑO: interpretar un conteo dictado ──
//
// «Quedan doce cajas de agua y tres de cerveza» → líneas de la pantalla de conteo
// precargadas. Es la variante hablada del OCR del ticket, SIN su prerrequisito: aquí
// no hay foto, así que no depende de la decisión de capacidad de Storage.
//
// LA REGLA QUE IMPORTA: el modelo devuelve TEXTO y CANTIDAD, nunca un `producto_id`.
// El emparejamiento con el catálogo lo hace el código, más abajo. Dejar que el modelo
// eligiera el id es la vía más corta a ajustar el producto equivocado — y un ajuste
// mal aplicado en un conteo es exactamente el trabajo que el conteo venía a arreglar.
//
// Nada se aplica: rellena la columna «contado» de un BORRADOR y el dueño revisa.

import { chat, IaNoConfigurada } from './provider'
import { registrarUso } from './uso'

export interface ItemDictado {
  /** Lo que dijo el dueño, tal cual: «cajas de agua». */
  texto:    string
  cantidad: number
}

export async function interpretarConteoDictado(
  clientId: string,
  dictado: string,
): Promise<ItemDictado[] | null> {
  const sys = [
    'Eres un asistente que convierte en datos lo que el dueño de un negocio dicta al contar sus existencias.',
    'Devuelves SOLO un objeto JSON con la clave "items": una lista de objetos {texto, cantidad}.',
    '"texto" es el nombre del producto tal y como lo dijo (sin la cantidad, sin artículos).',
    '"cantidad" es un número. Los números escritos con letras se convierten a cifra ("doce" → 12).',
    'Si una frase no contiene una cantidad clara, NO la incluyas.',
    'No inventes productos que no se hayan mencionado. No añadas texto fuera del JSON.',
  ].join(' ')

  try {
    const { texto: out, usage } = await chat({
      mensajes: [{ role: 'system', content: sys }, { role: 'user', content: dictado }],
      json: true, temperature: 0.1, maxTokens: 900, clientId,
    })
    await registrarUso(clientId, usage, true)

    const o = JSON.parse(out) as { items?: unknown }
    if (!Array.isArray(o.items)) return []
    return o.items
      .map(it => {
        const r = it as Record<string, unknown>
        const texto = typeof r.texto === 'string' ? r.texto.trim() : ''
        const cant  = Number(r.cantidad)
        return { texto, cantidad: Number.isFinite(cant) ? cant : NaN }
      })
      .filter(i => i.texto && Number.isFinite(i.cantidad) && i.cantidad >= 0)
  } catch (e) {
    if (!(e instanceof IaNoConfigurada)) console.error('[ia] interpretarConteoDictado', e)
    return null
  }
}

/**
 * Empareja lo dictado con el catálogo. **Determinista y en el código**, no en el modelo.
 *
 * Tres pasadas, de más exacta a más laxa, y solo se acepta un candidato ÚNICO: si dos
 * productos encajan igual de bien, se deja sin reconocer para que lo asigne el dueño.
 * Preferimos «no reconocido» a «reconocido mal»: lo primero se ve, lo segundo no.
 */
export function emparejarConteo(
  items: ItemDictado[],
  catalogo: { producto_id: string; nombre: string; codigo: string }[],
): {
  reconocidos:   { producto_id: string; nombre: string; cantidad: number; texto: string }[]
  noReconocidos: ItemDictado[]
} {
  const norm = (s: string) => s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // sin acentos
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const reconocidos: { producto_id: string; nombre: string; cantidad: number; texto: string }[] = []
  const noReconocidos: ItemDictado[] = []
  const usados = new Set<string>()

  for (const item of items) {
    const t = norm(item.texto)
    if (!t) { noReconocidos.push(item); continue }

    const libres = catalogo.filter(c => !usados.has(c.producto_id))
    const candidatos = (() => {
      // 1) Código exacto o nombre exacto.
      const exacto = libres.filter(c => norm(c.codigo) === t || norm(c.nombre) === t)
      if (exacto.length) return exacto
      // 2) El nombre del catálogo aparece dentro de lo dictado, o al revés.
      const contiene = libres.filter(c => {
        const n = norm(c.nombre)
        return n.includes(t) || t.includes(n)
      })
      if (contiene.length) return contiene
      // 3) Todas las palabras de lo dictado (de 3+ letras) están en el nombre.
      const palabras = t.split(' ').filter(p => p.length >= 3)
      if (!palabras.length) return []
      return libres.filter(c => {
        const n = norm(c.nombre)
        return palabras.every(p => n.includes(p))
      })
    })()

    if (candidatos.length === 1) {
      usados.add(candidatos[0].producto_id)
      reconocidos.push({
        producto_id: candidatos[0].producto_id,
        nombre:      candidatos[0].nombre,
        cantidad:    item.cantidad,
        texto:       item.texto,
      })
    } else {
      noReconocidos.push(item)
    }
  }

  return { reconocidos, noReconocidos }
}
