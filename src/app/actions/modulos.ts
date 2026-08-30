'use server'

import { requirePermiso } from '@/lib/admin-guard'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logActividad } from '@/lib/audit'
import {
  NIVELES, CAMPO_PRECIO, COLUMNAS_PRECIO, campoPrecio, normalizarNivel, precioModulo,
  type ColumnaPrecio, type Nivel, type ModuloPrecios,
} from '@/lib/niveles'
import { MONEDAS_CLAUX, importeClaux, normalizarMonedaClaux, type MonedaClaux } from '@/lib/moneda-claux'
import {
  impactoDeCambios, recalcularCuotas, sembrarPrecio,
  type CambioPrecio, type ImpactoCliente,
} from '@/lib/catalogo-precios'

/**
 * Los SEIS precios del formulario (moneda × nivel, mig. 225), con el nombre de
 * columna como clave para poder volcarlos directos al `update`/`insert`.
 * Ausente o vacío = 0, igual que antes: el formulario siempre los manda todos.
 */
function leerPrecios(formData: FormData): Record<string, number> {
  const out: Record<string, number> = {}
  for (const moneda of MONEDAS_CLAUX) {
    for (const nivel of NIVELES) {
      const campo = CAMPO_PRECIO[moneda][nivel]
      out[campo] = parseFloat((formData.get(campo) as string) ?? '0')
    }
  }
  return out
}

/** Los seis precios en una línea, para el registro de actividad. */
function describirPrecios(precios: Record<string, number>): string {
  return MONEDAS_CLAUX.map(moneda =>
    NIVELES.map(nivel => `${nivel}: ${importeClaux(precios[CAMPO_PRECIO[moneda][nivel]], moneda)}`).join(' / '),
  ).join(' · ')
}

export async function editarModulo(formData: FormData) {
  await requirePermiso('modulos')
  const supabase = await createClient()

  const clave                = (formData.get('clave')                as string ?? '').trim()
  const nombre               = (formData.get('nombre')               as string ?? '').trim()
  const descripcion          = (formData.get('descripcion')          as string ?? '').trim() || null
  const tipo                 = (formData.get('tipo')                 as string ?? '').trim() || null
  const precios              = leerPrecios(formData)
  const activo               = formData.get('activo') === 'true'
  const orden                = parseInt(formData.get('orden') as string ?? '0', 10)

  const paginasRaw = formData.get('paginas') as string ?? null
  const paginas = paginasRaw ? JSON.parse(paginasRaw) : null

  if (!clave || !nombre) return { ok: false, error: 'Clave y nombre son obligatorios.' }
  if (Object.values(precios).some(isNaN)) return { ok: false, error: 'Precios inválidos.' }

  // Obtener tipo actual para validar cambios
  const { data: actual } = await supabase
    .from('modulos_catalogo')
    .select('tipo')
    .eq('clave', clave)
    .single()

  const update: Record<string, unknown> = {
    nombre, descripcion, ...precios, activo,
    updated_at: new Date().toISOString(),
  }
  if (!isNaN(orden)) update.orden = orden
  // Solo permitir cambio entre modulo ↔ funcionalidad, no desde/hacia addon o base
  if (tipo && actual && actual.tipo !== 'base' && actual.tipo !== 'addon' && ['modulo', 'funcionalidad'].includes(tipo)) {
    update.tipo = tipo
  }
  // Si cambia a addon, limpiar páginas
  if (tipo === 'addon') update.paginas = JSON.stringify([])
  else if (paginas !== null) update.paginas = paginas

  const { error } = await supabase
    .from('modulos_catalogo')
    .update(update)
    .eq('clave', clave)

  if (error) return { ok: false, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'modulo_catalogo',
    entity_id:   clave,
    action:      'editar',
    description: `Editó módulo ${clave} — ${describirPrecios(precios)} — activo: ${activo}`,
  })

  // La cuota cacheada de quien tenga este módulo deja de ser cierta en el
  // instante en que cambia su precio. Se rehace aquí, en el mismo guardado: si
  // se deja para «luego», la ficha dice un número y el cobro emite otro.
  const tocados = await recalcularCuotas(supabase, [clave])

  revalidatePath('/admin/modulos')
  revalidatePath('/admin/clientes')
  return { ok: true as const, clientesRecalculados: tocados }
}

