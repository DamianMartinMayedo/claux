'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermiso } from '@/lib/admin-guard'
import { logActividad } from '@/lib/audit'
import { leerSetting } from '@/lib/settings'
import { CLAVES_PROVEEDOR } from '@/lib/documentos/proveedor'
import { contactoEmpresa, firmaDe, listarFirmantes, type Firma, type Firmante } from '@/lib/propuesta/firmantes'
import { DEV_ADMIN, isAuthBypassed } from '@/lib/dev-auth'
import { nuevoToken } from '@/lib/publico/token'
import { COLUMNAS_PRECIO, normalizarNivel, type ModuloPrecios } from '@/lib/niveles'
import { normalizarMonedaClaux, type MonedaClaux } from '@/lib/moneda-claux'
import { CLAVES_TEXTO } from '@/lib/propuesta/secciones'

// ── Propuestas comerciales (panel interno) ───────────────────────────────────
//
// Todas las acciones piden `requirePermiso('propuestas')`. NO entran en
// `npm run audit:gating`: ese centinela vigila las acciones del PORTAL —las que
// escriben en el tenant de un cliente y necesitan `puedeEditarModulo`—, y estas
// son del panel de CLAUX, donde el candado es el permiso de sección.
//
// La propuesta NO guarda ni un número: precios, horas y cuota se leen del
// presupuesto y del catálogo al renderizar (`lib/propuesta/`). Aquí solo se
// guarda el relato y los vínculos. Es lo que hace que arreglar un presupuesto
// arregle también la propuesta, en vez de dejar dos documentos que se
// contradicen —que es exactamente lo que pasó con AUGE.

export interface PropuestaRow {
  id:               number
  created_at:       string
  updated_at:       string
  publicada_at:     string | null
  titulo:           string
  nombre_negocio:   string
  comercial_nombre: string | null
  comercial_email:  string | null
  comercial_tel:    string | null
  nivel:            string
  moneda:           MonedaClaux
  modulos:          string[]
  estado:           'BORRADOR' | 'PUBLICADA'
  token:            string | null
  diagnostico_id:   number | null
  presupuesto_id:   number | null
  client_id:        string | null
  /** Acuse de lectura: lo primero que mira un comercial antes de llamar. */
  aperturas:        number
  ultima_apertura:  string | null
  /** Lo último que el cliente marcó en el configurador, si llegó a mandarlo. */
  seleccion:        { modulos: string[]; cuota: number; moneda: MonedaClaux; enviada_at: string } | null
}

export interface PropuestaDetalle {
  fila:   PropuestaRow
  /** `propuesta_textos` aplanado: clave → cuerpo. */
  textos: Record<string, string>
  secciones_ocultas: string[]
  secciones_orden:   string[]
}

export interface ModuloParaPropuesta extends ModuloPrecios {
  clave:  string
  nombre: string
  activo: boolean
}

export interface PresupuestoVinculable {
  id:             number
  nombre_negocio: string
  /** Lo cotizado. El editor lo compara con lo que marcó el cliente para no
   *  mandar a crear un presupuesto nuevo que diría exactamente lo mismo. */
  modulos:        string[]
  moneda:         MonedaClaux
  total_final:    number
  cuota_mensual:  number
  estado:         string
  created_at:     string
  diagnostico_id: number | null
  client_id:      string | null
}

export interface CrearPropuestaInput {
  nombreNegocio:  string
  titulo?:        string
  diagnosticoId?: number | null
  presupuestoId?: number | null
  clientId?:      string | null
  nivel?:         string
  moneda?:        string
  modulos?:       string[]
}

export interface GuardarPropuestaInput {
  titulo:           string
  nombreNegocio:    string
  nivel:            string
  moneda:           string
  modulos:          string[]
  presupuestoId:    number | null
  /** Quién firma. Se congela al crear (ver `comercialDe`), y se corrige aquí:
   *  la propuesta la puede montar alguien y presentarla otro, y en local la
   *  sesión es el bypass de desarrollo. Vacío = no se pinta esa línea. */
  comercialNombre:  string
  comercialEmail:   string
  comercialTel:     string
  /** Solo las claves de `CLAVES_TEXTO` y los `modulo:<clave>`; el resto se ignora. */
  textos:           Record<string, string>
  seccionesOcultas: string[]
  seccionesOrden:   string[]
}

