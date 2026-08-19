// Las categorías vistas desde el importador: emparejar el nombre que trae el
// archivo, dar de alta la que falte y deshacer lo que creó el lote. Sirve a las
// dos familias, que son tablas distintas con la misma tarea:
//   · `categorias_gastos`  — jerarquía de 2 niveles (mig. 126) + `rol_pl`
//   · `product_categories` — planas, con `tipo` (PRODUCTO | SERVICIO | AMBAS)
//
// Dos trampas propias de las categorías que el tercero no tenía:
//
//  1. La categoría de un gasto es OBLIGATORIA, así que rechazar la fila por no
//     encontrarla tira el histórico entero. Ahora tiene la misma política que el
//     tercero (`defCategoriaFaltante`) y, si el nombre se parece a una que ya
//     existe, se pregunta en vez de crear un duplicado (§`resolver.ts`).
//
//  2. El índice único `(client_id, coalesce(parent_id,''), nombre)` de la mig.
//     126 NO mira el estado, así que una categoría ARCHIVADA con ese nombre
//     bloquea el alta. Buscar solo entre las ACTIVAS dejaba al operador en un
//     callejón sin salida: «no existe "Alquiler": créala» → 23505 «ya existe una
//     categoría con ese nombre», sin salida posible desde la UI. Aquí se busca
//     entre TODAS y la archivada se REACTIVA —lo mismo que hace
//     `crearSubcategorias` con las hijas—, lo que además se anuncia en los
//     totales del dry-run y se revierte al deshacer el lote.

import { generarCategoriaGastoId } from '@/lib/gastos-core'
import { generarCategoriaProductoId, type TipoProducto } from '@/lib/productos-core'
import { ROL_PL_LABEL, type RolPL } from '@/lib/pl/estado'
import { registrarAuxiliar } from '../motor'
import { idCorto, indicePorNombre, type IndiceNombres } from '../util'
import { aFallo, resolverRef, type Opcion } from '../resolver'
import { politicaCategoria, rolNuevas } from './comunes'
import type { CtxImport, Preparado } from '../tipos'

/** Entidades de traza: no se importan, pero el lote las crea de paso. */
export const ENT_CAT_GASTO      = 'categorias_gasto'
export const ENT_CAT_GASTO_REAC = 'categorias_gasto_reactivada'
export const ENT_CAT_PRODUCTO   = 'categorias_producto'
export const ENT_CAT_PROD_REAC  = 'categorias_producto_reactivada'
export const ENT_CAT_MENU       = 'categorias_menu'
export const ENT_CAT_MENU_REAC  = 'categorias_menu_reactivada'

type FichaCatGasto = {
  categoria_id: string; nombre: string; parent_id: string | null; estado: string
}
type FichaCatProducto = {
  categoria_id: string; nombre: string; tipo: string; estado: string
}

const opcion = (f: { categoria_id: string; nombre: string; estado: string }): Opcion => ({
  valor:    f.categoria_id,
  // Que se vea que está archivada: elegirla la reactiva, y eso hay que decirlo
  // antes y no después.
  etiqueta: f.estado === 'ACTIVO' ? f.nombre : `${f.nombre} (archivada)`,
})

// ── Categorías de gasto ───────────────────────────────────────────────────────

/**
 * Todas las categorías de gasto del cliente —incluidas las archivadas—, una vez
 * por lote. Las archivadas ENTRAN a propósito: son las que bloquean el alta.
 */
async function indiceGasto(ctx: CtxImport): Promise<IndiceNombres<FichaCatGasto>> {
  return indicePorNombre(ctx, 'catgas', async () => {
    const { data } = await ctx.db.from('categorias_gastos')
      .select('categoria_id, nombre, parent_id, estado').eq('client_id', ctx.client_id)
    return (data ?? []) as FichaCatGasto[]
  }, c => c.nombre)
}

