'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermiso } from '@/lib/admin-guard'
import { logActividad } from '@/lib/audit'
import { optimizarCaptura } from '@/lib/imagen/optimizar'
import { avisoPropuestas, refrescarPropuestasConModulo } from '@/lib/propuesta/refrescar'

// ── La biblioteca de capturas de producto ────────────────────────────────────
//
// Ocho de las dieciséis diapositivas de la propuesta son pantallazos, y no hay
// ninguno en el repo. Esta es la biblioteca: se sube una vez y se reutiliza en
// todas las propuestas, por módulo y por vista, con variante opcional por
// sector.
//
// Dos cosas que no se dejan a la memoria de nadie:
//
//   · **El peso.** ≤ 180 KB en WebP, garantizado por `optimizarCaptura`, no
//     pedido en un texto de ayuda. Quien abre la propuesta suele estar en Cuba
//     con 3G y son ocho imágenes seguidas.
//   · **La caducidad.** La UI se mueve cada semana y una propuesta que enseña
//     una pantalla que ya no existe es peor que no enseñar ninguna. Cada fila
//     guarda `capturada_at` y el listado cuenta las que pasan de 90 días.
//
// Permiso `propuestas`, como el resto del módulo. NO entra en `audit:gating`:
// ese centinela vigila las acciones del portal.

const BUCKET = 'capturas'
const MAX_SUBIDA = 12 * 1024 * 1024   // lo que se acepta ANTES de recomprimir

export interface CapturaRow {
  id:            number
  modulo:        string
  modulo_nombre: string
  vista:         string
  url:           string
  alt:           string
  ancho:         number | null
  alto:          number | null
  sector:        string[]
  orden:         number
  capturada_at:  string
  activa:        boolean
}

export async function listarCapturas(): Promise<CapturaRow[]> {
  await requirePermiso('propuestas')
  const db = createAdminClient()

  const [capRes, modRes] = await Promise.all([
    db.from('capturas_producto')
      .select('id, modulo, vista, url, alt, ancho, alto, sector, orden, capturada_at, activa')
      .order('orden', { ascending: true }),
    db.from('modulos_catalogo').select('clave, nombre, orden').order('orden', { ascending: true }),
  ])

  const nombres = new Map<string, string>(
    ((modRes.data ?? []) as { clave: string; nombre: string }[]).map(m => [m.clave, m.nombre]),
  )
  const posModulo = new Map<string, number>(
    ((modRes.data ?? []) as { clave: string }[]).map((m, i) => [m.clave, i]),
  )

  // Agrupadas por módulo en el orden del catálogo, que es el orden en que se
  // presentan: la biblioteca se lee igual que se enseña.
  return ((capRes.data ?? []) as Omit<CapturaRow, 'modulo_nombre'>[])
    .map(c => ({ ...c, modulo_nombre: nombres.get(c.modulo) ?? c.modulo, sector: c.sector ?? [] }))
    .sort((a, b) =>
      (posModulo.get(a.modulo) ?? 999) - (posModulo.get(b.modulo) ?? 999)
      || a.orden - b.orden || a.id - b.id)
}

/** Los sectores de `plantillas_sector`, para el selector de variante. */
export async function listarSectores(): Promise<{ sector: string; nombre: string }[]> {
  await requirePermiso('propuestas')
  const db = createAdminClient()
  const { data } = await db.from('plantillas_sector').select('sector, nombre').order('nombre')
  return (data ?? []) as { sector: string; nombre: string }[]
}

/** Limpia la lista de sectores contra los que existen. Vacío = vale para todos. */
async function sectoresValidos(db: ReturnType<typeof createAdminClient>, entrada: string[]): Promise<string[]> {
  const pedidos = [...new Set(entrada.map(s => s.trim()).filter(Boolean))]
  if (pedidos.length === 0) return []
  const { data } = await db.from('plantillas_sector').select('sector').in('sector', pedidos)
  return ((data ?? []) as { sector: string }[]).map(s => s.sector)
}

/** El siguiente hueco de orden dentro de su módulo. */
async function ordenSiguiente(db: ReturnType<typeof createAdminClient>, modulo: string): Promise<number> {
  const { data } = await db.from('capturas_producto')
    .select('orden').eq('modulo', modulo).order('orden', { ascending: false }).limit(1)
  const ultima = (data ?? [])[0] as { orden: number } | undefined
  return (ultima?.orden ?? -1) + 1
}

/**
 * Sube el WebP al bucket. Blob, nunca Buffer: storage-js manda los Blob por
 * multipart (binario seguro) y un Buffer va como body crudo de fetch, que en el
 * runtime serverless de Vercel se recodifica a UTF-8 y corrompe todos los bytes
 * ≥ 0x80. Ya mordió una vez con las fotos del catálogo.
 */
