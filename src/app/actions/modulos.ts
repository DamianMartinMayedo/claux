'use server'

import { requirePermiso } from '@/lib/admin-guard'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logActividad } from '@/lib/audit'
import { NIVELES, CAMPO_PRECIO, normalizarNivel, precioModulo, type Nivel, type ModuloPrecios } from '@/lib/niveles'
import {
  impactoDeCambios, recalcularCuotas, sembrarPrecio,
  type CambioPrecio, type ImpactoCliente,
} from '@/lib/catalogo-precios'

export async function editarModulo(formData: FormData) {
  await requirePermiso('modulos')
  const supabase = await createClient()

  const clave                = (formData.get('clave')                as string ?? '').trim()
  const nombre               = (formData.get('nombre')               as string ?? '').trim()
  const descripcion          = (formData.get('descripcion')          as string ?? '').trim() || null
  const tipo                 = (formData.get('tipo')                 as string ?? '').trim() || null
  const precio_inicial_usd   = parseFloat(formData.get('precio_inicial_usd')   as string ?? '0')
  const precio_empresa_usd   = parseFloat(formData.get('precio_empresa_usd')   as string ?? '0')
  const precio_pro_usd       = parseFloat(formData.get('precio_pro_usd')       as string ?? '0')
  const activo               = formData.get('activo') === 'true'
  const orden                = parseInt(formData.get('orden') as string ?? '0', 10)

  const paginasRaw = formData.get('paginas') as string ?? null
  const paginas = paginasRaw ? JSON.parse(paginasRaw) : null

  if (!clave || !nombre) return { ok: false, error: 'Clave y nombre son obligatorios.' }
  if ([precio_inicial_usd, precio_empresa_usd, precio_pro_usd].some(isNaN)) {
    return { ok: false, error: 'Precios inválidos.' }
  }

  // Obtener tipo actual para validar cambios
  const { data: actual } = await supabase
    .from('modulos_catalogo')
    .select('tipo')
    .eq('clave', clave)
    .single()

  const update: Record<string, unknown> = {
    nombre, descripcion, precio_inicial_usd, precio_empresa_usd, precio_pro_usd, activo,
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
    description: `Editó módulo ${clave} — inicial: $${precio_inicial_usd} / empresa: $${precio_empresa_usd} / pro: $${precio_pro_usd} — activo: ${activo}`,
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
  const precio_inicial_usd   = parseFloat(formData.get('precio_inicial_usd')   as string ?? '0')
  const precio_empresa_usd   = parseFloat(formData.get('precio_empresa_usd')   as string ?? '0')
  const precio_pro_usd       = parseFloat(formData.get('precio_pro_usd')       as string ?? '0')

  if (!clave || !nombre) return { ok: false, error: 'Clave y nombre son obligatorios.' }
  if (!['modulo', 'funcionalidad', 'addon'].includes(tipo)) return { ok: false, error: 'Tipo inválido.' }
  if ([precio_inicial_usd, precio_empresa_usd, precio_pro_usd].some(isNaN)) {
    return { ok: false, error: 'Precios inválidos.' }
  }

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
      clave, nombre, tipo, descripcion,
      precio_inicial_usd, precio_empresa_usd, precio_pro_usd,
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
    description: `Creó ${tipo} "${nombre}" (${clave}) — inicial: $${precio_inicial_usd} / empresa: $${precio_empresa_usd} / pro: $${precio_pro_usd}`,
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

/** A quién le mueve la cuota este precio nuevo. No guarda nada. */
export async function previsualizarPrecio(clave: string, precios: Record<string, number>) {
  await requirePermiso('modulos')
  const supabase = await createClient()

  const limpio: Partial<Record<Nivel, number>> = {}
  for (const n of NIVELES) {
    const v = Number(precios[n])
    if (Number.isFinite(v) && v >= 0) limpio[n] = v
  }
  const impacto = await impactoDeCambios(supabase, [{ clave, precios: limpio }])
  return { ok: true as const, impacto }
}

// ── Sembrar una columna de precios ───────────────────────────────────
// Empresa = Inicial ×2 · Pro = Inicial ×2,5 al alza al múltiplo de 5 (D2). El
// multiplicador SIEMBRA la columna; no manda. Después cada celda se edita a mano
// y nadie vuelve a preguntarle al multiplicador.

export interface FilaSiembra {
  clave:  string
  nombre: string
  actual: number
  nuevo:  number
}

async function calcularSiembra(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, origen: Nivel, destino: Nivel, multiplicador: number, redondeoA: number,
): Promise<{ filas: FilaSiembra[]; cambios: CambioPrecio[] }> {
  const { data } = await supabase
    .from('modulos_catalogo')
    .select('clave, nombre, precio_inicial_usd, precio_empresa_usd, precio_pro_usd')
    .order('orden')

  const filas: FilaSiembra[] = []
  const cambios: CambioPrecio[] = []
  for (const m of (data ?? []) as (ModuloPrecios & { nombre: string })[]) {
    const actual = precioModulo(m, destino)
    const nuevo  = sembrarPrecio(precioModulo(m, origen), multiplicador, redondeoA)
    if (nuevo === actual) continue
    filas.push({ clave: m.clave, nombre: m.nombre, actual, nuevo })
    cambios.push({ clave: m.clave, precios: { [destino]: nuevo } })
  }
  return { filas, cambios }
}

/** Qué quedaría en la columna y a quién le cambia la cuota. No guarda nada. */
export async function previsualizarSiembra(
  origen: string, destino: string, multiplicador: number, redondeoA: number,
) {
  await requirePermiso('modulos')
  const supabase = await createClient()

  const desde = normalizarNivel(origen)
  const hacia = normalizarNivel(destino)
  if (desde === hacia) return { ok: false as const, error: 'El origen y el destino son la misma columna.' }
  if (!(Number(multiplicador) > 0)) return { ok: false as const, error: 'El multiplicador tiene que ser mayor que cero.' }

  const { filas, cambios } = await calcularSiembra(supabase, desde, hacia, Number(multiplicador), Number(redondeoA) || 0)
  const impacto: ImpactoCliente[] = await impactoDeCambios(supabase, cambios)
  return { ok: true as const, filas, impacto }
}

/** Escribe la columna sembrada y rehace la cuota cacheada de los afectados. */
export async function aplicarSiembra(
  origen: string, destino: string, multiplicador: number, redondeoA: number,
) {
  await requirePermiso('modulos')
  const supabase = await createClient()

  const desde = normalizarNivel(origen)
  const hacia = normalizarNivel(destino)
  if (desde === hacia) return { ok: false as const, error: 'El origen y el destino son la misma columna.' }
  if (!(Number(multiplicador) > 0)) return { ok: false as const, error: 'El multiplicador tiene que ser mayor que cero.' }

  // Se recalcula aquí en vez de fiarse de lo que mande el navegador: entre la
  // previsualización y el «Aplicar» pudo cambiar un precio de origen, y aplicar
  // números viejos sería escribir a ciegas justo donde no se puede.
  const { filas } = await calcularSiembra(supabase, desde, hacia, Number(multiplicador), Number(redondeoA) || 0)
  if (!filas.length) return { ok: true as const, escritos: 0, clientesRecalculados: 0 }

  const campo = CAMPO_PRECIO[hacia]
  for (const f of filas) {
    const { error } = await supabase
      .from('modulos_catalogo')
      .update({ [campo]: f.nuevo, updated_at: new Date().toISOString() })
      .eq('clave', f.clave)
    if (error) return { ok: false as const, error: error.message }
  }

  const tocados = await recalcularCuotas(supabase, filas.map(f => f.clave))

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'modulo_catalogo',
    entity_id:   `siembra-${hacia}`,
    action:      'editar',
    description: `Sembró la columna ${hacia} desde ${desde} (×${multiplicador}${redondeoA > 0 ? `, al alza a múltiplos de ${redondeoA}` : ''}) — ${filas.length} módulo(s), ${tocados} cliente(s) recalculado(s)`,
  })

  revalidatePath('/admin/modulos')
  revalidatePath('/admin/clientes')
  return { ok: true as const, escritos: filas.length, clientesRecalculados: tocados }
}
