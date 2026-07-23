'use server'

// Acciones del importador de datos. Solo operables en MODO CONFIGURACIÓN
// (impersonación: `session.imp`), y con el candado por módulo de la entidad
// (`puedeEditarAlgunModulo(adaptador.modulos)`). Flujo:
//   crearLoteImport  → parsea el CSV y guarda las filas en el lote (BORRADOR)
//   validarLoteImport→ dry-run: valida fila a fila sin escribir (VALIDADO)
//   aplicarLoteImport→ commit idempotente + traza en import_lote_items (APLICADO)

import { revalidatePath } from 'next/cache'
import { getPortalSession, puedeEditarAlgunModulo } from './auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { obtenerEmpresas } from './empresas'
import { ADAPTADORES } from '@/lib/importador/adaptadores'
import { validarLoteFilas, aplicarLoteFilas, deshacerLoteFilas, type ResumenDeshacer } from '@/lib/importador/motor'
import { leerArchivo, ArchivoIlegible, type FormatoArchivo } from '@/lib/importador/archivo'
import { construirXlsxBase64, texto, anchoPara, MARCA, type CeldaEstilo, type HojaExcel } from '@/lib/exportar/excel'
import type {
  CtxImport, DefaultResuelto, MapeoImport, TrozoValidacion, TrozoAplicacion,
} from '@/lib/importador/tipos'