const CAMPOS =
  'id, created_at, updated_at, publicada_at, titulo, nombre_negocio, '
  + 'comercial_nombre, comercial_email, comercial_tel, '
  + 'nivel, moneda, modulos, estado, token, diagnostico_id, presupuesto_id, client_id'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any

/** Fila cruda + acuse + selección. Se arma aparte porque lo usan el listado y el editor. */
function componer(
  f: any,
  aperturas: { propuesta_id: number; vista_at: string }[],
  selecciones: { propuesta_id: number; modulos: string[]; cuota: number; moneda: string; enviada_at: string }[],
): PropuestaRow {
  const mias = aperturas.filter(a => a.propuesta_id === f.id)
  // Ya vienen ordenadas por fecha descendente: la primera que coincide es la última.
  const sel = selecciones.find(s => s.propuesta_id === f.id) ?? null
  return {
    ...f,
    moneda:  normalizarMonedaClaux(f.moneda),
    modulos: (f.modulos ?? []) as string[],
    aperturas: mias.length,
    ultima_apertura: mias[0]?.vista_at ?? null,
    seleccion: sel
      ? { modulos: sel.modulos ?? [], cuota: Number(sel.cuota) || 0, moneda: normalizarMonedaClaux(sel.moneda), enviada_at: sel.enviada_at }
      : null,
  }
}

/** Las tres consultas del acuse, compartidas por el listado y el detalle. */
async function acuses(db: Db, ids: number[]) {
  if (ids.length === 0) return { aperturas: [], selecciones: [] }
  const [ap, se] = await Promise.all([
    db.from('propuesta_aperturas').select('propuesta_id, vista_at')
      .in('propuesta_id', ids).order('vista_at', { ascending: false }),
    db.from('propuesta_selecciones').select('propuesta_id, modulos, cuota, moneda, enviada_at')
      .in('propuesta_id', ids).order('enviada_at', { ascending: false }),
  ])
  return { aperturas: ap.data ?? [], selecciones: se.data ?? [] }
}

export async function listarPropuestas(): Promise<PropuestaRow[]> {
  await requirePermiso('propuestas')
  const db = createAdminClient()
  const { data } = await db.from('propuestas').select(CAMPOS).order('created_at', { ascending: false })
  const filas = data ?? []
  const { aperturas, selecciones } = await acuses(db, filas.map((f: any) => f.id))
  return filas.map((f: any) => componer(f, aperturas, selecciones))
}

export async function obtenerPropuesta(id: number): Promise<PropuestaDetalle | null> {
  await requirePermiso('propuestas')
  const db = createAdminClient()

  const { data: f } = await db.from('propuestas')
    .select(`${CAMPOS}, secciones_ocultas, secciones_orden`).eq('id', id).maybeSingle()
  if (!f) return null

  const [{ data: txt }, { aperturas, selecciones }] = await Promise.all([
    db.from('propuesta_textos').select('clave, cuerpo').eq('propuesta_id', id),
    acuses(db, [id]),
  ])

  const textos: Record<string, string> = {}
  for (const t of (txt ?? []) as { clave: string; cuerpo: string | null }[]) {
    if (t.cuerpo) textos[t.clave] = t.cuerpo
  }

  return {
    fila: componer(f, aperturas, selecciones),
    textos,
    secciones_ocultas: (f.secciones_ocultas ?? []) as string[],
    secciones_orden:   (f.secciones_orden ?? []) as string[],
  }
}

/** El catálogo entero (activos e inactivos) para las casillas del editor. */
export async function listarModulosParaPropuesta(): Promise<ModuloParaPropuesta[]> {
  await requirePermiso('propuestas')
  const db = createAdminClient()
  const { data } = await db.from('modulos_catalogo')
    .select(`clave, nombre, activo, ${COLUMNAS_PRECIO}`)
    .order('orden', { ascending: true })
  return (data ?? []) as ModuloParaPropuesta[]
}

/**
 * Los presupuestos a los que se puede enganchar una propuesta. Permiso propio:
 * un vendedor con `propuestas` y sin `presupuestos` tiene que poder vincular,
 * y llamar a la acción de la otra sección le daría un «acceso no autorizado».
 */
export async function listarPresupuestosVinculables(): Promise<PresupuestoVinculable[]> {
  await requirePermiso('propuestas')
  const db = createAdminClient()
  const { data } = await db.from('presupuestos_instalacion')
    .select('id, nombre_negocio, modulos, moneda, total_final, cuota_mensual, estado, created_at, diagnostico_id, client_id')
    .order('created_at', { ascending: false }).limit(200)
  return (data ?? []).map((p: any) => ({
    ...p, modulos: p.modulos ?? [], moneda: normalizarMonedaClaux(p.moneda),
  }))
}

