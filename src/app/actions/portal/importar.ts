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
import { ADAPTADORES, DESHACEDORES, ETIQUETAS_AUXILIARES } from '@/lib/importador/adaptadores'
import { validarLoteFilas, aplicarLoteFilas, deshacerLoteFilas, type ResumenDeshacer } from '@/lib/importador/motor'
import { leerArchivo, ArchivoIlegible, type FormatoArchivo } from '@/lib/importador/archivo'
import { requisitosFaltantes, mensajeRequisitos } from '@/lib/importador/requisitos'
import { leerMigracion, resumenCuadre, ORDEN as ORDEN_MIGRACION } from '@/lib/importador/origenes/liangapp/migracion'
import { COL_CUENTA, COL_GRUPO, COL_ORDEN, categoriaDeClave } from '@/lib/importador/origenes/liangapp/rutas'
import { construirXlsxBase64, texto, numero, fecha, anchoPara, MARCA, type CeldaEstilo, type HojaExcel } from '@/lib/exportar/excel'
import type {
  CampoDef, ClavesVistas, CtxImport, DefaultResuelto, MapeoImport, TrozoValidacion, TrozoAplicacion,
} from '@/lib/importador/tipos'
import type {
  ArchivoLiangApp, FacturaDetectada, FichaArchivo, FilaCuadre, GrupoPropuesto,
  MigracionLeida, OrigenLiangApp, ResumenCuadre,
} from '@/lib/importador/origenes/liangapp/migracion'

function generarLoteId(): string {
  return `IMP-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
}

function generarMigracionId(): string {
  return `MIG-${crypto.randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
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
    .select('codigo, es_consolidacion').eq('client_id', session.client_id).eq('activa', true)
  const monedas = (mon ?? []) as { codigo: string; es_consolidacion: boolean }[]
  return {
    operador: session.imp.admin_email ?? null,
    ctx: {
      db,
      client_id: session.client_id,
      empresas:  empresas.map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre })),
      monedas:   monedas.map(m => m.codigo),
      // Habilita las columnas de tasa congelada de gastos/cobros (mig. 199, §7 del
      // plan). El importador del equipo SÍ la captura (decisión del dueño,
      // 2026-08-19): una migración hecha por nosotros también consolida el histórico.
      monedaConsolidacion: monedas.find(m => m.es_consolidacion)?.codigo ?? null,
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
  /** Entidad de HECHOS (gastos/cobros): reimportar no debe pisar lo existente por
   *  defecto. Un MAESTRO (personal, terceros, productos…) sí: lo normal al reimportar
   *  es rellenar/corregir, así que el asistente arranca en «Actualizar». */
  repetible?: boolean
}> {
  const r = await resolverCtx()
  if (!r) return { ok: false, error: 'Solo disponible en modo configuración.' }
  const adaptador = ADAPTADORES[entidad]
  if (!adaptador) return { ok: false, error: 'Entidad no soportada.' }
  if (!(await puedeEditarAlgunModulo(adaptador.modulos))) return { ok: false, error: 'El cliente no tiene contratado el módulo necesario.' }

  // Sin empresas o sin monedas no hay dónde crear las filas: se dice ahora, no con
  // un desplegable obligatorio vacío a mitad del asistente.
  const falta = mensajeRequisitos(requisitosFaltantes(adaptador, r.ctx))
  if (falta) return { ok: false, error: falta }

  const defaults: DefaultResuelto[] = await Promise.all(adaptador.defaults.map(async d => ({
    campo: d.campo, etiqueta: d.etiqueta, obligatorio: d.obligatorio, ayuda: d.ayuda,
    valor: d.valor, tipo: d.tipo,
    opciones: d.opciones ? await d.opciones(r.ctx) : undefined,
  })))

  // Columnas dinámicas del adaptador (las de consolidación de gastos/cobros, §7):
  // dependen del cliente, así que no están en `campos` estáticos.
  const extra = adaptador.camposExtra ? await adaptador.camposExtra(r.ctx) : []

  return {
    ok: true,
    etiqueta: adaptador.etiqueta,
    campos: [...adaptador.campos, ...extra].map(c => ({ campo: c.campo, etiqueta: c.etiqueta, obligatorio: c.obligatorio, ayuda: c.ayuda, alias: c.alias ?? [] })),
    defaults,
    repetible: !!adaptador.repetible,
  }
}