/**
 * La categoría de un gasto, resuelta pero SIN escribir: `preparar` no puede
 * tocar la base de datos. Lo que falte por crear va en el plan y se ejecuta al
 * insertar la fila (`aplicarPlanCategoria`).
 */
export interface PlanCategoria {
  /** id de la raíz, o null si hay que crearla. */
  raiz_id:     string | null
  raiz_nombre: string
  /** undefined = la fila no trae subcategoría; null = hay que crearla. */
  sub_id?:     string | null
  sub_nombre?: string
  rol_pl:      RolPL
  /** Nombre de la hoja con la que se escribe la fila. */
  nombre:      string
  /** Etiqueta derivada: «Categoría · Subcategoría» (igual que el alta manual). */
  descripcion: string
}

/** Nombres que este plan va a CREAR (para contarlos en el dry-run). */
export function nombresNuevos(plan: PlanCategoria): string[] {
  return [
    ...(plan.raiz_id ? [] : [plan.raiz_nombre]),
    ...(plan.sub_nombre !== undefined && !plan.sub_id ? [`${plan.raiz_nombre} · ${plan.sub_nombre}`] : []),
  ]
}

/**
 * Categoría (y subcategoría) de una fila de gastos. Devuelve el plan o el motivo
 * por el que la fila no entra —con `decidir` cuando lo que falta es una respuesta
 * del operador, no una corrección del archivo—.
 */
export async function resolverCategoriaGasto(
  cat: string, sub: string, valores: Record<string, string>, ctx: CtxImport,
): Promise<{ ok: true; plan: PlanCategoria } | Extract<Preparado, { ok: false }>> {
  const idx      = await indiceGasto(ctx)
  const rol      = rolNuevas(valores)
  const politica = politicaCategoria(valores)
  const esRaiz   = (c: FichaCatGasto) => !c.parent_id

  const raiz = resolverRef({
    tipo:          ENT_CAT_GASTO,
    etiqueta_tipo: 'Categoría de gasto',
    texto:         cat,
    coincidencias: idx.buscar(cat, esRaiz).map(opcion),
    parecidos:     idx.sugerir(cat, esRaiz).map(opcion),
    otras:         idx.todas(esRaiz).map(opcion),
    creable:       true,
    omitible:      false,
    aviso:         `Nace contando como «${ROL_PL_LABEL[rol]}» en el estado de resultados.`,
    defecto:       politica,
  }, ctx)
  const fallo = aFallo(raiz)
  if (fallo) return fallo

  const raiz_id     = raiz.estado === 'USAR' ? raiz.id : null
  const raiz_nombre = raiz_id ? nombreDe(idx, raiz_id) : cat

  if (!sub) {
    return { ok: true, plan: { raiz_id, raiz_nombre, rol_pl: rol, nombre: raiz_nombre, descripcion: raiz_nombre } }
  }

  // Si la madre nace ahora, la hija no puede existir: crearla va implícito en la
  // decisión ya tomada, y volver a preguntar sería preguntar dos veces por lo mismo.
  if (!raiz_id) {
    return {
      ok: true,
      plan: {
        raiz_id: null, raiz_nombre, sub_id: null, sub_nombre: sub, rol_pl: rol,
        nombre: sub, descripcion: `${raiz_nombre} · ${sub}`,
      },
    }
  }

  const hija = (c: FichaCatGasto) => c.parent_id === raiz_id
  const subR = resolverRef({
    tipo:            'subcategoria_gasto',
    etiqueta_tipo:   'Subcategoría',
    texto:           sub,
    ambito:          raiz_id,
    ambito_etiqueta: `dentro de «${raiz_nombre}»`,
    coincidencias:   idx.buscar(sub, hija).map(opcion),
    parecidos:       idx.sugerir(sub, hija).map(opcion),
    otras:           idx.todas(hija).map(opcion),
    creable:         true,
    omitible:        true,   // sin subcategoría el gasto cuenta en su madre
    aviso:           `Se creará dentro de «${raiz_nombre}» y hereda su papel en el informe.`,
    defecto:         politica === 'RECHAZAR' ? 'RECHAZAR' : 'CREAR',
  }, ctx)
  const falloSub = aFallo(subR)
  if (falloSub) return falloSub

  if (subR.estado === 'OMITIR') {
    return { ok: true, plan: { raiz_id, raiz_nombre, rol_pl: rol, nombre: raiz_nombre, descripcion: raiz_nombre } }
  }
  const sub_id     = subR.estado === 'USAR' ? subR.id : null
  const sub_nombre = sub_id ? nombreDe(idx, sub_id) : sub
  return {
    ok: true,
    plan: {
      raiz_id, raiz_nombre, sub_id, sub_nombre, rol_pl: rol,
      nombre: sub_nombre, descripcion: `${raiz_nombre} · ${sub_nombre}`,
    },
  }
}