function generarLoteId(): string {
  return `IMP-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

function generarPlantillaId(): string {
  return `PLT-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

// Resuelve el contexto SOLO si hay sesión y es de configuración (impersonación).
async function resolverCtx(): Promise<{ operador: string | null; ctx: CtxImport } | null> {
  const session = await getPortalSession()
  if (!session || !session.imp) return null   // el importador es herramienta interna del equipo
  const db = createAdminClient()
  const empresas = await obtenerEmpresas()
  const { data: mon } = await db.from('monedas')
    .select('codigo').eq('client_id', session.client_id).eq('activa', true)
  return {
    operador: session.imp.admin_email ?? null,
    ctx: {
      db,
      client_id: session.client_id,
      empresas:  empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
      monedas:   ((mon ?? []) as { codigo: string }[]).map(m => m.codigo),
      cache:     new Map<string, unknown>(),
    },
  }
}

/**
 * Catálogo de campos y valores globales de una entidad (para pintar el mapeo en
 * el asistente). Comprueba el candado aquí también para avisar al elegir, no al
 * subir el archivo.
 */
export async function obtenerCamposEntidad(
  entidad: string,
): Promise<{
  ok: boolean; error?: string; etiqueta?: string
  campos?:   { campo: string; etiqueta: string; obligatorio: boolean; ayuda?: string; alias?: string[] }[]
  defaults?: DefaultResuelto[]
}> {
  const r = await resolverCtx()
  if (!r) return { ok: false, error: 'Solo disponible en modo configuración.' }
  const adaptador = ADAPTADORES[entidad]
  if (!adaptador) return { ok: false, error: 'Entidad no soportada.' }
  if (!(await puedeEditarAlgunModulo(adaptador.modulos))) return { ok: false, error: 'El cliente no tiene contratado el módulo necesario.' }

  const defaults: DefaultResuelto[] = await Promise.all(adaptador.defaults.map(async d => ({
    campo: d.campo, etiqueta: d.etiqueta, obligatorio: d.obligatorio, ayuda: d.ayuda,
    valor: d.valor, tipo: d.tipo,
    opciones: d.opciones ? await d.opciones(r.ctx) : undefined,
  })))

  return {
    ok: true,
    etiqueta: adaptador.etiqueta,
    campos: adaptador.campos.map(c => ({ campo: c.campo, etiqueta: c.etiqueta, obligatorio: c.obligatorio, ayuda: c.ayuda, alias: c.alias ?? [] })),
    defaults,
  }
}

/**
 * Plantilla modelo en Excel (.xlsx): hoja «Datos» con las cabeceras (obligatorias
 * con «*») y una fila de ejemplo que el motor sabe rechazar, más una hoja «Cómo
 * rellenar» con la marca CLAUX, los pasos y qué va en cada columna. El Excel evita
 * de raíz el problema del CSV (columnas pegadas, acentos rotos): las columnas ya
 * son columnas. Se devuelve en base64 y el asistente lo descarga como Blob.
 */
export async function plantillaImport(
  entidad: string,
): Promise<{ ok: boolean; error?: string; base64?: string; nombre?: string }> {
  const r = await resolverCtx()
  if (!r) return { ok: false, error: 'Solo disponible en modo configuración.' }
  const adaptador = ADAPTADORES[entidad]
  if (!adaptador) return { ok: false, error: 'Entidad no soportada.' }
  if (!(await puedeEditarAlgunModulo(adaptador.modulos))) return { ok: false, error: 'El cliente no tiene contratado el módulo necesario.' }

  const campos = adaptador.campos

  const cabecera: CeldaEstilo = { fontWeight: 'bold', color: MARCA.blanco, backgroundColor: MARCA.teal, align: 'left', wrap: true }
  const ejemplo:  CeldaEstilo = { fontStyle: 'italic', color: MARCA.ejemploTx, backgroundColor: MARCA.ejemploBg }

  const hojaDatos: HojaExcel = {
    nombre: 'Datos',
    filas: [
      campos.map(c => texto(c.etiqueta + (c.obligatorio ? ' *' : ''), cabecera)),
      campos.map(c => texto(c.ejemplo ?? '', ejemplo)),
    ],
    columnas: campos.map(c => ({ width: anchoPara(c.etiqueta + ' *', c.ejemplo) })),
  }

  // Hoja de ayuda: marca CLAUX + pasos + qué va en cada columna (de la propia
  // definición de campos, sin texto por entidad hardcodeado).
  const titulo: CeldaEstilo = { fontWeight: 'bold', color: MARCA.tealTexto, fontSize: 16 }
  const sub:    CeldaEstilo = { fontWeight: 'bold', color: MARCA.tealTexto }
  const clave:  CeldaEstilo = { fontWeight: 'bold' }

  const hojaAyuda: HojaExcel = {
    nombre: 'Cómo rellenar',
    filas: [
      [texto('CLAUX · Plantilla de importación', titulo)],
      [texto(adaptador.etiqueta, { color: MARCA.ejemploTx, fontWeight: 'bold' })],
      [texto('')],
      [texto('Cómo rellenarla', sub)],
      [texto('1. Escribe tus datos en la hoja «Datos», debajo de la fila de cabeceras.', { wrap: true })],
      [texto('2. No cambies ni borres la primera fila (las cabeceras).', { wrap: true })],
      [texto('3. Las columnas con * son obligatorias; el resto puedes dejarlas en blanco.', { wrap: true })],
      [texto('4. La fila de ejemplo (en gris) puedes dejarla o borrarla: no se importa.', { wrap: true })],
      [texto('5. Guarda y súbelo en CLAUX → Importar datos. También se acepta CSV.', { wrap: true })],
      [texto('')],
      [texto('Qué va en cada columna', sub)],
      ...campos.filter(c => c.ayuda).map(c => [texto(c.etiqueta, clave), texto(c.ayuda ?? '', { wrap: true })]),
    ],
    columnas: [{ width: 26 }, { width: 62 }],
  }

  const base64 = await construirXlsxBase64([hojaDatos, hojaAyuda])
  return { ok: true, base64, nombre: `plantilla-${entidad}.xlsx` }
}

/**
 * Lee el archivo (CSV en texto o Excel en base64), guarda las filas y crea el
 * lote. `avisos` es lo que el archivo trae mal sin llegar a impedir el trabajo.
 */
export async function crearLoteImport(
  entidad: string, contenido: string, formato: FormatoArchivo = 'csv',
): Promise<{ ok: boolean; error?: string; lote_id?: string; cabeceras?: string[]; muestra?: Record<string, string>[]; total?: number; avisos?: string[] }> {
  const r = await resolverCtx()
  if (!r) return { ok: false, error: 'Solo disponible en modo configuración.' }
  const adaptador = ADAPTADORES[entidad]
  if (!adaptador) return { ok: false, error: 'Entidad no soportada.' }
  if (!(await puedeEditarAlgunModulo(adaptador.modulos))) return { ok: false, error: 'El cliente no tiene contratado el módulo necesario.' }

  let leido
  try {
    leido = await leerArchivo(contenido, formato)
  } catch (e) {
    if (e instanceof ArchivoIlegible) return { ok: false, error: e.message }
    throw e
  }

  const lote_id = generarLoteId()
  const { error } = await r.ctx.db.from('import_lotes').insert({
    lote_id, client_id: r.ctx.client_id, entidad, estado: 'BORRADOR',
    operador: r.operador, cabeceras: leido.cabeceras, datos: leido.filas, total_filas: leido.filas.length,
  })
  if (error) return { ok: false, error: error.message }
  return {
    ok: true, lote_id, cabeceras: leido.cabeceras,
    muestra: leido.filas.slice(0, 8), total: leido.filas.length, avisos: leido.avisos,
  }
}

/**
 * Dry-run de una TANDA: valida sin escribir desde la fila `desde` hasta agotar
 * el presupuesto de tiempo. El asistente repite mientras `siguiente` no sea null.
 */
export async function validarLoteImport(
  lote_id: string, mapeo: MapeoImport, desde = 0, claves: string[] = [],
): Promise<{ ok: boolean; error?: string; trozo?: TrozoValidacion }> {
  const r = await resolverCtx()
  if (!r) return { ok: false, error: 'Solo disponible en modo configuración.' }
  const { data: lote } = await r.ctx.db.from('import_lotes').select('*')
    .eq('lote_id', lote_id).eq('client_id', r.ctx.client_id).maybeSingle()
  if (!lote) return { ok: false, error: 'Lote no encontrado.' }
  const adaptador = ADAPTADORES[lote.entidad as string]
  if (!adaptador) return { ok: false, error: 'Entidad no soportada.' }
  if (!(await puedeEditarAlgunModulo(adaptador.modulos))) return { ok: false, error: 'Sin permiso para esta entidad.' }

  const trozo = await validarLoteFilas(
    lote.datos as Record<string, string>[], mapeo, adaptador, r.ctx, desde, claves,
  )
  // Los contadores se acumulan entre tandas; el estado solo cambia al terminar.
  const previos = desde === 0
    ? { ok: 0, error: 0 }
    : { ok: (lote.filas_ok as number) ?? 0, error: (lote.filas_error as number) ?? 0 }
  await r.ctx.db.from('import_lotes').update({
    mapping:     mapeo,
    estado:      trozo.siguiente === null ? 'VALIDADO' : 'BORRADOR',
    filas_ok:    previos.ok + trozo.ok,
    filas_error: previos.error + trozo.errores,
  }).eq('lote_id', lote_id).eq('client_id', r.ctx.client_id)
  return { ok: true, trozo }
}

/**
 * Commit de una TANDA (insert/update por fila, idempotente). El lote no queda
 * APLICADO hasta que la última tanda devuelve `siguiente: null`; si algo se corta
 * a medias, repetir la llamada sigue por donde iba sin duplicar nada.
 */
export async function aplicarLoteImport(
  lote_id: string, desde = 0, claves: string[] = [],
): Promise<{ ok: boolean; error?: string; trozo?: TrozoAplicacion }> {
  const r = await resolverCtx()
  if (!r) return { ok: false, error: 'Solo disponible en modo configuración.' }
  const { data: lote } = await r.ctx.db.from('import_lotes').select('*')
    .eq('lote_id', lote_id).eq('client_id', r.ctx.client_id).maybeSingle()
  if (!lote) return { ok: false, error: 'Lote no encontrado.' }
  if (lote.estado === 'APLICADO') return { ok: false, error: 'Este lote ya se aplicó.' }
  const adaptador = ADAPTADORES[lote.entidad as string]
  if (!adaptador) return { ok: false, error: 'Entidad no soportada.' }
  if (!(await puedeEditarAlgunModulo(adaptador.modulos))) return { ok: false, error: 'Sin permiso para esta entidad.' }
  if (!lote.mapping || !(lote.mapping as MapeoImport).columnas) return { ok: false, error: 'Valida el lote antes de aplicarlo.' }

  const trozo = await aplicarLoteFilas(
    lote_id, lote.datos as Record<string, string>[], lote.mapping as MapeoImport, adaptador, r.ctx, desde, claves,
  )
  if (trozo.siguiente === null) {
    // Los contadores finales salen de la traza, no de la última tanda.
    const cuenta = async (accion: string) => (await r.ctx.db.from('import_lote_items')
      .select('*', { count: 'exact', head: true }).eq('lote_id', lote_id).eq('accion', accion)).count ?? 0
    await r.ctx.db.from('import_lotes').update({
      estado: 'APLICADO', aplicado_at: new Date().toISOString(),
      filas_ok:    (await cuenta('INSERTADA')) + (await cuenta('ACTUALIZADA')),
      filas_error: await cuenta('ERROR'),
    }).eq('lote_id', lote_id).eq('client_id', r.ctx.client_id)
    revalidatePath(adaptador.revalidar)
  }
  return { ok: true, trozo }
}

/**
 * Deshace lo que INSERTÓ un lote aplicado. En los maestros borra la ficha (y se
 * niega si ya la usa alguien); en el ledger compensa con un movimiento de
 * reverso, nunca borrando. Lo ACTUALIZADO no se revierte: no sabemos qué había.
 */
export async function deshacerLoteImport(
  lote_id: string,
): Promise<{ ok: boolean; error?: string; resumen?: ResumenDeshacer }> {
  const r = await resolverCtx()
  if (!r) return { ok: false, error: 'Solo disponible en modo configuración.' }
  const { data: lote } = await r.ctx.db.from('import_lotes').select('*')
    .eq('lote_id', lote_id).eq('client_id', r.ctx.client_id).maybeSingle()
  if (!lote) return { ok: false, error: 'Lote no encontrado.' }
  if (lote.estado !== 'APLICADO') return { ok: false, error: 'Solo se puede deshacer un lote aplicado.' }
  const adaptador = ADAPTADORES[lote.entidad as string]
  if (!adaptador) return { ok: false, error: 'Entidad no soportada.' }
  if (!(await puedeEditarAlgunModulo(adaptador.modulos))) return { ok: false, error: 'Sin permiso para esta entidad.' }

  const resumen = await deshacerLoteFilas(lote_id, adaptador, r.ctx)
  // Si algo quedó en pie, el lote sigue APLICADO: aún hay cosas suyas en los datos.
  await r.ctx.db.from('import_lotes').update({
    estado: resumen.intactas > 0 ? 'APLICADO' : 'REVERTIDO',
    filas_ok: resumen.intactas,
  }).eq('lote_id', lote_id).eq('client_id', r.ctx.client_id)
  revalidatePath(adaptador.revalidar)
  return { ok: true, resumen }
}

// ── Plantillas de mapeo ────────────────────────────────────────────────────────
// Guardan CÓMO se lee el archivo de un origen concreto (qué columna es cada
// campo), no los valores del cliente: son globales del equipo, así que meter aquí
// la empresa o la moneda de un cliente las llevaría al siguiente. Los defaults se
// eligen cada vez, en el paso de mapear.

export async function listarPlantillasImport(
  entidad: string,
): Promise<{ plantilla_id: string; nombre: string }[]> {
  const r = await resolverCtx()
  if (!r) return []
  const { data } = await r.ctx.db.from('import_plantillas')
    .select('plantilla_id, nombre').eq('entidad', entidad).order('nombre')
  return (data ?? []) as { plantilla_id: string; nombre: string }[]
}

export async function guardarPlantillaImport(
  nombre: string, entidad: string, columnas: Record<string, string>, politica: string,
): Promise<{ ok: boolean; error?: string; plantilla_id?: string }> {
  const r = await resolverCtx()
  if (!r) return { ok: false, error: 'Solo disponible en modo configuración.' }
  const limpio = nombre.trim()
  if (!limpio) return { ok: false, error: 'Ponle un nombre a la plantilla.' }
  if (!ADAPTADORES[entidad]) return { ok: false, error: 'Entidad no soportada.' }

  const plantilla_id = generarPlantillaId()
  const { error } = await r.ctx.db.from('import_plantillas').insert({
    plantilla_id, nombre: limpio, entidad, mapping: { columnas, politica },
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, plantilla_id }
}

export async function cargarPlantillaImport(
  plantilla_id: string,
): Promise<{ ok: boolean; error?: string; columnas?: Record<string, string>; politica?: string }> {
  const r = await resolverCtx()
  if (!r) return { ok: false, error: 'Solo disponible en modo configuración.' }
  const { data } = await r.ctx.db.from('import_plantillas')
    .select('mapping').eq('plantilla_id', plantilla_id).maybeSingle()
  if (!data) return { ok: false, error: 'Plantilla no encontrada.' }
  const m = (data.mapping ?? {}) as { columnas?: Record<string, string>; politica?: string }
  return { ok: true, columnas: m.columnas ?? {}, politica: m.politica ?? 'SALTAR' }
}

export async function eliminarPlantillaImport(
  plantilla_id: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await resolverCtx()
  if (!r) return { ok: false, error: 'Solo disponible en modo configuración.' }
  const { error } = await r.ctx.db.from('import_plantillas').delete().eq('plantilla_id', plantilla_id)
  return error ? { ok: false, error: error.message } : { ok: true }
}
