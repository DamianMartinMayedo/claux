// ── Emparejar el árbol del cliente con el del pack ───────────────────────────
//
// F1.4 del plan. Dos clientes de producción ya tienen su catálogo hecho a mano y
// la semilla, sola, no les sirve: los nombres no coinciden LETRA A LETRA, que es lo
// único que sabe mirar el índice único. «Comisión bancaria» y «Comisiones
// bancarias» son la misma cuenta para cualquiera menos para Postgres.
//
// Todo lo de aquí es PURO: decide qué se parece a qué y con cuánta confianza, y no
// mueve nada. Quien mueve es el asistente, y solo lo que el dueño marque.
//
// ── La regla que manda ───────────────────────────────────────────────────────
//
// **Ante la duda gana la del cliente.** Duplicar es visible y se arregla en un
// toque; fundir mal es invisible y permanente. Por eso hay un escalón entre
// «idéntico» y «se parece»: lo segundo se enseña, nunca se pre-marca.

import { norm, parecido, UMBRAL_PARECIDO } from '@/lib/importador/util'
import { RAICES, type RolCatalogo } from './catalogo'

/**
 * Singular castellano aproximado de una palabra ya normalizada.
 *
 * Existe por «Comisión bancaria» ≈ «Comisiones bancarias» (§1.4): sin esto, la
 * primera comisión que registre Tesorería crea una raíz nueva junto a la que el
 * dueño ya usaba, con seis gastos dentro. No pretende ser un lematizador: falla
 * en los invariables («lunes», «análisis»), y fallar ahí solo cuesta una
 * sugerencia de menos, que es el lado bueno en el que equivocarse.
 */
function singular(p: string): string {
  if (p.length > 4 && p.endsWith('es')) return p.slice(0, -2)
  if (p.length > 3 && p.endsWith('s'))  return p.slice(0, -1)
  return p
}

/**
 * La forma con la que se comparan dos nombres de categoría: sin mayúsculas, sin
 * tildes, sin plurales. Es más estricta que la del importador a propósito (§12.1 a):
 * allí decide un humano fila a fila, aquí se propone en lote.
 */
export function claveCat(nombre: string): string {
  return norm(nombre).split(' ').map(singular).filter(Boolean).join(' ')
}

/** Por encima de esto se ENSEÑA la propuesta; nunca se pre-marca por parecido. */
export const UMBRAL_PROPUESTA = Math.max(UMBRAL_PARECIDO, 0.72)

export type Confianza =
  /** Misma clave normalizada: se puede pre-marcar (si además el rol coincide). */
  | 'identico'
  /** Se parece lo bastante para enseñarlo, no para marcarlo solo. */
  | 'alto'
  /** Sin candidata: selector vacío. Más vale vacío que una sugerencia mala. */
  | 'ninguno'

export interface Candidata {
  /** `clave_catalogo` de la raíz del pack propuesta. */
  clave:     string
  nombre:    string
  rol:       RolCatalogo
  confianza: Confianza
  /** 0..1, para ordenar. No se enseña: un porcentaje invita a fiarse de él. */
  puntos:    number
}

/** Lo que hace falta saber de una categoría del cliente para emparejarla. */
export interface CategoriaPropia {
  categoria_id:   string
  nombre:         string
  parent_id:      string | null
  rol_pl:         string
  estado:         string
  es_sistema:     boolean
  clave_catalogo: string | null
}

/**
 * Las raíces del pack candidatas para un nombre, de más a menos parecida.
 *
 * `soloEstas` acota a las raíces que el cliente TIENE o va a tener: proponer un
 * destino que no existe en su árbol es proponerle una fila más, no una adopción.
 */
export function candidatasPara(
  nombre: string,
  soloEstas: Set<string>,
  maximo = 4,
): Candidata[] {
  const clave = claveCat(nombre)

  return RAICES
    .filter(r => soloEstas.has(r.clave))
    .map(r => {
      const identico = claveCat(r.nombre) === clave
      const puntos   = identico ? 1 : parecido(claveCat(r.nombre), clave)
      return {
        clave: r.clave, nombre: r.nombre, rol: r.rol, puntos,
        confianza: (identico ? 'identico' : puntos >= UMBRAL_PROPUESTA ? 'alto' : 'ninguno') as Confianza,
      }
    })
    .filter(c => c.confianza !== 'ninguno')
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, maximo)
}

/**
 * ¿Nace marcada esta propuesta?
 *
 * Solo si es idéntica tras normalizar **y** conserva el rol. Idéntica con rol
 * distinto se enseña desmarcada (§1.5, las dos «Alquiler» de CLI-0003): aceptarla
 * de un clic movería importes de renglón hacia atrás sin que nadie lo pidiera.
 */
export function naceMarcada(c: Candidata, rolActual: string): boolean {
  return c.confianza === 'identico' && c.rol === rolActual
}

/** Dos categorías del cliente que son la misma cuenta escrita de dos maneras. */
export interface ParDuplicado {
  /** La que se queda: la que más se usa; a igualdad, la que tiene hijas. */
  queda:  CategoriaPropia
  /** La que se absorbe. */
  absorbe: CategoriaPropia
  /** true si fundirlas mueve importes de renglón: nace desmarcada, con impacto. */
  cambiaRol: boolean
}

/**
 * Duplicados DENTRO del árbol del cliente, al mismo nivel.
 *
 * Existen de verdad: el índice único compara texto exacto, así que CLI-0003 tiene
 * «alquiler» y «Alquiler» como dos raíces distintas, con roles distintos. Se
 * comparan solo entre hermanas —dos hijas de madres distintas con el mismo nombre
 * no son un duplicado, son dos cuentas de dos sitios.
 */
export function duplicadosPropios(
  categorias: CategoriaPropia[],
  usoDe: (id: string) => number,
): ParDuplicado[] {
  const grupos = new Map<string, CategoriaPropia[]>()
  for (const c of categorias) {
    if (c.estado !== 'ACTIVO') continue
    const k = `${c.parent_id ?? ''}|${claveCat(c.nombre)}`
    const ya = grupos.get(k)
    if (ya) ya.push(c); else grupos.set(k, [c])
  }

  const pares: ParDuplicado[] = []
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue
    // La que se queda es la que más se usa: fundir hacia la vacía obligaría a
    // reasignar todos los apuntes de la llena, que es el camino largo y el que
    // más cosas puede romper.
    const orden = [...grupo].sort((a, b) => {
      const d = usoDe(b.categoria_id) - usoDe(a.categoria_id)
      if (d) return d
      // A igualdad de uso manda la de sistema: su clave la escribe un módulo y
      // no se puede mover a mano.
      return Number(b.es_sistema) - Number(a.es_sistema)
    })
    const [queda, ...resto] = orden
    for (const absorbe of resto) {
      pares.push({ queda, absorbe, cambiaRol: !queda.parent_id && queda.rol_pl !== absorbe.rol_pl })
    }
  }
  return pares
}
