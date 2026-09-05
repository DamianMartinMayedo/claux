import { anclaEncabezado } from './slug'

/**
 * Los atajos de la portada: entradas por SITUACIÓN, no por título de apartado.
 *
 * Quien abre el manual con un cliente delante no viene buscando «4.1 Dos números
 * que no se mezclan»: viene buscando qué contestar. Son las situaciones que más
 * se repiten, y cada una cae directamente en el apartado que la resuelve —no en
 * la pieza, en el apartado—.
 *
 * El `encabezado` es el texto EXACTO del `###`/`##` de destino, del que sale el
 * ancla igual que la saca el renderizador. La portada solo pinta los atajos cuyo
 * ancla existe de verdad en el manual leído, así que renombrar un encabezado
 * hace desaparecer su atajo, nunca deja un enlace que no lleva a ninguna parte.
 */

export type Atajo = {
  /** La situación, en las palabras de quien la está viviendo. */
  situacion: string
  /** Slug de la pieza de destino. */
  pieza: string
  /** Texto literal del encabezado de destino. */
  encabezado: string
  /** Dónde cae, para no llegar a ciegas. */
  donde: string
}

export const ATAJOS: Atajo[] = [
  {
    situacion: 'No sé qué ofrecerle',
    pieza: 'vender', encabezado: '3.2 Por dónde empezar',
    donde: 'Del problema al módulo',
  },
  {
    situacion: 'Tengo que pasar un presupuesto',
    pieza: 'vender', encabezado: '4.1 Dos números que no se mezclan',
    donde: 'Armar el presupuesto',
  },
  {
    situacion: 'Mañana tengo la visita',
    pieza: 'vender', encabezado: '7.2 Un guion de veinte minutos',
    donde: 'La visita, de principio a fin',
  },
  {
    situacion: 'Tengo que mandarle la propuesta',
    pieza: 'vender', encabezado: '2.3 La propuesta: un enlace, no un PDF',
    donde: 'El recorrido comercial',
  },
  {
    situacion: 'Me dicen que es caro',
    pieza: 'vender', encabezado: '5.1 Las de precio',
    donde: 'Catálogo de objeciones',
  },
  {
    situacion: 'Nunca he vendido a este sector',
    pieza: 'vender', encabezado: '6.2 Los once sectores',
    donde: 'Casos por sector',
  },
  {
    situacion: 'Tengo que explicar qué es CLAUX',
    pieza: 'de-un-vistazo', encabezado: '1. Qué es CLAUX',
    donde: 'De un vistazo',
  },
]

/** El ancla a la que apunta, con el mismo cálculo que usa el renderizador. */
export function anclaDe(a: Atajo): string {
  return anclaEncabezado(a.encabezado, a.pieza)
}

/** Su destino completo. */
export function rutaDeAtajo(a: Atajo): string {
  return `/academia/${a.pieza}#${anclaDe(a)}`
}
