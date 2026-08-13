// ── Las categorías, agrupadas como las lee el informe ────────────────────────
//
// La pregunta «¿en qué se fue este dinero?» se hace ya en tres sitios: el
// movimiento manual de Tesorería, la bandeja de la gaveta del TPV y —de otra
// forma— el asistente del catálogo. Los tres tienen que ofrecer las MISMAS
// opciones en el MISMO orden, o el dueño aprende que la respuesta depende de por
// dónde entró, que es justo lo que la Fase 5 vino a quitar de en medio.
//
// Vive en `lib/pl/` y no en la vista porque lo que agrupa es el vocabulario del
// estado de resultados, no un detalle de una pantalla.

import {
  ROLES_RESULTADO, ROLES_INGRESO, ROLES_FUERA_RESULTADO, esRolPL, type RolPL,
} from './estado'

/** Lo mínimo que hace falta de una categoría para agruparla. */
export interface CategoriaAgrupable {
  categoria_id: string
  nombre:       string
  parent_id:    string | null
  estado:       string
  rol_pl:       string | null
}

export interface GrupoCategorias {
  rol:      RolPL
  opciones: { id: string; nombre: string }[]
}

/**
 * Las categorías agrupadas por el renglón de su RAÍZ, en el orden del informe.
 *
 * Por la raíz y no por la fila: el papel vive arriba y las hijas lo heredan
 * (mig. 134). Y el orden depende del sentido del movimiento —en un egreso los
 * gastos primero, en un ingreso los ingresos— sin esconder nunca los del otro
 * lado: hay clientes que llevan sus cobros con categorías de gasto desde antes de
 * que existiera el rol de ingreso, y esconderlas les borraría la suya.
 */
export function gruposDeCategorias(
  categorias: CategoriaAgrupable[], esEgreso: boolean,
): GrupoCategorias[] {
  const activas = categorias.filter(c => c.estado === 'ACTIVO')
  const porId   = new Map(categorias.map(c => [c.categoria_id, c]))

  const rolDe = (c: CategoriaAgrupable): RolPL => {
    let actual = c
    for (let i = 0; i < 4 && actual.parent_id; i++) {
      const madre = porId.get(actual.parent_id)
      if (!madre) break
      actual = madre
    }
    return esRolPL(actual.rol_pl) ? actual.rol_pl : 'OPERATIVO'
  }

  const hijasDe = new Map<string, CategoriaAgrupable[]>()
  for (const c of activas) {
    if (!c.parent_id) continue
    const ya = hijasDe.get(c.parent_id)
    if (ya) ya.push(c); else hijasDe.set(c.parent_id, [c])
  }

  const porRol   = new Map<RolPL, { id: string; nombre: string }[]>()
  const emitidas = new Set<string>()
  const meter = (c: CategoriaAgrupable, hija: boolean) => {
    if (emitidas.has(c.categoria_id)) return
    emitidas.add(c.categoria_id)
    const rol = rolDe(c)
    const op  = { id: c.categoria_id, nombre: `${hija ? '· ' : ''}${c.nombre}` }
    const ya  = porRol.get(rol)
    if (ya) ya.push(op); else porRol.set(rol, [op])
  }

  const porNombre = (a: CategoriaAgrupable, b: CategoriaAgrupable) =>
    a.nombre.localeCompare(b.nombre, 'es')
  for (const raiz of activas.filter(c => !c.parent_id).sort(porNombre)) {
    meter(raiz, false)
    for (const h of (hijasDe.get(raiz.categoria_id) ?? []).sort(porNombre)) meter(h, true)
  }
  // Las hijas cuya madre está archivada no tienen por dónde salir arriba: van al
  // final de su grupo. Perderlas dejaría al dueño sin poder elegir la categoría
  // con la que lleva meses anotando.
  for (const c of activas.sort(porNombre)) meter(c, !!c.parent_id)

  const orden: readonly RolPL[] = esEgreso
    ? [...ROLES_RESULTADO, ...ROLES_FUERA_RESULTADO, ...ROLES_INGRESO]
    : [...ROLES_INGRESO, ...ROLES_RESULTADO, ...ROLES_FUERA_RESULTADO]
  return orden.filter(r => porRol.has(r)).map(r => ({ rol: r, opciones: porRol.get(r)! }))
}