// ── Crear módulo ─────────────────────────────────────────────────────
export async function crearModulo(formData: FormData) {
  await requirePermiso('modulos')
  const supabase = await createClient()

  const clave                = (formData.get('clave')                as string ?? '').trim()
  const nombre               = (formData.get('nombre')               as string ?? '').trim()
  const tipo                 = (formData.get('tipo')                 as string ?? 'modulo').trim()
  const descripcion          = (formData.get('descripcion')          as string ?? '').trim() || null
  const precios              = leerPrecios(formData)

  if (!clave || !nombre) return { ok: false, error: 'Clave y nombre son obligatorios.' }
  if (!['modulo', 'funcionalidad', 'addon'].includes(tipo)) return { ok: false, error: 'Tipo inválido.' }
  if (Object.values(precios).some(isNaN)) return { ok: false, error: 'Precios inválidos.' }

  // Verificar que la clave no exista
  const { data: existente } = await supabase
    .from('modulos_catalogo')
    .select('clave')
    .eq('clave', clave)
    .maybeSingle()
  if (existente) return { ok: false, error: `La clave "${clave}" ya existe.` }

  // Calcular orden (al final)
  const { count } = await supabase
    .from('modulos_catalogo')
    .select('*', { count: 'exact', head: true })
  const orden = (count ?? 0) + 1

  const { error } = await supabase
    .from('modulos_catalogo')
    .insert({
      clave, nombre, tipo, descripcion, ...precios,
      es_base: false, orden, activo: true,
      paginas: JSON.stringify([]),
    })

  if (error) return { ok: false, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'modulo_catalogo',
    entity_id:   clave,
    action:      'crear',
    description: `Creó ${tipo} "${nombre}" (${clave}) — ${describirPrecios(precios)}`,
  })

  revalidatePath('/admin/modulos')
  return { ok: true as const }
}

// ── Reordenar módulos ────────────────────────────────────────────────
export async function reordenarModulos(claves: string[]) {
  await requirePermiso('modulos')
  const supabase = await createClient()

  for (let i = 0; i < claves.length; i++) {
    await supabase
      .from('modulos_catalogo')
      .update({ orden: i + 1 })
      .eq('clave', claves[i])
  }

  revalidatePath('/admin/modulos')
  return { ok: true as const }
}

// ── Archivar / reactivar módulo ──────────────────────────────────────
// Archivar = ocultarlo del alta de clientes sin borrarlo (activo=false).
// Los clientes que ya lo tienen contratado lo conservan.
export async function archivarModulo(clave: string, archivar: boolean) {
  await requirePermiso('modulos')
  const supabase = await createClient()

  const { data: mod } = await supabase
    .from('modulos_catalogo')
    .select('es_base, nombre')
    .eq('clave', clave)
    .maybeSingle()
  if (!mod) return { ok: false, error: 'Módulo no encontrado.' }
  if (mod.es_base) return { ok: false, error: 'La base no se puede archivar.' }

  const { error } = await supabase
    .from('modulos_catalogo')
    .update({ activo: !archivar, updated_at: new Date().toISOString() })
    .eq('clave', clave)
  if (error) return { ok: false, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'modulo_catalogo',
    entity_id:   clave,
    action:      archivar ? 'archivar' : 'reactivar',
    description: `${archivar ? 'Archivó' : 'Reactivó'} el módulo ${mod.nombre} (${clave})`,
  })

  // Archivar un módulo lo saca de la suma (la cuota solo cuenta los `activo`),
  // así que la caché de quien lo tuviera contratado cambia también aquí.
  const tocados = await recalcularCuotas(supabase, [clave])

  revalidatePath('/admin/modulos')
  revalidatePath('/admin/clientes')
  return { ok: true as const, clientesRecalculados: tocados }
}