/**
 * Escribe lo que el plan tenga pendiente y devuelve el `categoria_id` con el que
 * se guarda la fila. Idempotente dentro del lote: el índice se va anotando, así
 * que dos filas con la misma categoría nueva la crean una sola vez.
 */
export async function aplicarPlanCategoria(plan: PlanCategoria, ctx: CtxImport): Promise<string> {
  const raiz = plan.raiz_id
    ? await asegurarActivaGasto(plan.raiz_id, ctx)
    : await crearCategoriaGasto(plan.raiz_nombre, null, plan.rol_pl, ctx)
  if (plan.sub_nombre === undefined) return raiz
  return plan.sub_id
    ? await asegurarActivaGasto(plan.sub_id, ctx)
    // Una hija hereda el papel de su madre, así que el suyo va al valor neutro
    // (misma regla que `crearSubcategorias` y que el alta manual).
    : await crearCategoriaGasto(plan.sub_nombre, raiz, 'OPERATIVO', ctx)
}

async function crearCategoriaGasto(
  nombre: string, parent_id: string | null, rol_pl: RolPL, ctx: CtxImport,
): Promise<string> {
  const idx = await indiceGasto(ctx)
  const ya  = idx.buscar(nombre, c => (c.parent_id ?? null) === parent_id)[0]
  if (ya) return asegurarActivaGasto(ya.categoria_id, ctx)

  const categoria_id = generarCategoriaGastoId()
  const { error } = await ctx.db.from('categorias_gastos').insert({
    categoria_id, client_id: ctx.client_id, nombre, descripcion: null,
    parent_id, rol_pl, estado: 'ACTIVO', es_sistema: false,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
  idx.anotar(nombre, { categoria_id, nombre, parent_id, estado: 'ACTIVO' })
  await registrarAuxiliar(ctx, ENT_CAT_GASTO, categoria_id)
  return categoria_id
}

/**
 * La categoría existe pero está archivada: se reactiva. Queda trazado como algo
 * que hizo el lote, para que deshacerlo la devuelva a archivada —si no, deshacer
 * dejaría el catálogo del cliente cambiado sin decirlo—.
 */
async function asegurarActivaGasto(categoria_id: string, ctx: CtxImport): Promise<string> {
  const ficha = (await indiceGasto(ctx)).todas(c => c.categoria_id === categoria_id)[0]
  if (!ficha || ficha.estado === 'ACTIVO') return categoria_id
  const { error } = await ctx.db.from('categorias_gastos')
    .update({ estado: 'ACTIVO', updated_at: new Date().toISOString() })
    .eq('categoria_id', categoria_id).eq('client_id', ctx.client_id)
  if (error) throw new Error(error.message)
  ficha.estado = 'ACTIVO'   // la fila siguiente ya no lo repite
  await registrarAuxiliar(ctx, ENT_CAT_GASTO_REAC, categoria_id)
  return categoria_id
}

// ── Categorías del catálogo (productos y servicios) ───────────────────────────

async function indiceProducto(ctx: CtxImport): Promise<IndiceNombres<FichaCatProducto>> {
  return indicePorNombre(ctx, 'catprod', async () => {
    const { data } = await ctx.db.from('product_categories')
      .select('categoria_id, nombre, tipo, estado').eq('client_id', ctx.client_id)
    return (data ?? []) as FichaCatProducto[]
  }, c => c.nombre)
}

/**
 * Categoría del catálogo para una ficha de `tipo`. Devuelve el id, o null si el
 * operador decidió dejarla en blanco (la categoría es opcional en el catálogo).
 * `pendiente` lleva el nombre a crear al escribir.
 */
export async function resolverCategoriaProducto(
  nombre: string, tipo: TipoProducto, valores: Record<string, string>, ctx: CtxImport,
): Promise<
  | { ok: true; categoria_id: string | null; crear: string | null }
  | Extract<Preparado, { ok: false }>
> {
  const idx  = await indiceProducto(ctx)
  // «AMBAS» vale para las dos páginas; una categoría de servicios no se ofrece
  // al importar productos (mig. 122).
  const suya = (c: FichaCatProducto) => c.tipo === tipo || c.tipo === 'AMBAS'

  const r = resolverRef({
    tipo:          ENT_CAT_PRODUCTO,
    etiqueta_tipo: 'Categoría del catálogo',
    texto:         nombre,
    ambito:        tipo,
    coincidencias: idx.buscar(nombre, suya).map(opcion),
    parecidos:     idx.sugerir(nombre, suya).map(opcion),
    otras:         idx.todas(suya).map(opcion),
    creable:       true,
    omitible:      true,
    aviso:         `Se creará para ${tipo === 'SERVICIO' ? 'servicios' : 'productos'}.`,
    defecto:       politicaCategoria(valores),
  }, ctx)
  const fallo = aFallo(r)
  if (fallo) return fallo

  if (r.estado === 'USAR')   return { ok: true, categoria_id: r.id, crear: null }
  if (r.estado === 'OMITIR') return { ok: true, categoria_id: null, crear: null }
  return { ok: true, categoria_id: null, crear: nombre }
}

/** Da de alta la categoría del catálogo que la fila apuntó (o reusa la archivada). */
export async function crearCategoriaProducto(
  nombre: string, tipo: TipoProducto, ctx: CtxImport,
): Promise<string> {
  const idx = await indiceProducto(ctx)
  const ya  = idx.buscar(nombre, c => c.tipo === tipo || c.tipo === 'AMBAS')[0]
  if (ya) return asegurarActivaProducto(ya, ctx)

  const categoria_id = generarCategoriaProductoId()
  const ahora = new Date().toISOString()
  const { error } = await ctx.db.from('product_categories').insert({
    categoria_id, client_id: ctx.client_id, nombre, descripcion: null,
    tipo, estado: 'ACTIVO', created_at: ahora, updated_at: ahora,
  })
  if (error) throw new Error(error.message)
  idx.anotar(nombre, { categoria_id, nombre, tipo, estado: 'ACTIVO' })
  await registrarAuxiliar(ctx, ENT_CAT_PRODUCTO, categoria_id)
  return categoria_id
}

async function asegurarActivaProducto(ficha: FichaCatProducto, ctx: CtxImport): Promise<string> {
  if (ficha.estado === 'ACTIVO') return ficha.categoria_id
  const { error } = await ctx.db.from('product_categories')
    .update({ estado: 'ACTIVO', updated_at: new Date().toISOString() })
    .eq('categoria_id', ficha.categoria_id).eq('client_id', ctx.client_id)
  if (error) throw new Error(error.message)
  ficha.estado = 'ACTIVO'
  await registrarAuxiliar(ctx, ENT_CAT_PROD_REAC, ficha.categoria_id)
  return ficha.categoria_id
}

// ── Secciones del catálogo público / carta (`catalogo_categorias`) ────────────
// Las «secciones» de la carta QR son OTRA tabla que las categorías del ERP
// (`product_categories`): planas, sin `tipo`, y su estado es un booleano `activa`
// (no un `estado` ARCHIVADO). Misma tarea, columnas distintas — de ahí un bloque
// aparte en vez de un parámetro más. No hay índice único por nombre, así que aquí
// no bloquea nada una archivada; aun así se REUSA (y se reactiva) en vez de
// duplicar, para no llenar la carta de sinónimos.

type FichaCatMenu = { categoria_id: string; nombre: string; activa: boolean }

const opcionMenu = (f: FichaCatMenu): Opcion => ({
  valor:    f.categoria_id,
  etiqueta: f.activa ? f.nombre : `${f.nombre} (archivada)`,
})

async function indiceMenu(ctx: CtxImport): Promise<IndiceNombres<FichaCatMenu>> {
  return indicePorNombre(ctx, 'catmenu', async () => {
    const { data } = await ctx.db.from('catalogo_categorias')
      .select('categoria_id, nombre, activa').eq('client_id', ctx.client_id)
    return (data ?? []) as FichaCatMenu[]
  }, c => c.nombre)
}

/**
 * Sección de la carta para un ítem. Devuelve el id, o null si el operador la deja
 * en blanco (la sección es opcional en la carta). `crear` lleva el nombre a dar de
 * alta al escribir (el dry-run no toca la base).
 */
export async function resolverCategoriaMenu(
  nombre: string, valores: Record<string, string>, ctx: CtxImport,
): Promise<
  | { ok: true; categoria_id: string | null; crear: string | null }
  | Extract<Preparado, { ok: false }>
> {
  const idx = await indiceMenu(ctx)
  const r = resolverRef({
    tipo:          ENT_CAT_MENU,
    etiqueta_tipo: 'Sección de la carta',
    texto:         nombre,
    coincidencias: idx.buscar(nombre).map(opcionMenu),
    parecidos:     idx.sugerir(nombre).map(opcionMenu),
    otras:         idx.todas().map(opcionMenu),
    creable:       true,
    omitible:      true,
    aviso:         'Se creará como sección de la carta.',
    defecto:       politicaCategoria(valores),
  }, ctx)
  const fallo = aFallo(r)
  if (fallo) return fallo

  if (r.estado === 'USAR')   return { ok: true, categoria_id: r.id, crear: null }
  if (r.estado === 'OMITIR') return { ok: true, categoria_id: null, crear: null }
  return { ok: true, categoria_id: null, crear: nombre }
}

/** Da de alta la sección que el ítem apuntó (o reusa/reactiva la que ya existe). */
export async function crearCategoriaMenu(nombre: string, ctx: CtxImport): Promise<string> {
  const idx = await indiceMenu(ctx)
  const ya  = idx.buscar(nombre)[0]
  if (ya) return asegurarActivaMenu(ya, ctx)

  const categoria_id = `CATCAT-${idCorto()}`
  const { error } = await ctx.db.from('catalogo_categorias').insert({
    categoria_id, client_id: ctx.client_id, nombre, activa: true,
  })
  if (error) throw new Error(error.message)
  idx.anotar(nombre, { categoria_id, nombre, activa: true })
  await registrarAuxiliar(ctx, ENT_CAT_MENU, categoria_id)
  return categoria_id
}

async function asegurarActivaMenu(ficha: FichaCatMenu, ctx: CtxImport): Promise<string> {
  if (ficha.activa) return ficha.categoria_id
  const { error } = await ctx.db.from('catalogo_categorias')
    .update({ activa: true, updated_at: new Date().toISOString() })
    .eq('categoria_id', ficha.categoria_id).eq('client_id', ctx.client_id)
  if (error) throw new Error(error.message)
  ficha.activa = true
  await registrarAuxiliar(ctx, ENT_CAT_MENU_REAC, ficha.categoria_id)
  return ficha.categoria_id
}

// ── Deshacer ──────────────────────────────────────────────────────────────────
//
// Se borra la categoría que creó el lote solo si NADIE la usa ya —ni un gasto, ni
// un movimiento, ni una subcategoría—; si la usa alguien, se queda y se dice por
// qué, igual que con la ficha de un tercero. Reactivar se revierte archivando.

export const DESHACEDORES_CATEGORIA = {
  [ENT_CAT_GASTO]: {
    deshacer: async (pk: string, ctx: CtxImport): Promise<string | null> => {
      for (const [tabla, columna, etiqueta] of [
        ['gastos_cobros',         'categoria_id', 'gastos o cobros'],
        ['movimientos_tesoreria', 'categoria_id', 'movimientos de tesorería'],
        ['categorias_gastos',     'parent_id',    'subcategorías'],
      ] as const) {
        const { count } = await ctx.db.from(tabla)
          .select('*', { count: 'exact', head: true }).eq(columna, pk)
        if ((count ?? 0) > 0) return `La categoría ya tiene ${etiqueta}: se queda como está.`
      }
      const { error } = await ctx.db.from('categorias_gastos').delete()
        .eq('categoria_id', pk).eq('client_id', ctx.client_id)
      return error ? error.message : null
    },
  },
  [ENT_CAT_GASTO_REAC]: {
    deshacer: async (pk: string, ctx: CtxImport): Promise<string | null> => {
      const { error } = await ctx.db.from('categorias_gastos')
        .update({ estado: 'ARCHIVADO', updated_at: new Date().toISOString() })
        .eq('categoria_id', pk).eq('client_id', ctx.client_id)
      return error ? error.message : null
    },
  },
  [ENT_CAT_PRODUCTO]: {
    deshacer: async (pk: string, ctx: CtxImport): Promise<string | null> => {
      const { count } = await ctx.db.from('products')
        .select('*', { count: 'exact', head: true }).eq('categoria_id', pk)
      if ((count ?? 0) > 0) return 'La categoría ya tiene fichas del catálogo: se queda como está.'
      const { error } = await ctx.db.from('product_categories').delete()
        .eq('categoria_id', pk).eq('client_id', ctx.client_id)
      return error ? error.message : null
    },
  },
  [ENT_CAT_PROD_REAC]: {
    deshacer: async (pk: string, ctx: CtxImport): Promise<string | null> => {
      const { error } = await ctx.db.from('product_categories')
        .update({ estado: 'ARCHIVADO', updated_at: new Date().toISOString() })
        .eq('categoria_id', pk).eq('client_id', ctx.client_id)
      return error ? error.message : null
    },
  },
  [ENT_CAT_MENU]: {
    deshacer: async (pk: string, ctx: CtxImport): Promise<string | null> => {
      // La FK de `catalogo_items` es ON DELETE SET NULL: borrar la sección no
      // rompe nada, pero si ya cuelga algún ítem de ella se deja como está —igual
      // que la categoría del ERP—, para no descolocar la carta al deshacer.
      const { count } = await ctx.db.from('catalogo_items')
        .select('*', { count: 'exact', head: true }).eq('categoria_id', pk)
      if ((count ?? 0) > 0) return 'La sección ya tiene platos o productos: se queda como está.'
      const { error } = await ctx.db.from('catalogo_categorias').delete()
        .eq('categoria_id', pk).eq('client_id', ctx.client_id)
      return error ? error.message : null
    },
  },
  [ENT_CAT_MENU_REAC]: {
    deshacer: async (pk: string, ctx: CtxImport): Promise<string | null> => {
      const { error } = await ctx.db.from('catalogo_categorias')
        .update({ activa: false, updated_at: new Date().toISOString() })
        .eq('categoria_id', pk).eq('client_id', ctx.client_id)
      return error ? error.message : null
    },
  },
}

// ── Interno ───────────────────────────────────────────────────────────────────

function nombreDe(idx: IndiceNombres<FichaCatGasto>, categoria_id: string): string {
  return idx.todas(c => c.categoria_id === categoria_id)[0]?.nombre ?? ''
}
