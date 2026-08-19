'use server'

// Acciones del importador de AUTOSERVICIO: el cliente se importa SOLO, sin que el
// equipo impersone. Es la «copia» del importador del equipo (importar.ts) pero solo
// en la CÁSCARA: el motor y los adaptadores se comparten (una sola fuente de verdad).
// Lo único propio de esta capa:
//   · el candado — `requireImportarEntidad(session, entidad)`: interruptor por
//     usuario (`client_users.puede_importar`) ∩ módulo contratado del tenant ∩
//     interruptor de emergencia (`clients.autoimport_activo`) ∩ migración no a cargo
//     del equipo. Se llama LITERALMENTE en cada escritura (candado de AGENTS.md).
//   · el operador — el email del usuario del cliente, no el del equipo.
//   · SIN plantillas de mapeo — `import_plantillas` es global (llevaría el mapeo de
//     un cliente a otro); el cliente solo descarga la plantilla modelo y sube.
//
// El importador del equipo (importar.ts, /portal/importar) NO se toca: esto vive al lado.

import { revalidatePath } from 'next/cache'
import { getPortalSession } from './auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { obtenerEmpresas } from './empresas'
import { ADAPTADORES, DESHACEDORES, ETIQUETAS_AUXILIARES } from '@/lib/importador/adaptadores'
import { validarLoteFilas, aplicarLoteFilas, deshacerLoteFilas, type ResumenDeshacer } from '@/lib/importador/motor'
import { leerArchivo, ArchivoIlegible, type FormatoArchivo } from '@/lib/importador/archivo'
import { requireImportarEntidad } from '@/lib/importador/acceso-cliente'
import { avisarSolicitudMigracion } from '@/lib/notificaciones/admin/eventos'
import { construirXlsxBase64, texto, anchoPara, MARCA, type CeldaEstilo, type HojaExcel } from '@/lib/exportar/excel'
import type { PortalSession } from '@/lib/portal-auth'
import type {
  ClavesVistas, CtxImport, DefaultResuelto, MapeoImport, TrozoValidacion, TrozoAplicacion,
} from '@/lib/importador/tipos'