// ── Crear ────────────────────────────────────────────────────────────────────

/**
 * Quién firma la propuesta que se está creando.
 *
 * Se congela al crear —no se lee en cada render— porque quien la presenta es
 * quien la montó, y cambiar de comercial en el equipo no debería reescribir la
 * portada de una propuesta ya entregada. Se corrige después desde el editor,
 * que ofrece al equipo en un selector (`lib/propuesta/firmantes.ts`).
 *
 * Lo que NO sale de la sesión es el contacto. La cuenta de acceso de cada uno
 * es un correo personal, y eso no se enseña a un cliente: lo que se firma es el
 * contacto de trabajo de esa persona y, si no tiene, el de la empresa.
 *
 * La **identidad del bypass de desarrollo** (`Dev (bypass)` / `dev@local`) no es
 * nadie —en local es la sesión de todo el mundo— y se estaba imprimiendo en la
 * portada y en el cierre. Ahí se firma entero con los datos de la empresa, que
 * es lo que un cliente puede llamar de verdad.
 */
async function comercialDe(db: ReturnType<typeof createAdminClient>, ctx: { email: string; nombre: string }): Promise<Firma> {
  if (isAuthBypassed() && ctx.email === DEV_ADMIN.email) {
    const [nombreProv, empresa] = await Promise.all([
      leerSetting(CLAVES_PROVEEDOR.nombre, ''),
      contactoEmpresa(),
    ])
    return { nombre: nombreProv.trim() || null, email: empresa.email, tel: empresa.tel }
  }
  return firmaDe(db, ctx.email, ctx.nombre)
}

/** El equipo, para el selector «Quién la presenta» del editor. */
export async function listarFirmantesPropuesta(): Promise<Firmante[]> {
  await requirePermiso('propuestas')
  return listarFirmantes(createAdminClient())
}

export async function crearPropuesta(
  input: CrearPropuestaInput,
): Promise<{ ok: boolean; id?: number; error?: string }> {
  const ctx = await requirePermiso('propuestas')
  const db = createAdminClient()

  const nombre = (input.nombreNegocio || '').trim()
  if (!nombre) return { ok: false, error: 'Falta el nombre del negocio.' }

  // Si viene de un presupuesto, sus decisiones comerciales mandan: nivel, moneda
  // y módulos ya se pactaron ahí. Tecleárselos otra vez es cómo la diapositiva 13
  // acabó contradiciendo a la 14.
  let nivel = input.nivel ?? 'inicial'
  let moneda: MonedaClaux = normalizarMonedaClaux(input.moneda)
  let modulos = input.modulos ?? []
  let diagnosticoId = input.diagnosticoId ?? null
  let clientId = input.clientId ?? null

  if (input.presupuestoId) {
    const { data: pre } = await db.from('presupuestos_instalacion')
      .select('nivel, moneda, modulos, diagnostico_id, client_id')
      .eq('id', input.presupuestoId).maybeSingle()
    if (!pre) return { ok: false, error: 'Ese presupuesto ya no existe.' }
    nivel   = pre.nivel ?? nivel
    moneda  = normalizarMonedaClaux(pre.moneda)
    modulos = (pre.modulos ?? []) as string[]
    diagnosticoId = diagnosticoId ?? pre.diagnostico_id ?? null
    clientId      = clientId ?? pre.client_id ?? null
  }

  const firma = await comercialDe(db, ctx)

  const { data, error } = await db.from('propuestas').insert({
    diagnostico_id:   diagnosticoId,
    presupuesto_id:   input.presupuestoId ?? null,
    client_id:        clientId,
    titulo:           (input.titulo || '').trim() || `Propuesta para ${nombre}`,
    nombre_negocio:   nombre,
    comercial_email:  firma.email,
    comercial_nombre: firma.nombre,
    comercial_tel:    firma.tel,
    nivel:            normalizarNivel(nivel),
    moneda,
    modulos,
  }).select('id').single()

  if (error) return { ok: false, error: error.message }

  await logActividad(db, {
    user_email: ctx.email, entity: 'propuesta', entity_id: String(data.id), action: 'crear',
    description: `Creó la propuesta de ${nombre}${input.presupuestoId ? ` desde el presupuesto #${input.presupuestoId}` : ''}`,
  })

  revalidatePath('/admin/ventas/propuestas')
  return { ok: true, id: data.id }
}