/**
 * Las dos hojas de una plantilla modelo: «Datos» (cabeceras + filas) y «Cómo
 * rellenar». Es local a propósito: en un fichero 'use server' solo se exporta
 * async, y esto lo comparten la plantilla en blanco y la de facturas de una
 * migración, que va PRE-RELLENA con lo que ya sabemos del libro mayor.
 */
function hojasDePlantilla(
  etiqueta: string, campos: CampoDef[],
  datos: HojaExcel['filas'] = [], pasos: string[] = [],
): [HojaExcel, HojaExcel] {
  const cabecera: CeldaEstilo = { fontWeight: 'bold', color: MARCA.blanco, backgroundColor: MARCA.teal, align: 'left', wrap: true }
  const ejemplo:  CeldaEstilo = { fontStyle: 'italic', color: MARCA.ejemploTx, backgroundColor: MARCA.ejemploBg }

  const hojaDatos: HojaExcel = {
    nombre: 'Datos',
    filas: [
      campos.map(c => texto(c.etiqueta + (c.obligatorio ? ' *' : ''), cabecera)),
      // Con datos de verdad no se pone fila de ejemplo: sobra y estorba.
      ...(datos.length ? datos : [campos.map(c => texto(c.ejemplo ?? '', ejemplo))]),
    ],
    columnas: campos.map(c => ({ width: anchoPara(c.etiqueta + ' *', c.ejemplo) })),
  }

  // Hoja de ayuda: marca CLAUX + pasos + qué va en cada columna (de la propia
  // definición de campos, sin texto por entidad hardcodeado).
  const titulo: CeldaEstilo = { fontWeight: 'bold', color: MARCA.tealTexto, fontSize: 16 }
  const sub:    CeldaEstilo = { fontWeight: 'bold', color: MARCA.tealTexto }
  const clave:  CeldaEstilo = { fontWeight: 'bold' }

  const porDefecto = [
    '1. Escribe tus datos en la hoja «Datos», debajo de la fila de cabeceras.',
    '2. No cambies ni borres la primera fila (las cabeceras).',
    '3. Las columnas con * son obligatorias; el resto puedes dejarlas en blanco.',
    '4. La fila de ejemplo (en gris) puedes dejarla o borrarla: no se importa.',
    '5. Guarda y súbelo en CLAUX → Importar datos. También se acepta CSV.',
  ]

  const hojaAyuda: HojaExcel = {
    nombre: 'Cómo rellenar',
    filas: [
      [texto('CLAUX · Plantilla de importación', titulo)],
      [texto(etiqueta, { color: MARCA.ejemploTx, fontWeight: 'bold' })],
      [texto('')],
      [texto('Cómo rellenarla', sub)],
      ...(pasos.length ? pasos : porDefecto).map(t => [texto(t, { wrap: true })]),
      [texto('')],
      [texto('Qué va en cada columna', sub)],
      ...campos.filter(c => c.ayuda).map(c => [texto(c.etiqueta, clave), texto(c.ayuda ?? '', { wrap: true })]),
    ],
    columnas: [{ width: 26 }, { width: 62 }],
  }

  return [hojaDatos, hojaAyuda]
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

  // Con las columnas dinámicas (consolidación, §7) para que la plantilla del
  // equipo también las traiga cuando el cliente tiene moneda de consolidación.
  const extra = adaptador.camposExtra ? await adaptador.camposExtra(r.ctx) : []
  const campos = [...adaptador.campos, ...extra]
  const [hojaDatos, hojaAyuda] = hojasDePlantilla(adaptador.etiqueta, campos)

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

  // Sin empresas o sin monedas no hay dónde crear las filas: se dice ahora, no con
  // un desplegable obligatorio vacío a mitad del asistente.
  const falta = mensajeRequisitos(requisitosFaltantes(adaptador, r.ctx))
  if (falta) return { ok: false, error: falta }

  // Tope de tamaño. Aquí no hay aviso en el navegador —el asistente del equipo no
  // comprueba nada antes de subir—, así que este es el único filtro: tiene que quedar
  // por debajo del techo de plataforma (`serverActions.bodySizeLimit`), o el archivo
  // muere con un error genérico antes de llegar. 5 MB en xlsx son 6,7 de payload.
  // Constante local a propósito: en un fichero 'use server' solo se exporta async.
  const TOPE_ARCHIVO_BYTES = 5 * 1024 * 1024
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
 * Una MIGRACIÓN DESDE LIANGAPP: los reportes del cliente, subidos de golpe.
 *
 * LiangApp es la contabilidad certificada que ya lleva medio país; no exporta a
 * nuestras plantillas, exporta SUS libros. Esta acción los lee, dice qué es cada
 * archivo y reparte sus líneas entre las entidades de CLAUX —una cuenta contable
 * decide sola a dónde va—, dejando un lote por entidad listo para el asistente
 * de siempre: desde aquí, validar, aplicar y deshacer son los de toda la vida.
 *
 * No escribe una sola fila de negocio: crea lotes en BORRADOR. El operador ve el
 * reconocimiento y el cuadre contra el propio cierre del cliente antes de nada.
 */
export async function crearMigracionLiangApp(
  archivos: ArchivoLiangApp[],
  /**
   * La migración que este reconocimiento SUSTITUYE. Al añadir el archivo que
   * faltaba o quitar el que sobraba se vuelve a leer todo, y los lotes de la
   * lectura anterior —nunca aplicados— se borran: si no, el operador se
   * encuentra con borradores duplicados que no llevan a ninguna parte.
   */
  reemplaza?: string,
  /**
   * Primer tramo de la subida: sin Estado de rendimiento financiero no se acepta
   * nada. Se comprueba AQUÍ y no en el asistente porque rechazarlo después de
   * haber escrito los lotes dejaba al operador con una migración en pantalla que
   * en la base ya no existía.
   */
  exigeEstado?: boolean,
): Promise<{
  ok: boolean
  error?: string
  migracion_id?: string
  empresa?: string
  periodo?: string
  fichas?: FichaArchivo[]
  cuadre?: FilaCuadre[]
  utilidad?: MigracionLeida['utilidad']
  sinArchivo?: MigracionLeida['sinArchivo']
  facturas?: FacturaDetectada[]
  /** La clasificación propuesta de los gastos, para el paso de reconocer. */
  grupos?: GrupoPropuesto[]
  avisos?: string[]
  /** Lo que impide seguir: con esto lleno no se ha creado ningún lote. */
  errores?: string[]
  /** Los lotes creados, en el orden en que hay que validarlos y aplicarlos. */
  lotes?: { lote_id: string; entidad: string; etiqueta: string; filas: number; columnas: Record<string, string> }[]
}> {
  const r = await resolverCtx()
  if (!r) return { ok: false, error: 'Solo disponible en modo configuración.' }

  // Una migración de LiangApp escribe en gastos Y en cobros, así que el candado se
  // comprueba sobre las dos entidades antes de leer nada.
  const implicados = ['gastos', 'cobros'].map(e => ADAPTADORES[e]).filter(Boolean)
  if (implicados.length < 2) return { ok: false, error: 'Entidad no soportada.' }
  for (const a of implicados) {
    if (!(await puedeEditarAlgunModulo(a.modulos))) return { ok: false, error: 'El cliente no tiene contratado el módulo necesario.' }
  }

  // Una migración cae siempre sobre un cliente recién creado: sin empresa ni
  // monedas no hay dónde meter nada, y es mejor decirlo antes de subir 10 MB.
  const falta = mensajeRequisitos(requisitosFaltantes(implicados[0], r.ctx))
  if (falta) return { ok: false, error: falta }
  if (!archivos.length) return { ok: false, error: 'No has subido ningún archivo.' }

  // Tope de tamaño: archivo a archivo Y la SUMA. Todos viajan en un mismo payload,
  // así que diez de 5 MB pasarían el filtro de uno en uno y reventarían el techo de
  // plataforma (`serverActions.bodySizeLimit`) con un error genérico, que es
  // justamente lo que ese techo está dimensionado para evitar.
  // Constante local a propósito: en un fichero 'use server' solo se exporta async.
  const TOPE_BYTES = 5 * 1024 * 1024
  const bytes = (b64: string) => Math.floor(b64.length * 3 / 4)
  const grande = archivos.find(a => bytes(a.base64) > TOPE_BYTES)
  if (grande) return { ok: false, error: `«${grande.nombre}» es demasiado grande (máx. 5 MB por archivo).` }
  if (archivos.reduce((s, a) => s + bytes(a.base64), 0) > TOPE_BYTES) {
    return { ok: false, error: 'Los archivos suman más de 5 MB. Súbelos en dos tandas.' }
  }

  // Releer una migración de la que YA se aplicó algo duplicaría lo aplicado: cada
  // lectura crea un `migracion_id` NUEVO, así que sus lotes no verían el aplicado
  // —vive en la migración anterior— y nadie impediría volver a meter las mismas
  // líneas. Para cambiar los archivos hay que deshacer primero.
  if (reemplaza) {
    const previos = await lotesDeMigracion(r.ctx, reemplaza)
    if (previos.some(l => l.estado === 'APLICADO')) {
      return { ok: false, error: 'Esta migración ya tiene datos importados. Deshazla antes de cambiar los archivos.' }
    }
  }

  const m = await leerMigracion(archivos)
  // El reconocimiento se devuelve pase lo que pase: aunque no se pueda seguir, el
  // operador tiene que ver QUÉ ha entendido de cada archivo para saber qué corregir.
  const reconocimiento = {
    empresa: m.empresa, periodo: m.periodo, fichas: m.fichas, cuadre: m.cuadre,
    utilidad: m.utilidad, sinArchivo: m.sinArchivo, facturas: m.facturas,
    grupos: m.grupos, avisos: m.avisos,
  }
  if (m.errores.length) return { ok: false, error: m.errores[0], errores: m.errores, ...reconocimiento }
  // Antes de escribir nada: si falta el estado y se estaba pidiendo, no se crea
  // ningún lote ni se borran los de la lectura anterior. Así un archivo
  // equivocado no se lleva por delante lo que ya estaba subido.
  if (exigeEstado && !m.fichas.some(f => f.tipo === 'estado')) {
    return { ok: false, error: 'Falta el Estado de rendimiento financiero.', ...reconocimiento }
  }

  const migracion_id = generarMigracionId()
  // El cuadre se guarda YA, con el lote: es lo que decide si se puede aplicar
  // (D2), y la comprobación vive en el servidor —en el lote— para que no dependa
  // de que el asistente la haya hecho ni de lo que diga el navegador.
  const conEstado = m.fichas.some(f => f.tipo === 'estado')
  const cuadre = resumenCuadre(m.cuadre, conEstado)
  const lotes: { lote_id: string; entidad: string; etiqueta: string; filas: number; columnas: Record<string, string> }[] = []
  for (const lote of m.lotes) {
    const adaptador = ADAPTADORES[lote.entidad]
    const lote_id = generarLoteId()
    const { error } = await r.ctx.db.from('import_lotes').insert({
      lote_id, client_id: r.ctx.client_id, entidad: lote.entidad, estado: 'BORRADOR',
      operador: r.operador, cabeceras: lote.cabeceras, datos: lote.filas, total_filas: lote.filas.length,
      mapping: {
        // Las cabeceras las escribimos nosotros con el nombre interno del campo:
        // en una migración no hay paso de mapear, lo sustituye el reconocimiento.
        columnas: lote.columnas,
        // La empresa y la moneda las elige el operador en el asistente; se guardan
        // al validar, como en cualquier otro lote.
        defaults: {},
        // Un libro mayor es un histórico y el cliente está vacío: cada línea es un
        // hecho distinto aunque dos digan lo mismo, y no hay nada con lo que chocar.
        politica: 'CREAR',
        repetidas: 'DISTINTAS',
        // La huella: de qué archivo y qué cuenta salió cada trozo del lote. Sin
        // esto una migración no se puede auditar ni reagrupar para deshacerla.
        origen: {
          perfil: 'liangapp', migracion_id,
          empresa: m.empresa, periodo: m.periodo,
          cuentas: lote.cuentas,
          cuadre,
          // Los grupos son de gasto (un cobro lleva concepto libre) y las
          // facturas, de cobros: cada cosa viaja en el lote que la usa.
          ...(lote.entidad === 'gastos' ? { grupos: m.grupos } : {}),
          ...(lote.entidad === 'cobros' ? { facturas: m.facturas } : {}),
        } satisfies OrigenLiangApp,
      },
    })
    if (error) return { ok: false, error: error.message, ...reconocimiento }
    lotes.push({
      lote_id, entidad: lote.entidad, etiqueta: adaptador.etiqueta,
      filas: lote.filas.length, columnas: lote.columnas,
    })
  }

  if (reemplaza && reemplaza !== migracion_id) await borrarBorradoresDeMigracion(r.ctx, reemplaza)
  return { ok: true, migracion_id, lotes, ...reconocimiento }
}

/**
 * Borra los lotes de una migración que aún no se han aplicado. Se llama al
 * releer los archivos: lo aplicado NO se toca —para eso está deshacer—.
 */
async function borrarBorradoresDeMigracion(ctx: CtxImport, migracion_id: string): Promise<void> {
  const ids = (await lotesDeMigracion(ctx, migracion_id))
    .filter(l => l.estado !== 'APLICADO')
    .map(l => l.lote_id)
  if (!ids.length) return
  // Los items caen solos: `import_lote_items` cuelga del lote con ON DELETE CASCADE
  // y no tiene `client_id` (mig. 128).
  await ctx.db.from('import_lotes').delete().eq('client_id', ctx.client_id).in('lote_id', ids)
}

/** Un lote de migración con su huella ya desempaquetada. */
interface LoteMigracion {
  lote_id: string
  entidad: string
  estado: string
  datos: Record<string, string>[]
  mapping: Record<string, unknown>
  origen: OrigenLiangApp
}

/** Los lotes de una migración, en el orden en que se abren (gastos → cobros). */
async function lotesDeMigracion(ctx: CtxImport, migracion_id: string): Promise<LoteMigracion[]> {
  const cols = 'lote_id, entidad, estado, datos, mapping'
  const primera = await ctx.db.from('import_lotes').select(cols)
    .eq('client_id', ctx.client_id)
    .eq('mapping->origen->>migracion_id', migracion_id)
  let data = primera.data
  // Red de seguridad: si el filtro por dentro del jsonb no sale, se acotan los
  // últimos lotes del cliente y se reparte aquí. Perder la migración a mitad de
  // camino dejaría al operador con dos lotes en BORRADOR y sin forma de seguir.
  if (primera.error || !data?.length) {
    ({ data } = await ctx.db.from('import_lotes').select(cols)
      .eq('client_id', ctx.client_id).order('creado_at', { ascending: false }).limit(20))
  }
  const lotes = ((data ?? []) as { lote_id: string; entidad: string; estado: string; datos: unknown; mapping: unknown }[])
    .map(l => ({
      lote_id: l.lote_id, entidad: l.entidad, estado: l.estado,
      datos: (l.datos ?? []) as Record<string, string>[],
      mapping: (l.mapping ?? {}) as Record<string, unknown>,
      origen: ((l.mapping ?? {}) as { origen?: OrigenLiangApp }).origen as OrigenLiangApp,
    }))
    // El filtro por JSON ya acota, pero el perfil se comprueba igual: `origen` es
    // un jsonb libre y aquí se va a escribir encima de él.
    .filter(l => l.origen?.perfil === 'liangapp' && l.origen.migracion_id === migracion_id)
  const orden = ORDEN_MIGRACION as string[]
  return lotes.sort((a, b) => orden.indexOf(a.entidad) - orden.indexOf(b.entidad))
}

/**
 * Lo que el operador decide en el paso de reconocer, aplicado a los lotes que ya
 * están en la BD.
 *
 * Es una llamada de unos pocos bytes a propósito: cambiar la categoría de un
 * grupo o apartar una cuenta no puede costar volver a subir los archivos —esto
 * se usa desde Cuba—, así que las filas se quedan en el servidor y solo viajan
 * las decisiones. Una cuenta apartada no se borra: sus filas se guardan enteras
 * en `origen.apartadas` y vuelven a su sitio, en su orden, si se readmite.
 *
 * Cualquier ajuste devuelve el lote a BORRADOR: lo que se validó antes ya no es
 * lo que hay.
 */
export async function ajustarMigracionLiangApp(
  migracion_id: string,
  ajustes: { grupos?: Record<string, string>; excluidas?: number[] },
): Promise<{
  ok: boolean; error?: string
  grupos?: GrupoPropuesto[]
  cuadre?: ResumenCuadre
  lotes?: { lote_id: string; entidad: string; filas: number; apartadas: number }[]
  /** Grupos de gasto que siguen sin categoría: con esto > 0 no se puede seguir. */
  pendientes?: number
}> {
  const r = await resolverCtx()
  if (!r) return { ok: false, error: 'Solo disponible en modo configuración.' }
  const implicados = ['gastos', 'cobros'].map(e => ADAPTADORES[e]).filter(Boolean)
  for (const a of implicados) {
    if (!(await puedeEditarAlgunModulo(a.modulos))) return { ok: false, error: 'El cliente no tiene contratado el módulo necesario.' }
  }

  const lotes = await lotesDeMigracion(r.ctx, migracion_id)
  if (!lotes.length) return { ok: false, error: 'Migración no encontrada.' }
  const aplicado = lotes.find(l => l.estado === 'APLICADO')
  if (aplicado) return { ok: false, error: 'La migración ya se aplicó: deshazla para volver a tocarla.' }

  const fuera = new Set(ajustes.excluidas ?? [])
  const elegidas = ajustes.grupos ?? {}
  let grupos: GrupoPropuesto[] = []
  const resumen: { lote_id: string; entidad: string; filas: number; apartadas: number }[] = []

  for (const lote of lotes) {
    // Las apartadas vuelven a la mesa antes de repartir: el operador puede haber
    // readmitido una cuenta, y el orden original lo guarda cada fila.
    const todas = [...lote.datos, ...(lote.origen.apartadas ?? [])]
      .sort((a, b) => Number(a[COL_ORDEN] ?? 0) - Number(b[COL_ORDEN] ?? 0))

    for (const fila of todas) {
      const clave = elegidas[fila[COL_GRUPO] ?? '']
      if (lote.entidad === 'gastos' && clave) Object.assign(fila, categoriaDeClave(clave))
    }
    const datos    = todas.filter(f => !fuera.has(Number(f[COL_CUENTA])))
    const apartadas = todas.filter(f =>  fuera.has(Number(f[COL_CUENTA])))

    // El recuento de cada grupo se rehace sobre lo que queda: apartar una cuenta
    // vacía sus grupos, y verlo a cero es lo que le dice al operador que ya no
    // tiene que clasificarlos.
    const suyos = (lote.origen.grupos ?? []).map(g => {
      const filas = datos.filter(f => f[COL_GRUPO] === g.grupo)
      return {
        ...g,
        lineas: filas.length,
        importe: Math.round(filas.reduce((s, f) => s + Number(f.monto ?? 0), 0) * 100) / 100,
        propuesta: elegidas[g.grupo] ?? g.propuesta,
      }
    })
    if (suyos.length) grupos = suyos

    const cuadre = resumenCuadre(lote.origen.cuadre.filas, lote.origen.cuadre.con_estado, [...fuera])
    const origen: OrigenLiangApp = {
      ...lote.origen, cuadre,
      ...(lote.origen.grupos ? { grupos: suyos } : {}),
      apartadas,
    }
    const { error } = await r.ctx.db.from('import_lotes').update({
      datos, total_filas: datos.length,
      mapping: { ...lote.mapping, origen },
      // Se validará otra vez: las filas ya no son las mismas.
      estado: 'BORRADOR', filas_ok: 0, filas_error: 0,
    }).eq('lote_id', lote.lote_id).eq('client_id', r.ctx.client_id)
    if (error) return { ok: false, error: error.message }
    resumen.push({ lote_id: lote.lote_id, entidad: lote.entidad, filas: datos.length, apartadas: apartadas.length })
  }

  const cuadre = resumenCuadre(lotes[0].origen.cuadre.filas, lotes[0].origen.cuadre.con_estado, [...fuera])
  return {
    ok: true, grupos, cuadre, lotes: resumen,
    pendientes: grupos.filter(g => g.lineas > 0 && !g.propuesta).length,
  }
}

/**
 * Deshace una migración entera: sus lotes, al revés de como se aplicaron.
 *
 * Al revés importa: los cobros se apoyan en fichas de tercero que pudo crear el
 * lote de gastos, y una ficha no se borra si todavía la usa alguien. Los lotes
 * que no llegaron a aplicarse se saltan sin ruido.
 */
export async function deshacerMigracionLiangApp(
  migracion_id: string,
): Promise<{
  ok: boolean; error?: string
  lotes?: { lote_id: string; entidad: string; resumen?: ResumenDeshacer; error?: string }[]
}> {
  const r = await resolverCtx()
  if (!r) return { ok: false, error: 'Solo disponible en modo configuración.' }
  const lotes = await lotesDeMigracion(r.ctx, migracion_id)
  if (!lotes.length) return { ok: false, error: 'Migración no encontrada.' }

  const hechos: { lote_id: string; entidad: string; resumen?: ResumenDeshacer; error?: string }[] = []
  for (const lote of [...lotes].reverse()) {
    if (lote.estado !== 'APLICADO') continue
    const res = await deshacerLoteImport(lote.lote_id)
    hechos.push({ lote_id: lote.lote_id, entidad: lote.entidad, resumen: res.resumen, error: res.error })
  }
  if (!hechos.length) return { ok: false, error: 'Esta migración no tiene ningún lote aplicado.' }
  return { ok: true, lotes: hechos }
}

/**
 * La plantilla de FACTURAS de una migración, ya rellena.
 *
 * Lo facturado no se importa como cobro: una factura es un documento con
 * cliente, vencimiento y estado, y el libro mayor solo sabe el número, la fecha
 * y el importe (D3). Eso es justo lo que trae esta plantilla —el resto lo pone
 * el cliente—, y se sube por el asistente de siempre, como cualquier archivo.
 */
export async function plantillaFacturasLiangApp(
  migracion_id: string,
): Promise<{ ok: boolean; error?: string; base64?: string; nombre?: string; facturas?: number; avisos?: string[] }> {
  const r = await resolverCtx()
  if (!r) return { ok: false, error: 'Solo disponible en modo configuración.' }
  const adaptador = ADAPTADORES['facturas']
  if (!adaptador) return { ok: false, error: 'Entidad no soportada.' }
  if (!(await puedeEditarAlgunModulo(adaptador.modulos))) return { ok: false, error: 'El cliente no tiene contratado el módulo necesario.' }

  const lotes = await lotesDeMigracion(r.ctx, migracion_id)
  if (!lotes.length) return { ok: false, error: 'Migración no encontrada.' }
  const facturas = lotes.map(l => l.origen.facturas).find(f => f?.length) ?? []
  if (!facturas.length) return { ok: false, error: 'Esta migración no ha detectado ninguna factura.' }

  const extra = adaptador.camposExtra ? await adaptador.camposExtra(r.ctx) : []
  const campos = [...adaptador.campos, ...extra]

  // La columna que falta va marcada: es la única que el operador tiene que
  // rellenar a mano, y en 122 líneas conviene que se vea de lejos.
  const pendiente: CeldaEstilo = { backgroundColor: MARCA.ejemploBg }
  const filas = facturas.map(f => {
    const celda: Record<string, ReturnType<typeof texto>> = {
      numero:  texto(f.numero),
      cliente: texto('', pendiente),
      fecha:   fecha(f.fecha) ?? texto(f.fecha),
      importe: numero(f.importe, { format: '#,##0.00' }),
      concepto: texto(f.descripcion),
      notas_internas: texto(`Migrado de LiangApp · ${f.archivo}, fila ${f.fila}`),
    }
    return campos.map(c => celda[c.campo] ?? texto(''))
  })

  const repetidos = [...facturas.reduce((m, f) => m.set(f.numero, (m.get(f.numero) ?? 0) + 1), new Map<string, number>())]
    .filter(([, n]) => n > 1).map(([numero]) => numero)
  const avisos = repetidos.length
    ? [`${repetidos.length} número(s) de factura salen en más de una línea (${repetidos.slice(0, 3).join(', ')}). Repásalos antes de subir el archivo.`]
    : []

  const [hojaDatos, hojaAyuda] = hojasDePlantilla(adaptador.etiqueta, campos, filas, [
    '1. Este archivo ya trae tus facturas: número, fecha e importe salen de tu libro mayor.',
    '2. Completa la columna «Cliente» (en gris) de cada línea: es lo único que el libro no dice.',
    '3. Si conoces el vencimiento o lo ya cobrado, rellénalos; si no, déjalos en blanco.',
    '4. No cambies ni borres la primera fila (las cabeceras).',
    '5. Guarda y súbelo en CLAUX → Importar datos → Facturas de venta.',
  ])
  const base64 = await construirXlsxBase64([hojaDatos, hojaAyuda])
  return { ok: true, base64, nombre: `facturas-${migracion_id}.xlsx`, facturas: facturas.length, avisos }
}

/**
 * Dry-run de una TANDA: valida sin escribir desde la fila `desde` hasta agotar
 * el presupuesto de tiempo. El asistente repite mientras `siguiente` no sea null.
 */
export async function validarLoteImport(
  lote_id: string, mapeo: MapeoImport, desde = 0, claves: ClavesVistas = [],
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
  // El `origen` lo escribe el perfil de LiangApp al crear el lote (de qué archivo
  // y qué cuenta salió cada fila) y el asistente no lo maneja: si no se conserva
  // aquí, el primer guardado del mapeo se lo lleva por delante. Se copia solo esa
  // clave a propósito: el resto del mapeo tiene que poder MENGUAR —quitar una
  // resolución es una decisión del operador, no un descuido.
  const origen = (lote.mapping as { origen?: unknown } | null)?.origen
  await r.ctx.db.from('import_lotes').update({
    mapping:     origen ? { ...mapeo, origen } : mapeo,
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
  lote_id: string, desde = 0, claves: ClavesVistas = [],
): Promise<{
  ok: boolean; error?: string; trozo?: TrozoAplicacion
  /** Solo en la última tanda: lo que el lote creó DE PASO (proveedores, categorías,
   *  clientes o servicios que nombraba una fila y no existían todavía). */
  auxiliares?: { etiqueta: string; cantidad: number }[]
}> {
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

  // El cuadre de una migración es obligatorio (plan, D2) y se comprueba AQUÍ, en
  // el servidor, sobre lo que quedó escrito en el lote: es la única validación
  // externa que tenemos —los libros contra el propio cierre del cliente— y no
  // puede depender de que el asistente la haya hecho.
  const huella = (lote.mapping as { origen?: OrigenLiangApp }).origen
  if (huella?.perfil === 'liangapp' && !huella.cuadre?.ok) {
    return { ok: false, error: !huella.cuadre?.con_estado
      ? 'Falta el Estado de rendimiento financiero. Vuelve al reconocimiento y añádelo a los archivos.'
      : 'La migración no cuadra con el Estado de rendimiento financiero. Vuelve al reconocimiento y aparta las cuentas que no cuadran.' }
  }

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

    // Lo que el lote creó DE PASO (fila_origen = 0): no es una fila del archivo,
    // así que no sale en insertadas/actualizadas, y el operador tiene derecho a
    // saber qué más tocó la importación antes de darla por revisada.
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
 * En qué quedó un lote, según la base y no según la pantalla. Se pregunta cuando
 * el operador SALIÓ a mitad de un proceso: el servidor siguió trabajando sin él,
 * así que al volver el asistente no puede fiarse de lo que tenía en memoria.
 * Solo lee.
 */
export async function estadoLoteImport(lote_id: string): Promise<{
  ok: boolean; error?: string
  estado?: string
  /** Filas del archivo ya escritas (las de la traza, sin contar lo creado de paso). */
  escritas?: number
  resumen?: { insertadas: number; actualizadas: number; saltadas: number; errores: number }
  auxiliares?: { etiqueta: string; cantidad: number }[]
}> {
  const r = await resolverCtx()
  if (!r) return { ok: false, error: 'Solo disponible en modo configuración.' }
  const { data: lote } = await r.ctx.db.from('import_lotes').select('estado')
    .eq('lote_id', lote_id).eq('client_id', r.ctx.client_id).maybeSingle()
  if (!lote) return { ok: false, error: 'Lote no encontrado.' }

  // Los contadores salen de la traza, que es lo que de verdad se escribió. Las
  // filas del archivo van por `fila_origen > 0`: el 0 es lo creado de paso.
  const cuenta = async (accion: string) => (await r.ctx.db.from('import_lote_items')
    .select('*', { count: 'exact', head: true })
    .eq('lote_id', lote_id).eq('accion', accion).gt('fila_origen', 0)).count ?? 0
  const resumen = {
    insertadas:   await cuenta('INSERTADA'),
    actualizadas: await cuenta('ACTUALIZADA'),
    saltadas:     await cuenta('SALTADA'),
    errores:      await cuenta('ERROR'),
  }
  const { data: auxRows } = await r.ctx.db.from('import_lote_items')
    .select('entidad').eq('lote_id', lote_id).eq('fila_origen', 0).eq('accion', 'INSERTADA')
  const conteo = new Map<string, number>()
  for (const fila of (auxRows ?? []) as { entidad: string }[]) {
    conteo.set(fila.entidad, (conteo.get(fila.entidad) ?? 0) + 1)
  }
  return {
    ok: true,
    estado: lote.estado as string,
    escritas: resumen.insertadas + resumen.actualizadas + resumen.saltadas + resumen.errores,
    resumen,
    auxiliares: [...conteo.entries()]
      .map(([entidad, cantidad]) => ({ etiqueta: ETIQUETAS_AUXILIARES[entidad] ?? entidad, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad),
  }
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

  // Con todos los deshacedores: un lote de gastos puede haber creado fichas de
  // tercero o categorías, y esas se deshacen con el suyo, no con el de la
  // entidad del lote.
  const resumen = await deshacerLoteFilas(lote_id, adaptador, r.ctx, DESHACEDORES)
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