// ── Eliminar módulo (con guardia) ────────────────────────────────────
// Solo si no es la base y ningún cliente lo tiene contratado; si está en uso,
// se bloquea y se sugiere archivar.
export async function eliminarModulo(clave: string) {
  await requirePermiso('modulos')
  const supabase = await createClient()

  const { data: mod } = await supabase
    .from('modulos_catalogo')
    .select('es_base, nombre')
    .eq('clave', clave)
    .maybeSingle()
  if (!mod) return { ok: false, error: 'Módulo no encontrado.' }
  if (mod.es_base) return { ok: false, error: 'La base es obligatoria; no se puede eliminar.' }

  // Guardia: ¿algún cliente lo tiene activo? modulos_activos es text[].
  const { count } = await supabase
    .from('clients')
    .select('client_id', { count: 'exact', head: true })
    .contains('modulos_activos', [clave])
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `No se puede eliminar: ${count} cliente(s) lo tienen contratado. Archívalo en su lugar.`,
    }
  }

  const { error } = await supabase
    .from('modulos_catalogo')
    .delete()
    .eq('clave', clave)
  if (error) return { ok: false, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'modulo_catalogo',
    entity_id:   clave,
    action:      'eliminar',
    description: `Eliminó el módulo ${mod.nombre} (${clave})`,
  })

  revalidatePath('/admin/modulos')
  return { ok: true as const }
}

// ── Previsualización de impacto ──────────────────────────────────────
// El botón más peligroso del panel: cambiar un precio del catálogo recalcula la
// cuota de todo el que tenga ese módulo. Antes de guardar hay que enseñar a
// quién le cambia y cuánto, con nombre y apellidos. Plan §8.2.

/**
 * A quién le mueve la cuota este precio nuevo. No guarda nada.
 *
 * `precios` llega indexado por moneda y nivel (`{ USD: { inicial: 20 } }`): el
 * modal edita las seis casillas a la vez y cualquiera de ellas mueve la cuota de
 * alguien, según en qué moneda se le facture.
 */
export async function previsualizarPrecio(
  clave: string, precios: Record<string, Record<string, number>>,
) {
  await requirePermiso('modulos')
  const supabase = await createClient()

  const limpio: Partial<Record<MonedaClaux, Partial<Record<Nivel, number>>>> = {}
  for (const moneda of MONEDAS_CLAUX) {
    for (const nivel of NIVELES) {
      const v = Number(precios?.[moneda]?.[nivel])
      if (!Number.isFinite(v) || v < 0) continue
      limpio[moneda] = { ...(limpio[moneda] ?? {}), [nivel]: v }
    }
  }
  const impacto = await impactoDeCambios(supabase, [{ clave, precios: limpio }])
  return { ok: true as const, impacto }
}

// ── Sembrar una columna de precios ───────────────────────────────────
// Una «columna» es una casilla de la rejilla: MONEDA × NIVEL, seis en total
// (mig. 225). Con eso, «Empresa = Inicial ×2» y «el euro parte del dólar» son la
// misma operación y no hacen falta dos herramientas.
//
// El multiplicador SIEMBRA la columna; NO manda. Después cada celda se edita a
// mano y nadie vuelve a preguntarle al multiplicador. Es la única forma honesta
// de tener un precio en euros: si lo recalculara una tasa, volveríamos al
// problema que trajo todo esto —lo facturado y lo pagado sin coincidir—.

export interface FilaSiembra {
  clave:  string
  nombre: string
  actual: number
  nuevo:  number
}

/** Una casilla venida del navegador, normalizada. */
function columna(moneda: unknown, nivel: unknown): ColumnaPrecio {
  return { moneda: normalizarMonedaClaux(moneda), nivel: normalizarNivel(nivel) }
}

const mismaColumna = (a: ColumnaPrecio, b: ColumnaPrecio) =>
  a.moneda === b.moneda && a.nivel === b.nivel