// ── Guardar el contenido ─────────────────────────────────────────────────────

export async function guardarPropuesta(
  id: number, input: GuardarPropuestaInput,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePermiso('propuestas')
  const db = createAdminClient()

  const { data: antes } = await db.from('propuestas').select('token, nombre_negocio')
    .eq('id', id).maybeSingle()
  if (!antes) return { ok: false, error: 'La propuesta ya no existe.' }

  const nombre = (input.nombreNegocio || '').trim()
  if (!nombre) return { ok: false, error: 'Falta el nombre del negocio.' }

  const { error } = await db.from('propuestas').update({
    titulo:            (input.titulo || '').trim() || `Propuesta para ${nombre}`,
    nombre_negocio:    nombre,
    nivel:             normalizarNivel(input.nivel),
    moneda:            normalizarMonedaClaux(input.moneda),
    modulos:           input.modulos ?? [],
    presupuesto_id:    input.presupuestoId ?? null,
    secciones_ocultas: input.seccionesOcultas ?? [],
    secciones_orden:   input.seccionesOrden ?? [],
    comercial_nombre:  (input.comercialNombre || '').trim() || null,
    comercial_email:   (input.comercialEmail  || '').trim() || null,
    comercial_tel:     (input.comercialTel    || '').trim() || null,
    updated_at:        new Date().toISOString(),
  }).eq('id', id)
  if (error) return { ok: false, error: 'No se pudo guardar.' }

  // Los textos: se escriben los que traen cuerpo y se BORRAN los que se vaciaron.
  // Guardar una cadena vacía dejaría a `armar.ts` con un texto que existe y no
  // dice nada, y su regla es «lo escrito manda» — el hueco volvería a salir en
  // blanco en vez de recuperar el valor prellenado del diagnóstico.
  const validas = new Set<string>(CLAVES_TEXTO)
  const filas: { propuesta_id: number; clave: string; cuerpo: string }[] = []
  const vaciadas: string[] = []
  for (const [clave, valor] of Object.entries(input.textos ?? {})) {
    if (!validas.has(clave) && !clave.startsWith('modulo:')) continue
    const cuerpo = (valor ?? '').trim()
    if (cuerpo) filas.push({ propuesta_id: id, clave, cuerpo })
    else vaciadas.push(clave)
  }
  if (filas.length > 0) {
    await db.from('propuesta_textos').upsert(filas, { onConflict: 'propuesta_id,clave' })
  }
  if (vaciadas.length > 0) {
    await db.from('propuesta_textos').delete().eq('propuesta_id', id).in('clave', vaciadas)
  }

  await logActividad(db, {
    user_email: ctx.email, entity: 'propuesta', entity_id: String(id), action: 'editar',
    description: `Editó la propuesta de ${nombre}`,
  })

  revalidatePath('/admin/ventas/propuestas')
  revalidatePath(`/admin/ventas/propuestas/${id}`)
  revalidatePath(`/p/preview/${id}`)
  if (antes.token) revalidatePath(`/p/${antes.token}`)
  return { ok: true }
}

// ── Publicación ──────────────────────────────────────────────────────────────
//
// El token es una CAPABILITY URL: quien lo tiene, la ve. No hay login que poner
// delante —el lead no es usuario de CLAUX—, así que la mitigación real no es
// esconder el enlace, es poder REVOCARLO.
//
// Y publicar es OPCIONAL: el recorrido normal es crear → presentar en vivo desde
// `/p/preview/<id>` → mandar el PDF si lo piden. Solo hace falta publicar para
// compartir el enlace.

