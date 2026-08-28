// ─────────────────────────────────────────────────────────────────────────────
// Límites de capacidad por nivel comercial.
//
// Plan: docs/planes/niveles-comerciales.md
//
// QUÉ RESUELVE. El nivel del cliente ('inicial' | 'empresa' | 'pro') no solo fija
// el precio de cada módulo: fija cuánto cabe. Este fichero es el único sitio que
// sabe contar y comparar; todo lo demás lo llama.
//
// LAS TRES REGLAS QUE NO SE NEGOCIAN
//
//   1. **Solo cuenta lo activo.** Archivar libera cupo y eso es deliberado: el
//      negocio que retira producto merece recuperar el sitio.
//   2. **Desarchivar cuenta como crear.** Misma comprobación. Sin esto, archivar
//      50 productos para meter 50 nuevos y luego desarchivar los viejos deja al
//      cliente en 250 con derecho a 200, y el límite no existe.
//   3. **Nada se rompe: solo se bloquea añadir.** Un cliente puede quedar POR
//      ENCIMA (si se le baja el nivel o el límite). No se archiva nada solo, no
//      se corta nada: se le impide crear y desarchivar, y se le informa.
//
// LA TABLA DE ABAJO ES EL PUNTO FRÁGIL DE TODO ESTO. No hay convención para
// «esto está activo»: `products` usa `estado`, `almacenes` usa `activo`, `cajas`
// y `cuentas` usan `activa` (femenino) y `empleados` no usa ninguna, sino
// `fecha_baja is null`. Pedirle a PostgREST una columna que la tabla no tiene NO
// devuelve error: rompe la consulta entera, el conteo cae a 0 y **el límite deja
// de existir en silencio**. Las diez filas están verificadas contra
// `information_schema` (Fase 0, 2026-08-27) y `audit:limites` las revalida.
//
// CUIDADO ESPECIAL CON `products`: tiene DOS columnas de estado. `activo`
// (boolean) está MUERTA —nadie la lee, todas las filas en true—; la que mandan
// `archivarProducto` y `restaurarProducto` es `estado`. Y la tabla mezcla
// `tipo='PRODUCTO'` con `tipo='SERVICIO'`, que son DOS dimensiones distintas: con
// un solo contador, contratar el módulo Servicios comería el cupo de Inventario,
// y los módulos son independientes.
// ─────────────────────────────────────────────────────────────────────────────

import type { createAdminClient } from '@/lib/supabase/admin'

type Db = ReturnType<typeof createAdminClient>

export type Dimension =
  | 'empresas'
  | 'puntos_venta'
  | 'trabajadores'
  | 'productos'
  | 'servicios'
  | 'almacenes'
  | 'cuentas_tesoreria'
  | 'usuarios_portal'
  | 'dossiers'
  | 'ia_conversaciones'

/** Un filtro de «está activo». Declarativo para que `audit:limites` pueda leerlo. */
type Filtro =
  | { col: string; igual: string | boolean }
  | { col: string; esNulo: true }

interface DefDimension {
  /** Etiqueta en lenguaje humano, para los mensajes. Singular/plural + género. */
  uno: string
  varios: string
  genero: 'm' | 'f'
  tabla: string
  /** Columna que se pide en el `select` del conteo. */
  pk: string
  filtros: Filtro[]
  /**
   * Módulo que hay que tener contratado para que esta dimensión signifique algo.
   * `null` = plataforma (existe para todo cliente). Lo usa el escáner del cron:
   * avisarle de que se le llenan los productos a quien no tiene Inventario es
   * ruido, y el conteo ni siquiera querría hacerse.
   */
  modulo: string | null
}

/**
 * Las diez dimensiones. `ia_conversaciones` no está aquí: no se cuenta por filas
 * activas sino por uso del mes, y ya lo resuelve `cupoEfectivo()` en `lib/ia/modelo.ts`.
 */
