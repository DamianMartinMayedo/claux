// Emparejar un nombre del archivo con una ficha que ya existe — y cuando no se
// puede, PREGUNTAR en vez de tirar la fila.
//
// Lo que el cliente escribe en la plantilla no es un identificador: es «Alquier»
// por «Alquiler», «Comercial SA» por «Comercial S.A.», «Suministro» por
// «Suministros». `indicePorNombre` ya perdona lo mecánico —mayúsculas, tildes,
// puntuación, dobles espacios de Excel—; lo que queda es error humano, y ahí
// emparejar por parecido a ciegas sería lo peor de las dos opciones: un gasto en
// la categoría equivocada mete dinero en el renglón que no toca del estado de
// resultados, en silencio y en un histórico entero. «Alquiler» y «Alquileres»
// pueden ser un dedazo o dos partidas distintas del cliente, y desde el código
// no hay forma de saberlo.
//
// Reparto del trabajo:
//   · Coincidencia única  → se usa, sin molestar a nadie.
//   · HAY dudas (varias fichas con ese nombre, o ninguna pero algo parecido al
//     lado) → la fila espera DECISIÓN y el asistente la pinta con sus opciones.
//   · No se parece a nada → manda la política del lote (crearla, dejarlo vacío o
//     rechazar la fila). Es lo que permite meter 400 filas con 80 proveedores
//     nuevos sin 80 clics; sale listado igualmente, y se puede redirigir.
//
// Las decisiones viajan en el `mapeo` (`resoluciones`), así que revalidar y
// aplicar recorren exactamente el mismo camino.

import { norm } from './util'
import type { AccionResolucion, CtxImport, Pendiente, Preparado } from './tipos'

export interface Opcion { valor: string; etiqueta: string }

/** Lo que el adaptador sabe de un nombre suelto del archivo. */
export interface Peticion {
  tipo:          string   // 'categoria_gasto', 'tercero', 'cuenta'…
  etiqueta_tipo: string   // «Categoría de gasto»
  texto:         string   // el nombre tal y como viene en el archivo
  /** Ámbito dentro del que se resuelve (empresa, categoría madre, tipo). */
  ambito?:          string
  ambito_etiqueta?: string
  /** Fichas cuyo nombre coincide: 0 = no está · 1 = resuelto · 2+ = ambiguo. */
  coincidencias: Opcion[]
  /** Fichas que se le PARECEN sin coincidir, de más a menos. */
  parecidos:     Opcion[]
  /** El resto del ámbito, para poder señalar cualquiera a mano. */
  otras?:        Opcion[]
  creable:       boolean
  omitible:      boolean
  aviso?:        string
  /** Qué hacer cuando no hay ninguna duda que plantear. */
  defecto:       AccionResolucion
}

export type Resuelto =
  | { estado: 'USAR';    id: string }
  | { estado: 'CREAR' }
  | { estado: 'OMITIR' }
  /** Espera respuesta del operador: la fila no se importa todavía. */
  | { estado: 'DECIDIR'; motivo: string }
  | { estado: 'ERROR';   motivo: string }

/** Identidad de un pendiente. Es lo que casa la respuesta con la pregunta. */
export function claveResolucion(tipo: string, ambito: string, texto: string): string {
  return `${tipo}|${ambito}|${norm(texto)}`
}

/**
 * Traduce un resultado del resolutor al fallo de fila que espera el motor, o null
 * si se resolvió bien. `decidir` es lo que separa «espera respuesta» de «el
 * archivo está mal», que se cuentan y se explican distinto.
 */
export function aFallo(r: Resuelto): Extract<Preparado, { ok: false }> | null {
  if (r.estado === 'DECIDIR') return { ok: false, motivo: r.motivo, decidir: true }
  if (r.estado === 'ERROR')   return { ok: false, motivo: r.motivo }
  return null
}

/** Cuántas opciones se le ofrecen: la lista completa de 800 productos no baja. */
const MAX_OPCIONES = 40