export async function publicarPropuesta(id: number): Promise<{ ok: boolean; token?: string; error?: string }> {
  const ctx = await requirePermiso('propuestas')
  const db = createAdminClient()

  const { data: p } = await db.from('propuestas').select('token, nombre_negocio, modulos')
    .eq('id', id).maybeSingle()
  if (!p) return { ok: false, error: 'La propuesta ya no existe.' }
  // Una propuesta sin módulos es una presentación sin producto: ni «Pensado para
  // tu negocio» ni las capturas tienen de dónde salir.
  if (((p.modulos ?? []) as string[]).length === 0) {
    return { ok: false, error: 'Marca al menos un módulo antes de publicar.' }
  }

  const token = (p.token as string | null) ?? nuevoToken()
  const { error } = await db.from('propuestas').update({
    estado: 'PUBLICADA', token,
    publicada_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) return { ok: false, error: 'No se pudo publicar.' }

  await logActividad(db, {
    user_email: ctx.email, entity: 'propuesta', entity_id: String(id), action: 'publicar',
    description: `Publicó la propuesta de ${p.nombre_negocio}`,
  })

  revalidatePath('/admin/ventas/propuestas')
  revalidatePath(`/admin/ventas/propuestas/${id}`)
  revalidatePath(`/p/${token}`)
  return { ok: true, token }
}

/** Despublicar CONSERVA el token: si se vuelve a publicar, el enlace repartido
 *  sigue sirviendo. Para invalidarlo de verdad está `revocarEnlacePropuesta`. */
export async function despublicarPropuesta(id: number): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePermiso('propuestas')
  const db = createAdminClient()

  const { data: p } = await db.from('propuestas').select('token, nombre_negocio').eq('id', id).maybeSingle()
  if (!p) return { ok: false, error: 'La propuesta ya no existe.' }

  const { error } = await db.from('propuestas')
    .update({ estado: 'BORRADOR', updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { ok: false, error: 'No se pudo despublicar.' }

  await logActividad(db, {
    user_email: ctx.email, entity: 'propuesta', entity_id: String(id), action: 'despublicar',
    description: `Despublicó la propuesta de ${p.nombre_negocio}`,
  })

  revalidatePath('/admin/ventas/propuestas')
  revalidatePath(`/admin/ventas/propuestas/${id}`)
  if (p.token) revalidatePath(`/p/${p.token}`)
  return { ok: true }
}

/** Revocar = token nuevo. El enlace repartido pasa a 404 y la propuesta sigue
 *  publicada bajo otra URL. */
export async function revocarEnlacePropuesta(id: number): Promise<{ ok: boolean; token?: string; error?: string }> {
  const ctx = await requirePermiso('propuestas')
  const db = createAdminClient()

  const { data: p } = await db.from('propuestas').select('token, nombre_negocio').eq('id', id).maybeSingle()
  if (!p) return { ok: false, error: 'La propuesta ya no existe.' }

  const token = nuevoToken()
  const { error } = await db.from('propuestas')
    .update({ token, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { ok: false, error: 'No se pudo revocar el enlace.' }

  await logActividad(db, {
    user_email: ctx.email, entity: 'propuesta', entity_id: String(id), action: 'revocar',
    description: `Revocó el enlace de la propuesta de ${p.nombre_negocio}`,
  })

  revalidatePath('/admin/ventas/propuestas')
  revalidatePath(`/admin/ventas/propuestas/${id}`)
  if (p.token) revalidatePath(`/p/${p.token}`)   // el viejo pasa a 404
  revalidatePath(`/p/${token}`)
  return { ok: true, token }
}

// ── Borrado ──────────────────────────────────────────────────────────────────
//
// Sin candado, y a propósito: una propuesta es un borrador de venta, no un
// registro contable —lo que queda del trato es el presupuesto y, si se firma, el
// Anexo I—. Los textos, las aperturas y las selecciones caen con ella (cascade).

export async function eliminarPropuesta(id: number): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePermiso('propuestas')
  const db = createAdminClient()

  const { data: p } = await db.from('propuestas').select('token, nombre_negocio').eq('id', id).maybeSingle()
  if (!p) return { ok: true }   // ya no estaba: el resultado es el que se pedía

  const { error } = await db.from('propuestas').delete().eq('id', id)
  if (error) return { ok: false, error: 'No se pudo eliminar.' }

  await logActividad(db, {
    user_email: ctx.email, entity: 'propuesta', entity_id: String(id), action: 'eliminar',
    description: `Eliminó la propuesta de ${p.nombre_negocio}`,
  })

  revalidatePath('/admin/ventas/propuestas')
  if (p.token) revalidatePath(`/p/${p.token}`)
  return { ok: true }
}

export async function eliminarPropuestasEnLote(
  ids: number[],
): Promise<{ hechas: number; error?: string }> {
  await requirePermiso('propuestas')
  let hechas = 0
  for (const id of ids) {
    const r = await eliminarPropuesta(id)
    if (r.ok) hechas++
  }
  return { hechas }
}