function generarLoteId(): string {
  return `IMP-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

/**
 * Contexto del importador de autoservicio: SOLO sesión normal (impersonación usa el
 * importador del equipo) + el ctx del motor. El candado por entidad NO va aquí: lo
 * pone `requireImportarEntidad` en cada acción de escritura, para que `audit:gating`
 * vea el portero en el cuerpo de la acción.
 */
async function resolverCtxCliente(): Promise<{ session: PortalSession; operador: string | null; ctx: CtxImport } | null> {
  const session = await getPortalSession()
  if (!session || session.imp) return null   // el equipo tiene su propio importador
  const db = createAdminClient()
  const empresas = await obtenerEmpresas()
  const { data: mon } = await db.from('monedas')
    .select('codigo, es_consolidacion').eq('client_id', session.client_id).eq('activa', true)
  const monedas = (mon ?? []) as { codigo: string; es_consolidacion: boolean }[]
  return {
    session,
    operador: session.email ?? null,
    ctx: {
      db,
      client_id: session.client_id,
      empresas:  empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
      monedas:   monedas.map(m => m.codigo),
      // Habilita las columnas de tasa congelada de gastos/cobros (plan §7).
      monedaConsolidacion: monedas.find(m => m.es_consolidacion)?.codigo ?? null,
      cache:     new Map<string, unknown>(),
    },
  }
}

/**
 * Catálogo de campos y valores globales de una entidad (para pintar el mapeo). El
 * candado comprueba aquí también para avisar al elegir la entidad, no al subir.
 */
export async function obtenerCamposEntidad(
  entidad: string,
): Promise<{
  ok: boolean; error?: string; etiqueta?: string
  campos?:   { campo: string; etiqueta: string; obligatorio: boolean; ayuda?: string; alias?: string[] }[]
  defaults?: DefaultResuelto[]
}> {
  const r = await resolverCtxCliente()
  if (!r) return { ok: false, error: 'El importador no está disponible.' }
  const adaptador = ADAPTADORES[entidad]
  if (!adaptador) return { ok: false, error: 'Entidad no soportada.' }
  if (!(await requireImportarEntidad(r.session, entidad))) return { ok: false, error: 'No puedes importar esto (revisa con tu administrador).' }

  const defaults: DefaultResuelto[] = await Promise.all(adaptador.defaults.map(async d => ({
    campo: d.campo, etiqueta: d.etiqueta, obligatorio: d.obligatorio, ayuda: d.ayuda,
    valor: d.valor, tipo: d.tipo,
    opciones: d.opciones ? await d.opciones(r.ctx) : undefined,
  })))

  // Columnas extra que dependen del cliente (la tasa de consolidación de
  // gastos/cobros solo existe si tiene moneda de consolidación — plan §7).
  const extra = adaptador.camposExtra ? await adaptador.camposExtra(r.ctx) : []

  return {
    ok: true,
    etiqueta: adaptador.etiqueta,
    campos: [...adaptador.campos, ...extra].map(c => ({ campo: c.campo, etiqueta: c.etiqueta, obligatorio: c.obligatorio, ayuda: c.ayuda, alias: c.alias ?? [] })),
    defaults,
  }
}

/**
 * Plantilla modelo en Excel (.xlsx): la barandilla del cliente. Hoja «Datos» con
 * cabeceras (obligatorias con «*») + fila de ejemplo que el motor rechaza, y hoja
 * «Cómo rellenar» con la marca CLAUX y qué va en cada columna. Idéntica a la del
 * equipo (misma plantilla, mismo motor): se devuelve en base64 y el asistente la baja.
 */
export async function plantillaImport(
  entidad: string,
): Promise<{ ok: boolean; error?: string; base64?: string; nombre?: string }> {
  const r = await resolverCtxCliente()
  if (!r) return { ok: false, error: 'El importador no está disponible.' }
  const adaptador = ADAPTADORES[entidad]
  if (!adaptador) return { ok: false, error: 'Entidad no soportada.' }
  if (!(await requireImportarEntidad(r.session, entidad))) return { ok: false, error: 'No puedes importar esto (revisa con tu administrador).' }

  // Con las columnas extra dependientes del cliente (tasa de consolidación, §7):
  // la plantilla y la hoja de ayuda las llevan solo si el cliente las tiene.
  const extra = adaptador.camposExtra ? await adaptador.camposExtra(r.ctx) : []
  const campos = [...adaptador.campos, ...extra]

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
 * Lee el archivo (CSV en texto o Excel en base64), guarda las filas y crea el lote
 * (BORRADOR). `avisos` es lo que el archivo trae mal sin impedir el trabajo.
 */
export async function crearLoteImport(
  entidad: string, contenido: string, formato: FormatoArchivo = 'csv',
): Promise<{ ok: boolean; error?: string; lote_id?: string; cabeceras?: string[]; muestra?: Record<string, string>[]; total?: number; avisos?: string[] }> {
  const r = await resolverCtxCliente()
  if (!r) return { ok: false, error: 'El importador no está disponible.' }
  const adaptador = ADAPTADORES[entidad]
  if (!adaptador) return { ok: false, error: 'Entidad no soportada.' }
  if (!(await requireImportarEntidad(r.session, entidad))) return { ok: false, error: 'No puedes importar esto (revisa con tu administrador).' }

  // Tope de tamaño (barandilla de autoservicio, §8): un archivo enorme no cabe en el
  // tiempo de una función serverless y no es un caso real de migración a mano. El
  // cliente ya avisa antes de subir; esto es la última red por si se saltara esa
  // comprobación. El xlsx llega en base64 (≈ 4/3 del tamaño real); el CSV, como texto.
  // Constante local a propósito: en un fichero 'use server' solo se exporta async.
  const TOPE_ARCHIVO_BYTES = 6 * 1024 * 1024   // 6 MB (margen sobre los 5 MB que anuncia el cliente)
  const bytesAprox = formato === 'xlsx' ? Math.floor(contenido.length * 3 / 4) : contenido.length
  if (bytesAprox > TOPE_ARCHIVO_BYTES) {
    return { ok: false, error: 'El archivo es demasiado grande (máx. 5 MB). Divídelo en partes más pequeñas y súbelas por separado.' }
  }

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
 * Dry-run de una TANDA: valida sin escribir desde `desde` hasta agotar el
 * presupuesto de tiempo. El asistente repite mientras `siguiente` no sea null.
 */
export async function validarLoteImport(
  lote_id: string, mapeo: MapeoImport, desde = 0, claves: ClavesVistas = [],
): Promise<{ ok: boolean; error?: string; trozo?: TrozoValidacion }> {
  const r = await resolverCtxCliente()
  if (!r) return { ok: false, error: 'El importador no está disponible.' }
  const { data: lote } = await r.ctx.db.from('import_lotes').select('*')
    .eq('lote_id', lote_id).eq('client_id', r.ctx.client_id).maybeSingle()
  if (!lote) return { ok: false, error: 'Lote no encontrado.' }
  const adaptador = ADAPTADORES[lote.entidad as string]
  if (!adaptador) return { ok: false, error: 'Entidad no soportada.' }
  if (!(await requireImportarEntidad(r.session, lote.entidad as string))) return { ok: false, error: 'Sin permiso para esta entidad.' }

  const trozo = await validarLoteFilas(
    lote.datos as Record<string, string>[], mapeo, adaptador, r.ctx, desde, claves,
  )
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
 * Commit de una TANDA (insert/update por fila, idempotente). No queda APLICADO
 * hasta que la última tanda devuelve `siguiente: null`; repetir la llamada sigue
 * por donde iba sin duplicar nada.
 */
export async function aplicarLoteImport(
  lote_id: string, desde = 0, claves: ClavesVistas = [],
): Promise<{
  ok: boolean; error?: string; trozo?: TrozoAplicacion
  auxiliares?: { etiqueta: string; cantidad: number }[]
}> {
  const r = await resolverCtxCliente()
  if (!r) return { ok: false, error: 'El importador no está disponible.' }
  const { data: lote } = await r.ctx.db.from('import_lotes').select('*')
    .eq('lote_id', lote_id).eq('client_id', r.ctx.client_id).maybeSingle()
  if (!lote) return { ok: false, error: 'Lote no encontrado.' }
  if (lote.estado === 'APLICADO') return { ok: false, error: 'Este lote ya se aplicó.' }
  const adaptador = ADAPTADORES[lote.entidad as string]
  if (!adaptador) return { ok: false, error: 'Entidad no soportada.' }
  if (!(await requireImportarEntidad(r.session, lote.entidad as string))) return { ok: false, error: 'Sin permiso para esta entidad.' }
  if (!lote.mapping || !(lote.mapping as MapeoImport).columnas) return { ok: false, error: 'Valida el lote antes de aplicarlo.' }

  const trozo = await aplicarLoteFilas(
    lote_id, lote.datos as Record<string, string>[], lote.mapping as MapeoImport, adaptador, r.ctx, desde, claves,
  )
  if (trozo.siguiente === null) {
    const cuenta = async (accion: string) => (await r.ctx.db.from('import_lote_items')
      .select('*', { count: 'exact', head: true }).eq('lote_id', lote_id).eq('accion', accion)).count ?? 0
    await r.ctx.db.from('import_lotes').update({
      estado: 'APLICADO', aplicado_at: new Date().toISOString(),
      filas_ok:    (await cuenta('INSERTADA')) + (await cuenta('ACTUALIZADA')),
      filas_error: await cuenta('ERROR'),
    }).eq('lote_id', lote_id).eq('client_id', r.ctx.client_id)
    revalidatePath(adaptador.revalidar)

    const { data: auxRows } = await r.ctx.db.from('import_lote_items')
      .select('entidad').eq('lote_id', lote_id).eq('fila_origen', 0).eq('accion', 'INSERTADA')
    const conteo = new Map<string, number>()
    for (const fila of (auxRows ?? []) as { entidad: string }[]) {
      conteo.set(fila.entidad, (conteo.get(fila.entidad) ?? 0) + 1)
    }
    const auxiliares = [...conteo.entries()]
      .map(([entidad, cantidad]) => ({ etiqueta: ETIQUETAS_AUXILIARES[entidad] ?? entidad, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad)
    return { ok: true, trozo, auxiliares }
  }
  return { ok: true, trozo }
}

/**
 * Deshace lo que INSERTÓ un lote aplicado (la red de seguridad del cliente: «la he
 * liado, lo deshago» en vez de llamar). En maestros borra la ficha —y se niega si
 * ya la usa alguien—; en el ledger compensa con un reverso. Lo ACTUALIZADO no se revierte.
 */
export async function deshacerLoteImport(
  lote_id: string,
): Promise<{ ok: boolean; error?: string; resumen?: ResumenDeshacer }> {
  const r = await resolverCtxCliente()
  if (!r) return { ok: false, error: 'El importador no está disponible.' }
  const { data: lote } = await r.ctx.db.from('import_lotes').select('*')
    .eq('lote_id', lote_id).eq('client_id', r.ctx.client_id).maybeSingle()
  if (!lote) return { ok: false, error: 'Lote no encontrado.' }
  if (lote.estado !== 'APLICADO') return { ok: false, error: 'Solo se puede deshacer un lote aplicado.' }
  const adaptador = ADAPTADORES[lote.entidad as string]
  if (!adaptador) return { ok: false, error: 'Entidad no soportada.' }
  if (!(await requireImportarEntidad(r.session, lote.entidad as string))) return { ok: false, error: 'Sin permiso para esta entidad.' }

  const resumen = await deshacerLoteFilas(lote_id, adaptador, r.ctx, DESHACEDORES)
  await r.ctx.db.from('import_lotes').update({
    estado: resumen.intactas > 0 ? 'APLICADO' : 'REVERTIDO',
    filas_ok: resumen.intactas,
  }).eq('lote_id', lote_id).eq('client_id', r.ctx.client_id)
  revalidatePath(adaptador.revalidar)
  return { ok: true, resumen }
}

/**
 * «Solicitar ayuda»: el cliente pide que el equipo haga su migración (servicio de
 * pago, presupuesto personalizado). Crea una solicitud INTERNA en la bandeja del
 * admin (no hay correo al cliente); el equipo la atiende desde la ficha y mueve
 * `migracion_estado` (a_cargo_equipo al aceptar, completada al terminar). La
 * idempotencia la da `crearAvisoAdmin` (un cliente = una solicitud viva), así que
 * pulsar dos veces no inunda el buzón. No lleva candado de módulo: es una petición
 * de soporte, como contactar con soporte, no una escritura en un módulo.
 */
export async function solicitarAyudaMigracion(
  mensaje?: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getPortalSession()
  if (!session || session.imp) return { ok: false, error: 'Sesión inválida.' }

  const db = createAdminClient()
  const { data: cli } = await db
    .from('clients').select('nombre_empresa').eq('client_id', session.client_id).maybeSingle()

  await avisarSolicitudMigracion({
    clientId: session.client_id,
    empresa:  cli?.nombre_empresa ?? session.client_id,
    mensaje:  (mensaje ?? '').trim() || null,
  })
  return { ok: true }
}
