// Lo que un cliente tiene que tener ANTES de poder importar nada.
//
// Una importación siempre cae sobre un cliente recién creado, y ahí lo primero
// que se configura son las empresas y las monedas. Sin ellas, los valores por
// defecto obligatorios del lote (en qué empresa se crea todo, en qué moneda) se
// quedan sin opciones: el asistente pintaba un desplegable vacío en un campo
// obligatorio y no explicaba nada. Esto lo dice antes, y con su nombre.
//
// Se comprueba contra los `defaults` que DECLARA el adaptador, no contra una
// lista fija de entidades: así una entidad que no necesite moneda —los terceros,
// por ejemplo, donde es opcional— no queda bloqueada por algo que no usa.

import type { Adaptador, CtxImport } from './tipos'

export interface RequisitoFaltante {
  /** Cómo se llama en plural, para el aviso. */
  que: string
  /** Sección del portal donde se crea. */
  donde: string
}

const EMPRESAS: RequisitoFaltante = { que: 'empresas', donde: 'Empresas' }
const MONEDAS:  RequisitoFaltante = { que: 'monedas',  donde: 'Monedas' }

/**
 * Qué le falta al cliente para importar esta entidad. Vacío = puede importar.
 * No toca la base: mira el contexto que ya viene resuelto.
 */
export function requisitosFaltantes(adaptador: Adaptador, ctx: CtxImport): RequisitoFaltante[] {
  const faltan: RequisitoFaltante[] = []
  for (const d of adaptador.defaults) {
    if (!d.obligatorio) continue
    if (d.campo === 'empresa_id' && !ctx.empresas.length && !faltan.includes(EMPRESAS)) faltan.push(EMPRESAS)
    if (d.campo.startsWith('moneda') && !ctx.monedas.length && !faltan.includes(MONEDAS)) faltan.push(MONEDAS)
  }
  return faltan
}

/** El aviso, o `null` si no falta nada. */
export function mensajeRequisitos(faltan: RequisitoFaltante[]): string | null {
  if (!faltan.length) return null
  const lista = faltan.length === 1
    ? faltan[0].que
    : `${faltan.slice(0, -1).map(f => f.que).join(', ')} ni ${faltan[faltan.length - 1].que}`
  const donde = faltan.map(f => f.donde).join(' y ')
  return `Este cliente todavía no tiene ${lista}. Créalas en ${donde} antes de importar.`
}