async function calcularSiembra(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, origen: ColumnaPrecio, destino: ColumnaPrecio, multiplicador: number, redondeoA: number,
): Promise<{ filas: FilaSiembra[]; cambios: CambioPrecio[] }> {
  const { data } = await supabase
    .from('modulos_catalogo')
    .select(`clave, nombre, ${COLUMNAS_PRECIO}`)
    .order('orden')

  const filas: FilaSiembra[] = []
  const cambios: CambioPrecio[] = []
  for (const m of (data ?? []) as (ModuloPrecios & { nombre: string })[]) {
    const actual = precioModulo(m, destino.nivel, destino.moneda)
    const nuevo  = sembrarPrecio(precioModulo(m, origen.nivel, origen.moneda), multiplicador, redondeoA)
    if (nuevo === actual) continue
    filas.push({ clave: m.clave, nombre: m.nombre, actual, nuevo })
    cambios.push({ clave: m.clave, precios: { [destino.moneda]: { [destino.nivel]: nuevo } } })
  }
  return { filas, cambios }
}

/** Qué quedaría en la columna y a quién le cambia la cuota. No guarda nada. */
export async function previsualizarSiembra(
  origenMoneda: string, origenNivel: string,
  destinoMoneda: string, destinoNivel: string,
  multiplicador: number, redondeoA: number,
) {
  await requirePermiso('modulos')
  const supabase = await createClient()

  const desde = columna(origenMoneda, origenNivel)
  const hacia = columna(destinoMoneda, destinoNivel)
  if (mismaColumna(desde, hacia)) return { ok: false as const, error: 'El origen y el destino son la misma columna.' }
  if (!(Number(multiplicador) > 0)) return { ok: false as const, error: 'El multiplicador tiene que ser mayor que cero.' }

  const { filas, cambios } = await calcularSiembra(supabase, desde, hacia, Number(multiplicador), Number(redondeoA) || 0)
  const impacto: ImpactoCliente[] = await impactoDeCambios(supabase, cambios)
  return { ok: true as const, filas, impacto }
}

/** Escribe la columna sembrada y rehace la cuota cacheada de los afectados. */
export async function aplicarSiembra(
  origenMoneda: string, origenNivel: string,
  destinoMoneda: string, destinoNivel: string,
  multiplicador: number, redondeoA: number,
) {
  await requirePermiso('modulos')
  const supabase = await createClient()

  const desde = columna(origenMoneda, origenNivel)
  const hacia = columna(destinoMoneda, destinoNivel)
  if (mismaColumna(desde, hacia)) return { ok: false as const, error: 'El origen y el destino son la misma columna.' }
  if (!(Number(multiplicador) > 0)) return { ok: false as const, error: 'El multiplicador tiene que ser mayor que cero.' }

  // Se recalcula aquí en vez de fiarse de lo que mande el navegador: entre la
  // previsualización y el «Aplicar» pudo cambiar un precio de origen, y aplicar
  // números viejos sería escribir a ciegas justo donde no se puede.
  const { filas } = await calcularSiembra(supabase, desde, hacia, Number(multiplicador), Number(redondeoA) || 0)
  if (!filas.length) return { ok: true as const, escritos: 0, clientesRecalculados: 0 }

  const campo = campoPrecio(hacia.nivel, hacia.moneda)
  for (const f of filas) {
    const { error } = await supabase
      .from('modulos_catalogo')
      .update({ [campo]: f.nuevo, updated_at: new Date().toISOString() })
      .eq('clave', f.clave)
    if (error) return { ok: false as const, error: error.message }
  }

  const tocados = await recalcularCuotas(supabase, filas.map(f => f.clave))

  const etiqueta = (c: ColumnaPrecio) => `${c.nivel} en ${c.moneda}`
  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'modulo_catalogo',
    entity_id:   `siembra-${hacia.moneda}-${hacia.nivel}`,
    action:      'editar',
    description: `Sembró la columna ${etiqueta(hacia)} desde ${etiqueta(desde)} (×${multiplicador}${redondeoA > 0 ? `, al alza a múltiplos de ${redondeoA}` : ''}) — ${filas.length} módulo(s), ${tocados} cliente(s) recalculado(s)`,
  })

  revalidatePath('/admin/modulos')
  revalidatePath('/admin/clientes')
  return { ok: true as const, escritos: filas.length, clientesRecalculados: tocados }
}
