'use server'

// ── Conteo físico (mig. 156) ──
//
// Contar lo que hay de verdad y cuadrar el sistema. Hasta ahora eran N ajustes a
// mano, uno por producto, así que se contaba en papel y no se cargaba nunca — que es
// la razón real de que el stock del sistema se separe de la realidad.
//
// Dos reglas de fondo, las dos deliberadas:
//
//  1. El borrador VIVE EN EL SERVIDOR. Contar un almacén lleva horas, se hace en
//     varias sesiones y en Cuba con cortes de luz de por medio; un conteo que se
//     pierde al cerrar la pestaña no se vuelve a empezar, se abandona.
//  2. La diferencia se calcula AL APLICAR, contra el stock vivo — nunca con el
//     `esperado` guardado. Entre abrir la hoja y aplicar el conteo puede haber
//     vendido el TPV, y aplicar un delta viejo corrompería el stock justo en la
//     operación que existe para arreglarlo.

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { LIMITE_LISTADO } from '@/lib/listados'
import { leerArchivo, type ArchivoLeido, type FormatoArchivo } from '@/lib/importador/archivo'
import { norm } from '@/lib/importador/util'
import { parseNumeroEsOpcional } from '@/lib/numeros'
import { getPortalSession, puedeEditarModulo, accesoModulosSession } from './auth'
import {
  aplicarMovimiento, stockEnAlmacen,
  esMotivoValido, motivoValidoParaDiferencia, MOTIVO_LABEL, type MotivoTipo,
} from './_inventario-helpers'

export type EstadoConteo = 'BORRADOR' | 'APLICADO' | 'ANULADO'

export interface Conteo {
  conteo_id:   string
  almacen_id:  string
  empresa_id:  string
  estado:      EstadoConteo
  fecha:       string
  notas:       string | null
  /** Quién contó, texto libre (mig. 159): quien cuenta rara vez es quien teclea. */
  contado_por: string | null
  aplicado_at: string | null
  created_at:  string
}

export interface LineaConteo {
  producto_id: string
  nombre:      string
  codigo:      string
  unidad:      string
  /** Stock del sistema AHORA (no el guardado al abrir): es lo que se compara. */
  sistema:     number
  esperado:    number | null
  contado:     number | null
  /** Causa de la diferencia (mig. 159). La hereda el AJUSTE que se genere. */
  motivo_tipo: MotivoTipo | null
  nota:        string | null
  /** Coste unitario en `moneda` del detalle, para valorar el faltante. NULL si no hay. */
  costo:       number | null
  /**
   * En un conteo APLICADO, el ajuste que se llegó a hacer, leído del ledger.
   *
   * No se deduce de `contado − esperado`: el stock se movió mientras se contaba, así
   * que la única diferencia real es la que se aplicó. NULL en un borrador.
   */
  delta_aplicado: number | null
}

export interface ConteoDetalle {
  conteo:      Conteo
  almacen:     string
  lineas:      LineaConteo[]
  /**
   * Moneda en la que se valora el acta (la primera con costes registrados). NULL si
   * el cliente no tiene costes: entonces el acta dice unidades y no finge un importe.
   */
  moneda:      string | null
  /**
   * Nombres del personal activo, para sugerir en «Contado por» — SOLO si el cliente
   * tiene RRHH contratado. Es llenado rápido aditivo, del patrón del repo: sin el
   * módulo, la lista viene vacía y el campo sigue siendo texto libre normal. Quien
   * cuenta puede ser alguien que no está en nómina, así que se sugiere, no se impone.
   */
  personal:    string[]
}

/** Una línea del acta: la diferencia, su causa y lo que cuesta. */
export interface LineaActa {
  producto_id: string
  nombre:      string
  codigo:      string
  unidad:      string
  sistema:     number
  contado:     number
  diferencia:  number
  motivo_tipo: MotivoTipo | null
  nota:        string | null
  valor:       number | null
}