export const DIMENSIONES: Record<Exclude<Dimension, 'ia_conversaciones'>, DefDimension> = {
  empresas: {
    uno: 'empresa', varios: 'empresas', genero: 'f',
    tabla: 'empresas', pk: 'empresa_id', modulo: null,
    filtros: [{ col: 'estado', igual: 'ACTIVO' }],
  },
  puntos_venta: {
    uno: 'punto de venta', varios: 'puntos de venta', genero: 'm',
    tabla: 'cajas', pk: 'caja_id', modulo: 'caja',
    filtros: [{ col: 'activa', igual: true }],          // ← femenino
  },
  trabajadores: {
    uno: 'trabajador', varios: 'trabajadores', genero: 'm',
    tabla: 'empleados', pk: 'empleado_id', modulo: 'rrhh',
    filtros: [{ col: 'fecha_baja', esNulo: true }],     // ← ni activo ni estado: una fecha
  },
  productos: {
    uno: 'producto', varios: 'productos', genero: 'm',
    tabla: 'products', pk: 'producto_id', modulo: 'inventario',
    filtros: [{ col: 'estado', igual: 'ACTIVO' }, { col: 'tipo', igual: 'PRODUCTO' }],
  },
  servicios: {
    uno: 'servicio', varios: 'servicios', genero: 'm',
    tabla: 'products', pk: 'producto_id', modulo: 'servicios',
    filtros: [{ col: 'estado', igual: 'ACTIVO' }, { col: 'tipo', igual: 'SERVICIO' }],
  },
  almacenes: {
    uno: 'almacén', varios: 'almacenes', genero: 'm',
    tabla: 'almacenes', pk: 'almacen_id', modulo: 'inventario',
    filtros: [{ col: 'activo', igual: true }],          // ← masculino
  },
  cuentas_tesoreria: {
    uno: 'cuenta', varios: 'cuentas de tesorería', genero: 'f',
    tabla: 'cuentas', pk: 'cuenta_id', modulo: 'base',
    // `activa` es femenino aquí. Y fuera las de «Apertura»: son fontanería del
    // importador (mig. 130), el dueño no las creó ni las ve en su listado, y
    // cobrarle cupo por ellas sería cobrarle por migrar sus datos.
    filtros: [{ col: 'activa', igual: true }, { col: 'es_apertura', igual: false }],
  },
  usuarios_portal: {
    uno: 'usuario', varios: 'usuarios', genero: 'm',
    tabla: 'client_users', pk: 'user_id', modulo: null,
    filtros: [{ col: 'estado', igual: 'ACTIVO' }],
  },
  dossiers: {
    uno: 'dossier', varios: 'dossiers', genero: 'm',
    tabla: 'dossiers', pk: 'dossier_id', modulo: 'dossier',
    filtros: [],   // `estado` es BORRADOR/PUBLICADO: NO es archivado. Cuentan todos.
  },
}

/**
 * Las diez que tienen fila en `nivel_limites`, en el orden en que se pintan.
 * `ia_conversaciones` va la última porque se mide distinto (uso del mes, no filas
 * activas) y conviene que se lea como lo que es: la excepción.
 */
export const DIMENSIONES_LIMITE: Dimension[] = [
  ...(Object.keys(DIMENSIONES) as Exclude<Dimension, 'ia_conversaciones'>[]),
  'ia_conversaciones',
]

/**
 * Las que se enseñan en la TARJETA de nivel de la landing (§11.1 del plan): las
 * que venden. El resto va en la comparativa desplegable, que sí las lista todas.
 *
 * Va en código y no en una columna de BD —el paralelo sería `mostrar_en_landing`
 * de `modulos_catalogo`— porque las dimensiones no son datos: cada una necesita
 * tabla, columna de «activo» y filtros escritos aquí arriba. Una columna en BD
 * daría a elegir entre nueve valores fijos y abriría la puerta a que la clave de
 * la fila y la de este fichero se separen. Los números SÍ se editan en vivo desde
 * /admin/niveles; esto es solo cuáles se enseñan.
 */
export const DIMENSIONES_LANDING: Dimension[] = [
  'empresas', 'puntos_venta', 'trabajadores', 'productos', 'ia_conversaciones',
]

/** Etiqueta en plural de una dimensión, para las pantallas del admin. */
export function etiquetaDimension(dim: Dimension): string {
  return dim === 'ia_conversaciones'
    ? 'conversaciones de IA al mes'
    : DIMENSIONES[dim].varios
}

/**
 * Clave con la que «subir de nivel» viaja por el circuito de contratación
 * (`soporte_mensajes.modulo_clave`). No es un módulo del catálogo —no tiene fila
 * en `modulos_catalogo`—, es el nivel.
 *
 * Vive aquí y no en el dashboard porque la piden DOS pantallas: el banner de
 * captación y la tarjeta de capacidad de Facturación. Y las dos tienen que usar
 * la misma cadena, o «ya lo pediste» se vería en una y no en la otra.
 */
export const OFERTA_NIVEL = 'nivel_superior'

// ── Contexto: nivel del cliente y sus límites ya resueltos ──────────────────