function apuntar(ctx: CtxImport, p: Pendiente): void {
  if (!ctx.pendientes) return   // commit: ya está decidido, no hay a quién preguntar
  const ya = ctx.pendientes.get(p.clave)
  if (ya) { ya.filas++; return }
  ctx.pendientes.set(p.clave, p)
}

function unicas(opciones: Opcion[]): Opcion[] {
  const vistas = new Set<string>()
  const out: Opcion[] = []
  for (const o of opciones) {
    if (vistas.has(o.valor)) continue
    vistas.add(o.valor)
    out.push(o)
    if (out.length >= MAX_OPCIONES) break
  }
  return out
}

/** El motivo que ve el operador en la tabla de errores y en el CSV que se baja. */
function motivoDecidir(p: Peticion, varias: boolean): string {
  const donde = p.ambito_etiqueta ? ` ${p.ambito_etiqueta}` : ''
  if (varias) {
    return `Hay más de una ${p.etiqueta_tipo.toLowerCase()} llamada "${p.texto}"${donde}: elige cuál en el paso de revisar.`
  }
  const sugerencia = p.parecidos[0]?.etiqueta
  return `No existe la ${p.etiqueta_tipo.toLowerCase()} "${p.texto}"${donde}.`
    + (sugerencia ? ` ¿Quisiste decir «${sugerencia}»? Decídelo en el paso de revisar.` : '')
}

/**
 * Resuelve una referencia por nombre. Puro: no toca la base de datos (el
 * dry-run no escribe), así que crear lo que falte es cosa de quien escribe.
 */
export function resolverRef(p: Peticion, ctx: CtxImport): Resuelto {
  if (p.coincidencias.length === 1) return { estado: 'USAR', id: p.coincidencias[0].valor }

  const clave  = claveResolucion(p.tipo, p.ambito ?? '', p.texto)
  const varias = p.coincidencias.length > 1
  // Con algo parecido delante, decidir NO es opcional: aplicar la política del
  // lote crearía un duplicado de lo que ya existe escrito de otra forma.
  const decidir = varias || p.parecidos.length > 0

  apuntar(ctx, {
    clave,
    tipo:          p.tipo,
    etiqueta_tipo: p.etiqueta_tipo,
    texto:         p.texto,
    ambito_etiqueta: p.ambito_etiqueta,
    causa:         varias ? 'VARIAS' : 'NINGUNA',
    decidir,
    filas:         1,
    primera_fila:  ctx.fila ?? 0,
    opciones:      unicas([...p.coincidencias, ...p.parecidos, ...(p.otras ?? [])]),
    creable:       p.creable,
    omitible:      p.omitible,
    aviso:         p.aviso,
    defecto:       decidir ? 'RECHAZAR' : p.defecto,
  })

  const decidido = ctx.resoluciones?.[clave]
  const accion   = decidido?.accion ?? (decidir ? null : p.defecto)

  if (accion === 'USAR') {
    return decidido?.destino
      ? { estado: 'USAR', id: decidido.destino }
      : { estado: 'ERROR', motivo: `Falta indicar a qué ${p.etiqueta_tipo.toLowerCase()} corresponde "${p.texto}".` }
  }
  if (accion === 'CREAR') {
    return p.creable
      ? { estado: 'CREAR' }
      : { estado: 'ERROR', motivo: `"${p.texto}" no se puede crear desde el importador: dala de alta antes.` }
  }
  if (accion === 'OMITIR') {
    return p.omitible
      ? { estado: 'OMITIR' }
      : { estado: 'ERROR', motivo: `${p.etiqueta_tipo} es obligatoria: "${p.texto}" no se puede dejar en blanco.` }
  }
  if (accion === 'RECHAZAR') {
    return { estado: 'ERROR', motivo: `${p.etiqueta_tipo} "${p.texto}": la fila se deja fuera por decisión del operador.` }
  }
  return { estado: 'DECIDIR', motivo: motivoDecidir(p, varias) }
}