function generarConteoId(): string {
  return `CNT-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

// ── Abrir (o recuperar) el conteo de un almacén ────────────────────────────────

/**
 * Devuelve el conteo en BORRADOR de ese almacén, y si no hay lo crea con una línea
 * por producto con existencias o con mínimo configurado ahí.
 *
 * Un conteo es de UN almacén: contar dos a la vez es contar mal.
 */
export async function abrirConteo(
  almacen_id: string,
): Promise<{ ok: boolean; error?: string; conteo_id?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: alm } = await db.from('almacenes')
    .select('almacen_id, empresa_id, activo')
    .eq('almacen_id', almacen_id).eq('client_id', session.client_id).maybeSingle()
  if (!alm) return { ok: false, error: 'Almacén no encontrado.' }
  if (!alm.activo) return { ok: false, error: 'Este almacén está archivado. Restáuralo antes de contarlo.' }

  // Uno a la vez: dos conteos abiertos del mismo almacén son dos verdades distintas.
  const { data: abierto } = await db.from('conteos')
    .select('conteo_id')
    .eq('client_id', session.client_id).eq('almacen_id', almacen_id).eq('estado', 'BORRADOR')
    .maybeSingle()
  if (abierto) return { ok: true, conteo_id: abierto.conteo_id as string }

  const conteo_id = generarConteoId()
  const { error: eC } = await db.from('conteos').insert({
    conteo_id, client_id: session.client_id,
    almacen_id, empresa_id: alm.empresa_id,
    estado: 'BORRADOR',
    fecha: new Date().toISOString().split('T')[0],
    updated_at: new Date().toISOString(),
  })
  if (eC) {
    // 23505 = el índice único de la mig. 160: otra petición abrió el borrador entre
    // nuestro `select` y este `insert`. No es un error, es la carrera que el índice
    // existe para cortar: se devuelve el que ganó. El `select` de arriba NO basta como
    // idempotencia —dos peticiones simultáneas no ven nada las dos—, y así fue como se
    // llegó a 352 borradores del mismo almacén.
    if (eC.code === '23505') {
      const { data: gano } = await db.from('conteos')
        .select('conteo_id')
        .eq('client_id', session.client_id).eq('almacen_id', almacen_id).eq('estado', 'BORRADOR')
        .maybeSingle()
      if (gano) return { ok: true, conteo_id: gano.conteo_id as string }
    }
    return { ok: false, error: eC.message }
  }

  // Las líneas: lo que hay ahí, más lo que TIENE MÍNIMO ahí aunque esté a cero (un
  // producto agotado es justo el que hay que confirmar que sigue agotado).
  const [{ data: stock }, { data: cfg }, { data: prods }] = await Promise.all([
    db.from('stock_almacenes').select('producto_id, cantidad')
      .eq('client_id', session.client_id).eq('almacen_id', almacen_id),
    db.from('producto_almacen_config').select('producto_id')
      .eq('client_id', session.client_id).eq('almacen_id', almacen_id).not('stock_minimo', 'is', null),
    db.from('products').select('producto_id, tipo, estado').eq('client_id', session.client_id),
  ])

  const validos = new Set(((prods ?? []) as { producto_id: string; tipo: string; estado: string }[])
    .filter(p => p.tipo === 'PRODUCTO' && p.estado === 'ACTIVO')
    .map(p => p.producto_id))
  const cantidadDe = new Map(((stock ?? []) as { producto_id: string; cantidad: number }[])
    .map(s => [s.producto_id, Number(s.cantidad)]))
  const ids = new Set<string>([
    ...cantidadDe.keys(),
    ...((cfg ?? []) as { producto_id: string }[]).map(c => c.producto_id),
  ])

  const filas = [...ids]
    .filter(id => validos.has(id))
    .map(producto_id => ({
      conteo_id, client_id: session.client_id, producto_id,
      esperado: cantidadDe.get(producto_id) ?? 0,
      contado:  null,
      updated_at: new Date().toISOString(),
    }))
  if (filas.length) await db.from('conteo_lineas').insert(filas)

  // Sin `revalidatePath`: `/portal/almacenes/[id]` es `force-dynamic`, así que no hay
  // caché que invalidar y el listado de conteos ya sale al volver.
  return { ok: true, conteo_id }
}

/**
 * Tira el borrador abierto de este almacén y empieza uno nuevo.
 *
 * Existe porque **el borrador no caduca**: un conteo que se guardó sin aplicar sigue
 * abierto para siempre, y al mes siguiente «Contar» devolvía la MISMA hoja con las
 * cantidades del mes pasado escritas. Eso no es retomar un conteo, es partir de datos
 * viejos en la operación que existe para cuadrar el stock. Retomar sigue siendo lo
 * normal (contar un almacén lleva días); esto es la otra salida, y la elige el dueño
 * sabiendo la fecha del que hay abierto.
 *
 * No toca existencias: un borrador nunca ajustó nada.
 */
export async function empezarConteoNuevo(
  almacen_id: string,
): Promise<{ ok: boolean; error?: string; conteo_id?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: abierto } = await db.from('conteos')
    .select('conteo_id')
    .eq('client_id', session.client_id).eq('almacen_id', almacen_id).eq('estado', 'BORRADOR')
    .maybeSingle()

  if (abierto) {
    const viejo = abierto.conteo_id as string
    await db.from('conteo_lineas').delete()
      .eq('conteo_id', viejo).eq('client_id', session.client_id)
    // El borrado va antes de abrir el nuevo, no después: el índice único de la mig. 160
    // no admite dos borradores del mismo almacén.
    const { error } = await db.from('conteos').delete()
      .eq('conteo_id', viejo).eq('client_id', session.client_id)
    if (error) return { ok: false, error: error.message }
  }

  return abrirConteo(almacen_id)
}

export async function obtenerConteo(conteo_id: string): Promise<ConteoDetalle | null> {
  const session = await getPortalSession()
  if (!session) return null

  const db = createAdminClient()
  const { data: conteo } = await db.from('conteos').select('*')
    .eq('conteo_id', conteo_id).eq('client_id', session.client_id).maybeSingle()
  if (!conteo) return null

  const [{ data: lineas }, { data: prods }, { data: stock }, { data: alm }, { data: mon }, { data: movs }] = await Promise.all([
    db.from('conteo_lineas').select('producto_id, esperado, contado, motivo_tipo, nota')
      .eq('conteo_id', conteo_id).eq('client_id', session.client_id),
    db.from('products').select('producto_id, nombre, codigo, unidad, costos').eq('client_id', session.client_id),
    db.from('stock_almacenes').select('producto_id, cantidad')
      .eq('client_id', session.client_id).eq('almacen_id', conteo.almacen_id as string),
    db.from('almacenes').select('nombre')
      .eq('almacen_id', conteo.almacen_id as string).eq('client_id', session.client_id).maybeSingle(),
    db.from('monedas').select('codigo').eq('client_id', session.client_id).eq('activa', true).order('codigo'),
    // Los ajustes que este conteo llegó a hacer. Es el acta de verdad: el delta que se
    // aplicó, no el que se preveía al abrir la hoja.
    db.from('movimientos_inventario').select('producto_id, cantidad')
      .eq('client_id', session.client_id).eq('referencia_id', conteo_id).eq('tipo', 'AJUSTE'),
  ])

  // Personal para sugerir en «Contado por», SOLO con RRHH contratado (llenado rápido
  // aditivo: sin el módulo esto no existe y el campo sigue funcionando igual). Sin baja
  // = en plantilla, que es el mismo criterio que usa Nómina (`estadoDe`).
  const acceso = await accesoModulosSession(session)
  let personal: string[] = []
  if (acceso.visibles.includes('rrhh')) {
    const { data: emp } = await db.from('empleados')
      .select('nombre, apellidos')
      .eq('client_id', session.client_id).is('fecha_baja', null).order('nombre')
    personal = ((emp ?? []) as { nombre: string; apellidos: string | null }[])
      .map(e => `${e.nombre} ${e.apellidos ?? ''}`.trim())
      .filter(Boolean)
  }

  type Prd = { producto_id: string; nombre: string; codigo: string; unidad: string; costos: Record<string, number> | null }
  const prodDe = new Map(((prods ?? []) as Prd[]).map(p => [p.producto_id, p]))
  const vivoDe = new Map(((stock ?? []) as { producto_id: string; cantidad: number }[])
    .map(s => [s.producto_id, Number(s.cantidad)]))

  type Fila = {
    producto_id: string; esperado: number | null; contado: number | null
    motivo_tipo: string | null; nota: string | null
  }
  const filas = (lineas ?? []) as Fila[]

  // La moneda del acta sigue la misma regla que el detalle de almacén: la primera en
  // la que hay costes de verdad. Sin costes no hay moneda y el acta va en unidades —
  // un importe inventado en un acta de faltantes es peor que no dar importe.
  const moneda = ((mon ?? []) as { codigo: string }[])
    .map(m => m.codigo)
    .find(m => filas.some(f => prodDe.get(f.producto_id)?.costos?.[m] != null)) ?? null

  // Un conteo puede haber ajustado el mismo producto una sola vez, pero se suma por si
  // acaso: el ledger es la fuente y no se le impone una forma que no garantiza.
  const aplicadoDe = new Map<string, number>()
  for (const m of (movs ?? []) as { producto_id: string; cantidad: number }[]) {
    aplicadoDe.set(m.producto_id, (aplicadoDe.get(m.producto_id) ?? 0) + Number(m.cantidad))
  }

  const out: LineaConteo[] = filas
    .map(l => {
      const p = prodDe.get(l.producto_id)
      return {
        producto_id: l.producto_id,
        nombre:      p?.nombre ?? l.producto_id,
        codigo:      p?.codigo ?? '',
        unidad:      p?.unidad ?? '',
        sistema:     vivoDe.get(l.producto_id) ?? 0,
        esperado:    l.esperado != null ? Number(l.esperado) : null,
        contado:     l.contado  != null ? Number(l.contado)  : null,
        motivo_tipo: (l.motivo_tipo as MotivoTipo | null) ?? null,
        nota:        l.nota ?? null,
        costo:       moneda ? (p?.costos?.[moneda] ?? null) : null,
        delta_aplicado: aplicadoDe.get(l.producto_id) ?? null,
      }
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

  return {
    conteo:  conteo as unknown as Conteo,
    almacen: (alm?.nombre as string) ?? '',
    lineas:  out,
    moneda,
    personal,
  }
}

// ── Listado: el acta tiene que poder encontrarse ───────────────────────────────

export interface ResumenConteo {
  conteo_id:   string
  fecha:       string
  estado:      EstadoConteo
  contado_por: string | null
  notas:       string | null
  /** Cuándo se abrió: dos conteos del mismo día solo se distinguen por la hora. */
  created_at:  string
  aplicado_at: string | null
  /** Líneas contadas y, de esas, cuántas descuadraron. */
  contadas:    number
  diferencias: number
}

/**
 * Conteos de un almacén, del más reciente al más viejo.
 *
 * Sin esto el acta existía en la base y era **inalcanzable**: se aplicaba el conteo y
 * desaparecía de la vista, cuando es justo el documento que hay que poder enseñar.
 */
export async function obtenerConteosDeAlmacen(almacen_id: string): Promise<ResumenConteo[]> {
  const session = await getPortalSession()
  if (!session) return []

  const db = createAdminClient()
  const { data: conteos } = await db.from('conteos')
    .select('conteo_id, fecha, estado, contado_por, notas, created_at, aplicado_at')
    .eq('client_id', session.client_id).eq('almacen_id', almacen_id)
    .order('fecha', { ascending: false }).order('created_at', { ascending: false })
    .limit(LIMITE_LISTADO)
  const ids = ((conteos ?? []) as { conteo_id: string }[]).map(c => c.conteo_id)
  if (ids.length === 0) return []

  const { data: lineas } = await db.from('conteo_lineas')
    .select('conteo_id, contado, motivo_tipo')
    .eq('client_id', session.client_id).in('conteo_id', ids)
    .not('contado', 'is', null)

  const contadas = new Map<string, number>()
  const difs     = new Map<string, number>()
  for (const l of (lineas ?? []) as { conteo_id: string; contado: number; motivo_tipo: string | null }[]) {
    contadas.set(l.conteo_id, (contadas.get(l.conteo_id) ?? 0) + 1)
    // Una línea con causa es, por definición, una que descuadró: la causa solo se pide
    // cuando hay diferencia. Contarlo así evita releer el stock vivo de cada conteo
    // viejo para reconstruir un descuadre que ya se resolvió.
    if (l.motivo_tipo) difs.set(l.conteo_id, (difs.get(l.conteo_id) ?? 0) + 1)
  }

  return ((conteos ?? []) as Record<string, unknown>[]).map(c => ({
    conteo_id:   c.conteo_id as string,
    fecha:       c.fecha as string,
    estado:      c.estado as EstadoConteo,
    contado_por: (c.contado_por as string) ?? null,
    notas:       (c.notas as string) ?? null,
    created_at:  c.created_at as string,
    aplicado_at: (c.aplicado_at as string) ?? null,
    contadas:    contadas.get(c.conteo_id as string) ?? 0,
    diferencias: difs.get(c.conteo_id as string) ?? 0,
  }))
}

// ── Cabecera: quién contó y las notas del acta ─────────────────────────────────

export async function guardarCabeceraConteo(
  conteo_id: string, contado_por: string, notas: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: conteo } = await db.from('conteos').select('estado')
    .eq('conteo_id', conteo_id).eq('client_id', session.client_id).maybeSingle()
  if (!conteo) return { ok: false, error: 'Conteo no encontrado.' }
  if (conteo.estado !== 'BORRADOR') return { ok: false, error: 'Este conteo ya se aplicó: es solo lectura.' }

  const { error } = await db.from('conteos').update({
    contado_por: contado_por.trim() || null,
    notas:       notas.trim() || null,
    updated_at:  new Date().toISOString(),
  }).eq('conteo_id', conteo_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── Guardar avance ─────────────────────────────────────────────────────────────

/**
 * Guarda un lote de líneas contadas.
 *
 * EN LOTE y con rebote desde el cliente, nunca una petición por tecla: sobre 3G eso
 * es la diferencia entre usable e inservible.
 */
export async function guardarAvanceConteo(
  conteo_id: string,
  // Las tres columnas viajan SIEMPRE juntas, aunque solo cambie una: el upsert de
  // PostgREST escribe la unión de claves del lote, así que mandar `contado` a secas en
  // una fila y `nota` en otra dejaría la que falta a NULL. El cliente manda el estado
  // completo de la línea y aquí no hay que adivinar nada.
  lineas: { producto_id: string; contado: number | null; motivo_tipo: string | null; nota: string | null }[],
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  if (!Array.isArray(lineas) || lineas.length === 0) return { ok: true }

  const db = createAdminClient()
  const { data: conteo } = await db.from('conteos').select('estado')
    .eq('conteo_id', conteo_id).eq('client_id', session.client_id).maybeSingle()
  if (!conteo) return { ok: false, error: 'Conteo no encontrado.' }
  if (conteo.estado !== 'BORRADOR') return { ok: false, error: 'Este conteo ya se aplicó: es solo lectura.' }

  const filas = lineas
    .filter(l => l.contado == null || (Number.isFinite(l.contado) && l.contado >= 0))
    .map(l => ({
      conteo_id, client_id: session.client_id,
      producto_id: l.producto_id,
      contado:     l.contado,
      // La causa se guarda tal cual llega, sin validar el signo: mientras se cuenta, el
      // stock vivo se mueve y una causa que ahora encaja puede dejar de encajar. La
      // validación es de `aplicarConteo`, que es quien conoce la diferencia definitiva.
      motivo_tipo: l.motivo_tipo && esMotivoValido(l.motivo_tipo) ? l.motivo_tipo : null,
      nota:        l.nota?.trim() ? l.nota.trim().slice(0, 300) : null,
      updated_at:  new Date().toISOString(),
    }))
  if (!filas.length) return { ok: false, error: 'Las cantidades contadas no pueden ser negativas.' }

  const { error } = await db.from('conteo_lineas').upsert(filas, { onConflict: 'conteo_id,producto_id' })
  if (error) return { ok: false, error: error.message }

  await db.from('conteos').update({ updated_at: new Date().toISOString() })
    .eq('conteo_id', conteo_id).eq('client_id', session.client_id)
  return { ok: true }
}

// ── Importar la hoja rellenada ─────────────────────────────────────────────────
//
// La hoja de conteo en blanco (Excel, CSV o PDF) era un **callejón sin salida**: se
// imprimía, se contaba con ella en la mano y luego había que teclear las 200 cantidades
// a mano en la pantalla. Contar en papel y no poder cargarlo es exactamente el hábito
// que este módulo vino a romper, así que la plantilla tiene que tener vuelta.

/** Cabeceras que se aceptan como «el código», «el producto» y «lo contado». */
const CAB_CODIGO  = ['codigo', 'cod', 'referencia', 'ref', 'sku']
const CAB_NOMBRE  = ['producto', 'nombre', 'descripcion', 'articulo']
// «cantidad» va al final a propósito: en la hoja que genera CLAUX la columna es
// «Contado», y en un archivo ajeno «Cantidad» suele ser lo que dice el sistema. Solo se
// usa si no hay ninguna mejor.
const CAB_CONTADO = ['contado', 'cantidad contada', 'cantidad real', 'conteo', 'real', 'fisico', 'existencia real', 'cantidad']

export interface ResultadoImportConteo {
  ok: boolean
  error?: string
  /** Lo que ha quedado escrito, para pintarlo sin recargar la pantalla. */
  lineas?: { producto_id: string; contado: number }[]
  /** Filas que no se han podido colocar, con el texto tal como venía en el archivo. */
  sinEmparejar?: string[]
  avisos?: string[]
}

/**
 * Carga la columna «Contado» de un Excel o CSV en la hoja abierta.
 *
 * Tres decisiones deliberadas:
 *
 *  · **Solo rellena `contado`.** La causa y el detalle que ya estuvieran escritos en la
 *    pantalla no se tocan: el papel trae cantidades, no explicaciones.
 *  · **Solo líneas que YA están en la hoja.** Lo que no encaja se devuelve por su
 *    nombre en vez de inventar una línea: casi siempre es la hoja de otro almacén, y
 *    tragárselo en silencio metería en este conteo productos que no se han contado.
 *  · **No aplica nada.** Igual que el dictado por IA: rellena las casillas y el dueño
 *    revisa, pone causas y aplica cuando quiere.
 */
export async function importarConteoContado(
  conteo_id: string,
  contenido: string,
  formato: FormatoArchivo,
): Promise<ResultadoImportConteo> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: conteo } = await db.from('conteos').select('estado')
    .eq('conteo_id', conteo_id).eq('client_id', session.client_id).maybeSingle()
  if (!conteo) return { ok: false, error: 'Conteo no encontrado.' }
  if (conteo.estado !== 'BORRADOR') return { ok: false, error: 'Este conteo ya se aplicó: es solo lectura.' }

  let leido: ArchivoLeido
  try {
    leido = await leerArchivo(contenido, formato)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo leer el archivo.' }
  }

  const columna = (alias: string[]) => leido.cabeceras.find(c => alias.includes(norm(c)))
  const colContado = columna(CAB_CONTADO)
  if (!colContado) {
    return { ok: false, error: 'El archivo no tiene columna «Contado». Baja la hoja para contar de esta pantalla, rellena esa columna y súbela.' }
  }
  const colCodigo = columna(CAB_CODIGO)
  const colNombre = columna(CAB_NOMBRE)
  if (!colCodigo && !colNombre) {
    return { ok: false, error: 'No se sabe a qué producto va cada fila: el archivo no tiene columna de código ni de producto.' }
  }

  // Los productos de ESTA hoja, por código y por nombre. El nombre es el segundo intento
  // (hay hojas rellenadas a mano donde el código se ha quedado en blanco).
  const { data: enHoja } = await db.from('conteo_lineas').select('producto_id')
    .eq('conteo_id', conteo_id).eq('client_id', session.client_id)
  const ids = new Set(((enHoja ?? []) as { producto_id: string }[]).map(l => l.producto_id))
  if (ids.size === 0) return { ok: false, error: 'Esta hoja no tiene ninguna línea que rellenar.' }

  const { data: prods } = await db.from('products').select('producto_id, codigo, nombre')
    .eq('client_id', session.client_id)
  const porCodigo = new Map<string, string>()
  const porNombre = new Map<string, string>()
  for (const p of (prods ?? []) as { producto_id: string; codigo: string | null; nombre: string }[]) {
    if (!ids.has(p.producto_id)) continue
    if (p.codigo) porCodigo.set(norm(p.codigo), p.producto_id)
    porNombre.set(norm(p.nombre), p.producto_id)
  }

  const contadoDe = new Map<string, number>()
  const sinEmparejar: string[] = []
  const avisos = [...leido.avisos]
  let ilegibles = 0, negativas = 0, repetidas = 0

  for (const f of leido.filas) {
    // Vacío = no contado, y eso NO es cero: la casilla se queda como estaba. Es la
    // diferencia entre «no llegué a ese estante» y «no queda nada», que en un conteo es
    // la diferencia entre no hacer nada y generar un faltante del 100 %.
    const bruto = (f[colContado] ?? '').trim()
    if (bruto === '') continue

    const cod = colCodigo ? f[colCodigo] : ''
    const nom = colNombre ? f[colNombre] : ''
    const id  = (cod ? porCodigo.get(norm(cod)) : undefined)
            ?? (nom ? porNombre.get(norm(nom)) : undefined)
    if (!id) {
      const etiqueta = (cod || nom || '').trim() || `fila con «${bruto}»`
      if (!sinEmparejar.includes(etiqueta)) sinEmparejar.push(etiqueta)
      continue
    }

    const n = parseNumeroEsOpcional(bruto)
    if (n == null)                 { ilegibles++; continue }
    if (n < 0)                     { negativas++; continue }
    const redondo = Math.round(n * 1000) / 1000
    const previo  = contadoDe.get(id)
    if (previo != null && Math.abs(previo - redondo) > 0.0005) repetidas++
    contadoDe.set(id, redondo)
  }

  if (ilegibles) avisos.push(`${ilegibles} fila(s) traen en «Contado» algo que no es un número: se han saltado.`)
  if (negativas) avisos.push(`${negativas} fila(s) traen una cantidad negativa: no se puede contar en negativo y se han saltado.`)
  if (repetidas) avisos.push(`${repetidas} producto(s) salen dos veces con cantidades distintas: se ha guardado la última.`)

  if (contadoDe.size === 0) {
    return {
      ok: false,
      error: sinEmparejar.length
        ? 'Ninguna fila del archivo corresponde a un producto de esta hoja. Comprueba que es la hoja de este almacén.'
        : 'El archivo no trae ninguna cantidad en la columna «Contado».',
      sinEmparejar, avisos,
    }
  }

  // Todas las filas del lote llevan LAS MISMAS columnas: el upsert de PostgREST escribe
  // la unión de claves del lote, así que colar aquí `nota` o `motivo_tipo` en una sola
  // dejaría a NULL la de todas las demás. Por eso este import no escribe causas.
  const filas = [...contadoDe].map(([producto_id, contado]) => ({
    conteo_id, client_id: session.client_id, producto_id, contado,
    updated_at: new Date().toISOString(),
  }))
  const { error } = await db.from('conteo_lineas')
    .upsert(filas, { onConflict: 'conteo_id,producto_id' })
  if (error) return { ok: false, error: error.message }

  await db.from('conteos').update({ updated_at: new Date().toISOString() })
    .eq('conteo_id', conteo_id).eq('client_id', session.client_id)

  return {
    ok: true,
    lineas: filas.map(f => ({ producto_id: f.producto_id, contado: f.contado })),
    sinEmparejar, avisos,
  }
}

/** Añade un producto que no estaba en la hoja (apareció algo que el sistema no tenía). */
export async function anadirLineaConteo(
  conteo_id: string, producto_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: conteo } = await db.from('conteos').select('estado, almacen_id')
    .eq('conteo_id', conteo_id).eq('client_id', session.client_id).maybeSingle()
  if (!conteo) return { ok: false, error: 'Conteo no encontrado.' }
  if (conteo.estado !== 'BORRADOR') return { ok: false, error: 'Este conteo ya se aplicó: es solo lectura.' }

  const { data: prod } = await db.from('products').select('tipo')
    .eq('producto_id', producto_id).eq('client_id', session.client_id).maybeSingle()
  if (!prod) return { ok: false, error: 'Producto no encontrado.' }
  if (prod.tipo === 'SERVICIO') return { ok: false, error: 'Los servicios no tienen existencias.' }

  const esperado = await stockEnAlmacen(db, session.client_id, producto_id, conteo.almacen_id as string)
  const { error } = await db.from('conteo_lineas').upsert({
    conteo_id, client_id: session.client_id, producto_id,
    esperado, contado: null, updated_at: new Date().toISOString(),
  }, { onConflict: 'conteo_id,producto_id' })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── Aplicar ────────────────────────────────────────────────────────────────────

export interface ResultadoConteo {
  ok: boolean
  error?: string
  ajustes?: number
  /** Líneas cuyo stock del sistema cambió mientras se contaba: se dice, no se calla. */
  cambiadas?: number
  /** Líneas que descuadran y siguen SIN causa: por eso no se aplicó nada. */
  sinCausa?: { producto_id: string; nombre: string; diferencia: number }[]
}

/**
 * Aplica el conteo: un AJUSTE por línea con diferencia, todo al ledger.
 *
 * · La diferencia se recalcula contra el stock VIVO (regla 2 de la cabecera).
 * · **Cada AJUSTE lleva SU causa** (mig. 159), no un `'CONTEO'` para todo. Con una
 *   causa común, una caja robada y un error de teclado quedaban idénticos en el
 *   ledger, y la merma —que es dinero— no se podía sumar.
 * · Si alguna línea descuadra y no tiene causa, **no se aplica NADA** y se devuelven
 *   cuáles: aplicar la mitad dejaría un acta a medias y un stock que ya no coincide
 *   con lo que se contó, o sea imposible de retomar.
 * · `referencia_id = conteo_id`: la idempotencia la da el ledger, no un flag.
 * · Nunca escritura cruda sobre `stock_almacenes`: un conteo que no deja rastro en el
 *   ledger es exactamente el fallo que este módulo no tiene.
 */
export async function aplicarConteo(conteo_id: string): Promise<ResultadoConteo> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: conteo } = await db.from('conteos').select('*')
    .eq('conteo_id', conteo_id).eq('client_id', session.client_id).maybeSingle()
  if (!conteo) return { ok: false, error: 'Conteo no encontrado.' }
  if (conteo.estado !== 'BORRADOR') return { ok: false, error: 'Este conteo ya se aplicó.' }

  const { data: lineas } = await db.from('conteo_lineas')
    .select('producto_id, esperado, contado, motivo_tipo, nota')
    .eq('conteo_id', conteo_id).eq('client_id', session.client_id)
    .not('contado', 'is', null)

  type Pendiente = {
    producto_id: string; esperado: number | null; contado: number
    motivo_tipo: string | null; nota: string | null
  }
  const pendientes = (lineas ?? []) as Pendiente[]
  if (pendientes.length === 0) return { ok: false, error: 'No has contado ninguna línea todavía.' }

  const almacen_id = conteo.almacen_id as string
  const { data: stock } = await db.from('stock_almacenes').select('producto_id, cantidad')
    .eq('client_id', session.client_id).eq('almacen_id', almacen_id)
  const vivoDe = new Map(((stock ?? []) as { producto_id: string; cantidad: number }[])
    .map(s => [s.producto_id, Number(s.cantidad)]))

  // ── Primero el acta, después el stock ──
  // Se recorre TODO antes de tocar una sola existencia: hay que saber si el acta está
  // completa. Aplicar la mitad y fallar en la sexta línea dejaría un stock que ya no
  // coincide con lo contado y un conteo imposible de retomar.
  const fecha = new Date().toISOString().split('T')[0]
  const aplicar: { l: Pendiente; delta: number; motivo: MotivoTipo }[] = []
  const sinCausa: { producto_id: string; nombre: string; diferencia: number }[] = []
  let cambiadas = 0

  for (const l of pendientes) {
    const vivo    = vivoDe.get(l.producto_id) ?? 0
    const contado = Number(l.contado)
    if (l.esperado != null && Math.abs(Number(l.esperado) - vivo) > 0.0005) cambiadas++
    const delta = Math.round((contado - vivo) * 1000) / 1000
    if (Math.abs(delta) <= 0.0005) continue

    // La causa se valida CONTRA EL SIGNO de la diferencia definitiva: mientras se
    // contaba el TPV pudo vender y volver del revés un faltante que se justificó como
    // sobrante. Una causa que ya no encaja se trata como si no estuviera.
    if (!l.motivo_tipo || !motivoValidoParaDiferencia(l.motivo_tipo, delta)) {
      sinCausa.push({ producto_id: l.producto_id, nombre: '', diferencia: delta })
      continue
    }
    aplicar.push({ l, delta, motivo: l.motivo_tipo })
  }

  if (sinCausa.length > 0) {
    // Los nombres se resuelven solo aquí: el camino bueno no paga una consulta extra.
    const { data: prods } = await db.from('products').select('producto_id, nombre')
      .eq('client_id', session.client_id)
      .in('producto_id', sinCausa.map(s => s.producto_id))
    const nombreDe = new Map(((prods ?? []) as { producto_id: string; nombre: string }[])
      .map(p => [p.producto_id, p.nombre]))
    return {
      ok: false,
      error: sinCausa.length === 1
        ? 'Hay una diferencia sin causa. Di por qué falta o sobra antes de aplicar el conteo.'
        : `Hay ${sinCausa.length} diferencias sin causa. Di por qué falta o sobra en cada una antes de aplicar el conteo.`,
      sinCausa: sinCausa.map(s => ({ ...s, nombre: nombreDe.get(s.producto_id) ?? s.producto_id })),
    }
  }

  let ajustes = 0
  for (const { l, delta, motivo } of aplicar) {
    try {
      await aplicarMovimiento(db, {
        client_id:   session.client_id,
        empresa_id:  conteo.empresa_id as string,
        fecha,
        tipo:        'AJUSTE',
        producto_id: l.producto_id,
        almacen_id,
        cantidad:    delta,
        // El texto sale de la línea, no del conteo: la nota de esta diferencia es la
        // que explica ESTA diferencia. El `conteo_id` va delante para poder volver al
        // acta desde cualquier movimiento del ledger.
        motivo:      `${MOTIVO_LABEL[motivo]} · conteo ${conteo_id}${l.nota ? ` · ${l.nota}` : ''}`,
        motivo_tipo: motivo,
        origen:      'MANUAL',
        referencia_id: conteo_id,
        // Un conteo nunca deja negativo (`contado >= 0` y el ajuste lleva a `contado`),
        // pero un producto que YA estaba en negativo tiene delta positivo y hay que
        // dejarlo pasar: el conteo es la vía de saneamiento que no existía.
        permitir_negativo: true,
      })
      ajustes++
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Error al aplicar el conteo.' }
    }
  }

  await db.from('conteos').update({
    estado: 'APLICADO',
    aplicado_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('conteo_id', conteo_id).eq('client_id', session.client_id)

  revalidatePath('/portal/inventario')
  revalidatePath('/portal/productos')
  revalidatePath('/portal/almacenes')
  revalidatePath(`/portal/almacenes/${almacen_id}`)
  return { ok: true, ajustes, cambiadas }
}

/** Descarta un borrador de conteo sin tocar existencias. */
export async function anularConteo(conteo_id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session) return { ok: false, error: 'Sesión inválida.' }
  if (!(await puedeEditarModulo('inventario'))) return { ok: false, error: 'No tienes permiso para editar en este módulo.' }

  const db = createAdminClient()
  const { data: conteo } = await db.from('conteos').select('estado, almacen_id')
    .eq('conteo_id', conteo_id).eq('client_id', session.client_id).maybeSingle()
  if (!conteo) return { ok: false, error: 'Conteo no encontrado.' }
  if (conteo.estado !== 'BORRADOR') return { ok: false, error: 'Solo se puede descartar un conteo en borrador.' }

  await db.from('conteo_lineas').delete()
    .eq('conteo_id', conteo_id).eq('client_id', session.client_id)
  const { error } = await db.from('conteos').delete()
    .eq('conteo_id', conteo_id).eq('client_id', session.client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/portal/almacenes/${conteo.almacen_id as string}`)
  return { ok: true }
}