export interface ContextoLimites {
  nivel: string
  /** Nombre de cara al cliente, editable desde /admin/niveles. */
  nivelNombre: string
  /** Por dimensión: número, o null = ILIMITADO. Ya con el override del cliente aplicado. */
  limites: Partial<Record<Dimension, number | null>>
}

/**
 * Carga el nivel del cliente y todos sus límites de una vez.
 *
 * Orden de resolución: `clients.limites_override[dim]` gana sobre
 * `nivel_limites`. Es la válvula del salto Inicial→Empresa: un cliente que solo
 * se pasa en una dimensión no tiene por qué duplicar la factura.
 *
 * `extra_por_empresa` está sembrado a 0 en todas partes (límite plano, total por
 * cliente). Solo si alguna fila lo trae distinto se paga el conteo de empresas.
 */
export async function cargarContextoLimites(
  db: Db, clientId: string, nivelHipotetico?: string,
): Promise<ContextoLimites> {
  const { data: cli } = await db
    .from('clients')
    .select('nivel, limites_override')
    .eq('client_id', clientId)
    .maybeSingle()

  // `nivelHipotetico` sirve al «¿y si le subo de nivel?» del admin: los mismos
  // límites resueltos contra otra columna, sin escribir nada.
  const nivel = nivelHipotetico
    ?? (typeof cli?.nivel === 'string' ? cli.nivel : 'inicial')

  const [{ data: filas }, { data: nivelRow }] = await Promise.all([
    db.from('nivel_limites').select('dimension, base, extra_por_empresa').eq('nivel', nivel),
    db.from('niveles').select('nombre').eq('clave', nivel).maybeSingle(),
  ])

  const escalan = (filas ?? []).some((f: { extra_por_empresa: number }) => Number(f.extra_por_empresa) > 0)
  const empresas = escalan ? await contarActivos(db, clientId, 'empresas') : 1

  // `limites_override` es `{ dimension: número }`. La clave reservada `_motivos`
  // guarda el porqué de cada excepción (`{ _motivos: { empresas: '…' } }`) y no
  // estorba: `Number({…})` es NaN y cae por el filtro de abajo.
  const override = (cli?.limites_override && typeof cli.limites_override === 'object')
    ? cli.limites_override as Record<string, unknown>
    : {}

  const limites: Partial<Record<Dimension, number | null>> = {}
  for (const f of (filas ?? []) as { dimension: string; base: number | null; extra_por_empresa: number }[]) {
    const dim = f.dimension as Dimension
    const propio = Number(override[dim])
    if (Number.isFinite(propio) && propio > 0) { limites[dim] = Math.floor(propio); continue }
    if (f.base === null || f.base === undefined) { limites[dim] = null; continue }   // ilimitado
    limites[dim] = Number(f.base) + Math.max(0, empresas - 1) * Number(f.extra_por_empresa ?? 0)
  }

  return { nivel, nivelNombre: typeof nivelRow?.nombre === 'string' ? nivelRow.nombre : nivel, limites }
}

/** Atajo de una sola dimensión. `null` = ilimitado. */
export async function limiteDe(db: Db, clientId: string, dim: Dimension): Promise<number | null> {
  const ctx = await cargarContextoLimites(db, clientId)
  return ctx.limites[dim] ?? null
}

// ── Conteo ──────────────────────────────────────────────────────────────────

/** Cuántos ACTIVOS tiene el cliente en esa dimensión. */
export async function contarActivos(
  db: Db, clientId: string, dim: Exclude<Dimension, 'ia_conversaciones'>,
): Promise<number> {
  const def = DIMENSIONES[dim]
  let q = db.from(def.tabla).select(def.pk, { count: 'exact', head: true }).eq('client_id', clientId)
  for (const f of def.filtros) {
    q = 'esNulo' in f ? q.is(f.col, null) : q.eq(f.col, f.igual)
  }
  const { count, error } = await q
  // Un error aquí NO puede leerse como «cero»: sería el límite desapareciendo en
  // silencio, que es justo lo que este fichero existe para evitar. Se propaga.
  if (error) throw new Error(`No se pudo contar ${def.varios}: ${error.message}`)
  return count ?? 0
}

// ── Mensajes ────────────────────────────────────────────────────────────────
// Una línea. Ni párrafo, ni enlace a nada largo: el cliente ya sabe lo que quería
// hacer, solo necesita saber por qué no puede y qué le queda.

export function mensajeLimiteCrear(dim: Exclude<Dimension, 'ia_conversaciones'>, limite: number, nivelNombre: string): string {
  const d = DIMENSIONES[dim]
  return `Has llegado a ${limite} ${d.varios}, el máximo de tu nivel ${nivelNombre}.`
}