async function subirWebp(
  db: ReturnType<typeof createAdminClient>, path: string, webp: Buffer,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const blob = new Blob([new Uint8Array(webp)], { type: 'image/webp' })
  const up = await db.storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/webp', upsert: true,
  })
  if (up.error) return { ok: false, error: up.error.message }
  const { data } = db.storage.from(BUCKET).getPublicUrl(path)
  // El `?v=` tira la caché del navegador y la del CDN cuando se reemplaza una
  // captura sobre el mismo path: sin él, el comercial cambia la imagen y sigue
  // viendo la vieja durante horas y no sabe si se ha guardado.
  return { ok: true, url: `${data.publicUrl}?v=${Date.now()}` }
}

export async function subirCaptura(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; aviso?: string }> {
  const ctx = await requirePermiso('propuestas')

  const modulo = ((formData.get('modulo') as string) ?? '').trim()
  const vista  = ((formData.get('vista')  as string) ?? '').trim()
  const alt    = ((formData.get('alt')    as string) ?? '').trim()
  const sector = ((formData.get('sector') as string) ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const file   = formData.get('imagen') as File | null

  if (!modulo) return { ok: false, error: 'Elige el módulo.' }
  if (!vista)  return { ok: false, error: 'Falta el nombre de la pantalla.' }
  // El alt no es opcional y no se autogenera: es lo único que ve quien lee la
  // propuesta con un lector de pantalla, y lo que se lee si la imagen no carga
  // —que en 3G pasa—.
  if (!alt)    return { ok: false, error: 'Falta el texto alternativo.' }
  if (!file || file.size === 0) return { ok: false, error: 'No se recibió la imagen.' }
  if (file.size > MAX_SUBIDA)   return { ok: false, error: 'La imagen original no puede pasar de 12 MB.' }
  if (!file.type.startsWith('image/')) return { ok: false, error: 'El archivo debe ser una imagen.' }

  const db = createAdminClient()
  const { data: mod } = await db.from('modulos_catalogo')
    .select('clave, nombre').eq('clave', modulo).maybeSingle()
  if (!mod) return { ok: false, error: 'Ese módulo ya no está en el catálogo.' }

  let webp: Buffer, ancho: number, alto: number
  try {
    const opt = await optimizarCaptura(Buffer.from(await file.arrayBuffer()))
    webp = opt.webp; ancho = opt.ancho; alto = opt.alto
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  const path = `${modulo}/${crypto.randomUUID()}.webp`
  const sub = await subirWebp(db, path, webp)
  if (!sub.ok) return { ok: false, error: sub.error }

  const { error } = await db.from('capturas_producto').insert({
    modulo, vista, alt, url: sub.url, path, ancho, alto,
    sector: await sectoresValidos(db, sector),
    orden: await ordenSiguiente(db, modulo),
  })
  if (error) {
    await db.storage.from(BUCKET).remove([path])   // no dejar el fichero huérfano
    return { ok: false, error: error.message }
  }

  await logActividad(db, {
    user_email: ctx.email, entity: 'captura', entity_id: modulo, action: 'crear',
    description: `Subió la captura «${vista}» de ${mod.nombre} (${Math.round(webp.length / 1024)} KB)`,
  })

  return { ok: true, ...avisoDe(await refrescarLaBiblioteca(db, modulo)) }
}

/** Reemplaza la imagen de una captura ya existente y le pone fecha de hoy. */
export async function reemplazarCaptura(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; aviso?: string }> {
  const ctx = await requirePermiso('propuestas')
  const id = Number(formData.get('id'))
  const file = formData.get('imagen') as File | null
  if (!Number.isFinite(id)) return { ok: false, error: 'Captura no válida.' }
  if (!file || file.size === 0) return { ok: false, error: 'No se recibió la imagen.' }
  if (file.size > MAX_SUBIDA)   return { ok: false, error: 'La imagen original no puede pasar de 12 MB.' }
  if (!file.type.startsWith('image/')) return { ok: false, error: 'El archivo debe ser una imagen.' }

  const db = createAdminClient()
  const { data: cap } = await db.from('capturas_producto')
    .select('id, modulo, vista, path').eq('id', id).maybeSingle()
  if (!cap) return { ok: false, error: 'Esa captura ya no existe.' }

  let webp: Buffer, ancho: number, alto: number
  try {
    const opt = await optimizarCaptura(Buffer.from(await file.arrayBuffer()))
    webp = opt.webp; ancho = opt.ancho; alto = opt.alto
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  const path = (cap.path as string | null) ?? `${cap.modulo}/${crypto.randomUUID()}.webp`
  const sub = await subirWebp(db, path, webp)
  if (!sub.ok) return { ok: false, error: sub.error }

  // La fecha se renueva porque es lo que responde a «¿esta pantalla sigue siendo
  // la de ahora?»: reemplazar la imagen y dejarla marcada como vieja haría que
  // el contador de «por revisar» mintiera en el otro sentido.
  const { error } = await db.from('capturas_producto').update({
    url: sub.url, path, ancho, alto, capturada_at: new Date().toISOString().slice(0, 10),
  }).eq('id', id)
  if (error) return { ok: false, error: error.message }

  await logActividad(db, {
    user_email: ctx.email, entity: 'captura', entity_id: String(id), action: 'editar',
    description: `Reemplazó la imagen de «${cap.vista}»`,
  })

  return { ok: true, ...avisoDe(await refrescarLaBiblioteca(db, cap.modulo as string)) }
}

export interface CamposCaptura {
  vista?:  string
  alt?:    string
  sector?: string[]
  activa?: boolean
}

export async function guardarCaptura(
  id: number, campos: CamposCaptura,
): Promise<{ ok: boolean; error?: string; aviso?: string }> {
  const ctx = await requirePermiso('propuestas')
  const db = createAdminClient()

  const { data: cap } = await db.from('capturas_producto')
    .select('id, modulo, vista').eq('id', id).maybeSingle()
  if (!cap) return { ok: false, error: 'Esa captura ya no existe.' }

  const patch: Record<string, unknown> = {}
  if (campos.vista !== undefined) {
    const v = campos.vista.trim()
    if (!v) return { ok: false, error: 'Falta el nombre de la pantalla.' }
    patch.vista = v
  }
  if (campos.alt !== undefined) {
    const a = campos.alt.trim()
    if (!a) return { ok: false, error: 'Falta el texto alternativo.' }
    patch.alt = a
  }
  if (campos.sector !== undefined) patch.sector = await sectoresValidos(db, campos.sector)
  if (campos.activa !== undefined) patch.activa = campos.activa
  if (Object.keys(patch).length === 0) return { ok: true }

  const { error } = await db.from('capturas_producto').update(patch).eq('id', id)
  if (error) return { ok: false, error: error.message }

  await logActividad(db, {
    user_email: ctx.email, entity: 'captura', entity_id: String(id), action: 'editar',
    description: `Editó la captura «${cap.vista}»`,
  })

  return { ok: true, ...avisoDe(await refrescarLaBiblioteca(db, cap.modulo as string)) }
}

/** Sube o baja una captura dentro de su módulo. El orden es el de la propuesta. */
export async function moverCaptura(
  id: number, dir: 'arriba' | 'abajo',
): Promise<{ ok: boolean; error?: string }> {
  await requirePermiso('propuestas')
  const db = createAdminClient()

  const { data: cap } = await db.from('capturas_producto')
    .select('id, modulo, orden').eq('id', id).maybeSingle()
  if (!cap) return { ok: false, error: 'Esa captura ya no existe.' }

  const { data: hermanas } = await db.from('capturas_producto')
    .select('id, orden').eq('modulo', cap.modulo).order('orden', { ascending: true })
  const lista = (hermanas ?? []) as { id: number; orden: number }[]
  const i = lista.findIndex(c => c.id === id)
  const j = dir === 'arriba' ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= lista.length) return { ok: true }   // ya está en el borde

  // Se reescribe el orden ENTERO del módulo, no solo las dos que se cruzan: la
  // tabla nace con todo a cero (el `default`), y con un intercambio de valores
  // iguales el movimiento no se vería.
  const reordenadas = [...lista]
  const [movida] = reordenadas.splice(i, 1)
  reordenadas.splice(j, 0, movida)
  for (let k = 0; k < reordenadas.length; k++) {
    if (reordenadas[k].orden !== k) {
      await db.from('capturas_producto').update({ orden: k }).eq('id', reordenadas[k].id)
    }
  }

  await refrescarLaBiblioteca(db, cap.modulo as string)
  return { ok: true }
}

export async function eliminarCaptura(
  id: number,
): Promise<{ ok: boolean; error?: string; aviso?: string }> {
  const ctx = await requirePermiso('propuestas')
  const db = createAdminClient()

  const { data: cap } = await db.from('capturas_producto')
    .select('id, modulo, vista, path').eq('id', id).maybeSingle()
  if (!cap) return { ok: true }   // ya no estaba

  const { error } = await db.from('capturas_producto').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  // El fichero se borra DESPUÉS de la fila: al revés, un fallo al borrar la fila
  // dejaría una captura apuntando a un hueco, que en la propuesta es un icono
  // roto delante del cliente.
  if (cap.path) await db.storage.from(BUCKET).remove([cap.path as string])

  await logActividad(db, {
    user_email: ctx.email, entity: 'captura', entity_id: String(id), action: 'eliminar',
    description: `Eliminó la captura «${cap.vista}»`,
  })

  return { ok: true, ...avisoDe(await refrescarLaBiblioteca(db, cap.modulo as string)) }
}

/**
 * Las mismas dos operaciones, pero sobre varias a la vez.
 *
 * No son un `for` con la acción de una: retirar seis capturas de golpe eran seis
 * viajes, seis `revalidatePath` y seis avisos —y si la cuarta fallaba, la mitad
 * quedaba retirada sin que nadie lo dijera—. Aquí es una consulta, un refresco y
 * una respuesta que dice cuántas se hicieron de verdad.
 */
export async function activarCapturas(
  ids: number[], activa: boolean,
): Promise<{ ok: boolean; error?: string; aviso?: string; hechas: number }> {
  const ctx = await requirePermiso('propuestas')
  if (ids.length === 0) return { ok: true, hechas: 0 }
  const db = createAdminClient()

  const { data: filas } = await db.from('capturas_producto')
    .select('id, modulo, vista').in('id', ids)
  const lista = (filas ?? []) as { id: number; modulo: string; vista: string }[]
  if (lista.length === 0) return { ok: false, error: 'Esas capturas ya no existen.', hechas: 0 }

  const { error } = await db.from('capturas_producto')
    .update({ activa }).in('id', lista.map(c => c.id))
  if (error) return { ok: false, error: error.message, hechas: 0 }

  await logActividad(db, {
    user_email: ctx.email, entity: 'captura', entity_id: lista.map(c => c.id).join(','),
    action: 'editar',
    description: `${activa ? 'Devolvió' : 'Retiró'} ${lista.length} captura${lista.length === 1 ? '' : 's'} de las propuestas`,
  })

  return {
    ok: true, hechas: lista.length,
    ...avisoDe(await refrescarModulos(db, lista.map(c => c.modulo))),
  }
}

export async function eliminarCapturas(
  ids: number[],
): Promise<{ ok: boolean; error?: string; aviso?: string; hechas: number }> {
  const ctx = await requirePermiso('propuestas')
  if (ids.length === 0) return { ok: true, hechas: 0 }
  const db = createAdminClient()

  const { data: filas } = await db.from('capturas_producto')
    .select('id, modulo, vista, path').in('id', ids)
  const lista = (filas ?? []) as { id: number; modulo: string; vista: string; path: string | null }[]
  if (lista.length === 0) return { ok: true, hechas: 0 }   // ya no estaban

  const { error } = await db.from('capturas_producto').delete().in('id', lista.map(c => c.id))
  if (error) return { ok: false, error: error.message, hechas: 0 }
  // Los ficheros, después de las filas: por el mismo motivo que al eliminar una.
  const paths = lista.map(c => c.path).filter((x): x is string => !!x)
  if (paths.length > 0) await db.storage.from(BUCKET).remove(paths)

  await logActividad(db, {
    user_email: ctx.email, entity: 'captura', entity_id: lista.map(c => c.id).join(','),
    action: 'eliminar',
    description: `Eliminó ${lista.length} captura${lista.length === 1 ? '' : 's'}`,
  })

  return {
    ok: true, hechas: lista.length,
    ...avisoDe(await refrescarModulos(db, lista.map(c => c.modulo))),
  }
}

/**
 * Tira la caché de la biblioteca y de las propuestas que enseñan ese módulo.
 *
 * Ninguna propuesta guarda la imagen: la lee de aquí al renderizar. Cambiar la
 * captura de Caja cambia la diapositiva de Caja en todas las que lo presentan,
 * y esas sí se pueden saber —la propuesta lleva escrita su lista de módulos—.
 */
async function refrescarLaBiblioteca(
  db: ReturnType<typeof createAdminClient>, modulo: string,
): Promise<string[]> {
  return refrescarModulos(db, [modulo])
}

/** Lo mismo para varios módulos: un solo refresco y los negocios sin repetir. */
async function refrescarModulos(
  db: ReturnType<typeof createAdminClient>, modulos: string[],
): Promise<string[]> {
  revalidatePath('/admin/ventas/propuestas/capturas')
  const negocios = new Set<string>()
  for (const m of new Set(modulos)) {
    for (const n of await refrescarPropuestasConModulo(db, m)) negocios.add(n)
  }
  return [...negocios]
}

/** El aviso del toast, solo si hay alguna propuesta publicada enseñándola. */
function avisoDe(negocios: string[]): { aviso?: string } {
  const a = avisoPropuestas(negocios, 'la captura nueva')
  return a ? { aviso: a } : {}
}