export function mensajeLimiteDesarchivar(dim: Exclude<Dimension, 'ia_conversaciones'>, usado: number, limite: number): string {
  const d = DIMENSIONES[dim]
  return `Estás en ${usado} de ${limite} ${d.varios}. Archiva ${d.genero === 'f' ? 'otra' : 'otro'} o sube de nivel.`
}

/** Sirve igual para una selección de la tabla y para un fichero del importador. */
export function mensajeLimiteLote(dim: Exclude<Dimension, 'ia_conversaciones'>, cabian: number, pedidos: number): string {
  const d = DIMENSIONES[dim]
  return `Tu nivel permite ${cabian} ${d.varios} más y aquí hay ${pedidos}.`
}

// ── La comprobación ─────────────────────────────────────────────────────────

/**
 * ¿Puede el cliente añadir `aAgregar` en esta dimensión?
 * Devuelve el mensaje de error, o `null` si puede seguir.
 *
 * `motivo: 'desarchivar'` solo cambia el texto — la regla es idéntica, y esa es
 * justamente la que cierra la trampa de archivar para liberar cupo.
 *
 * OJO: un cliente por encima del límite NO se queda bloqueado en el resto del
 * portal. Solo no puede añadir más de ESTO.
 */
export async function comprobarLimite(
  db: Db,
  clientId: string,
  dim: Exclude<Dimension, 'ia_conversaciones'>,
  aAgregar = 1,
  motivo: 'crear' | 'desarchivar' = 'crear',
): Promise<string | null> {
  const ctx = await cargarContextoLimites(db, clientId)
  const limite = ctx.limites[dim]
  if (limite === null || limite === undefined) return null      // ilimitado

  const usado = await contarActivos(db, clientId, dim)
  if (usado + aAgregar <= limite) return null

  // El mensaje de lote va PRIMERO aunque sea un desarchivado: quien seleccionó
  // doce necesita saber que caben tres, no que le falta uno.
  if (aAgregar > 1)             return mensajeLimiteLote(dim, Math.max(0, limite - usado), aAgregar)
  if (motivo === 'desarchivar') return mensajeLimiteDesarchivar(dim, usado, limite)
  return mensajeLimiteCrear(dim, limite, ctx.nivelNombre)
}

/**
 * Cuántos caben todavía. `null` = ilimitado, `0` = ni uno más.
 * Lo usan los importadores para recortar el lote en vez de reventarlo entero:
 * importar 200 de 400 es infinitamente mejor que un error y cero filas.
 */
export async function huecoDisponible(
  db: Db, clientId: string, dim: Exclude<Dimension, 'ia_conversaciones'>,
): Promise<number | null> {
  const ctx = await cargarContextoLimites(db, clientId)
  const limite = ctx.limites[dim]
  if (limite === null || limite === undefined) return null
  return Math.max(0, limite - await contarActivos(db, clientId, dim))
}

// ── Uso vs. límite, para las pantallas ──────────────────────────────────────

export interface UsoDimension {
  dimension: Dimension
  etiqueta: string
  usado: number
  limite: number | null      // null = ilimitado
  /** Por encima del límite: pasa si se baja el nivel o el límite. No rompe nada. */
  excedido: boolean
  /** A partir del 90 % se avisa al dueño y al equipo. */
  cerca: boolean
}

/**
 * Las nueve dimensiones contables con su uso actual. Alimenta el contador de cada
 * vista del portal, el banner de exceso y la tarjeta «uso vs. límite» del admin,
 * que es la que contesta «¿a quién le vendo el siguiente nivel?» sin preguntar.
 *
 * No incluye `ia_conversaciones`: esa se mide por mes, no por filas activas.
 */
export async function usoDeLimites(
  db: Db, clientId: string, nivelHipotetico?: string,
): Promise<UsoDimension[]> {
  const ctx = await cargarContextoLimites(db, clientId, nivelHipotetico)
  const claves = Object.keys(DIMENSIONES) as Exclude<Dimension, 'ia_conversaciones'>[]
  const usos = await Promise.all(claves.map(d => contarActivos(db, clientId, d)))

  return claves.map((dimension, i) => {
    const usado  = usos[i]
    const limite = ctx.limites[dimension] ?? null
    return {
      dimension,
      etiqueta: DIMENSIONES[dimension].varios,
      usado,
      limite,
      excedido: limite !== null && usado > limite,
      cerca:    limite !== null && usado <= limite && usado >= Math.ceil(limite * 0.9),
    }
  })
}
