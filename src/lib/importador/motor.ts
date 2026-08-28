// Motor genérico del importador: construye valores desde una fila + mapeo,
// valida en seco (dry-run) y aplica en lote (commit idempotente). No conoce las
// entidades; delega en el `Adaptador`. Vive fuera de 'use server' a propósito:
// el `client_id` llega en el `ctx` (resuelto por la acción desde la sesión).
//
// El trabajo va en TANDAS (§`TrozoValidacion`): cada fila cuesta una o más
// consultas contra Supabase (~130 ms medidos), así que un archivo grande no cabe
// en el tiempo de una función serverless. Cada llamada trabaja hasta agotar su
// presupuesto y devuelve por dónde seguir.

import { norm } from './util'
import type {
  Adaptador, ClavesVistas, CtxImport, MapeoImport, FilaRepetida, FilaResultado,
  ResultadoValidacion, ResumenAplicacion, TrozoValidacion, TrozoAplicacion,
} from './tipos'
import {
  DIMENSIONES, cargarContextoLimites, contarActivos, huecoDisponible, limiteDe, mensajeLimiteCrear,
} from '@/lib/limites'

/** Presupuesto de una tanda: lo que llegue antes. */
const FILAS_TANDA = 200
const MS_TANDA    = 8_000

/** Fin de la tanda que empieza en `desde` (o de la carrera contra el reloj). */
function seAcabaElTiempo(t0: number, hechas: number): boolean {
  return hechas >= FILAS_TANDA || Date.now() - t0 > MS_TANDA
}

/**
 * Fila del CSV (objeto por cabecera) + mapeo → valores por campo interno.
 * `deColumna` marca lo que trae el ARCHIVO, frente a lo que puso un default del
 * asistente: al actualizar solo cuenta lo primero (un default global no puede
 * cambiarle la unidad o la moneda a algo que ya existía).
 */
export function construirValores(
  fila: Record<string, string>, mapeo: MapeoImport,
): { valores: Record<string, string>; deColumna: Set<string> } {
  const valores: Record<string, string> = {}
  const deColumna = new Set<string>()
  for (const [campo, columna] of Object.entries(mapeo.columnas)) {
    if (!columna) continue
    valores[campo] = (fila[columna] ?? '').toString().trim()
    if (valores[campo]) deColumna.add(campo)
  }
  // Los defaults rellenan lo que no vino mapeado o vino vacío (empresa, moneda…).
  for (const [campo, val] of Object.entries(mapeo.defaults)) {
    if (!valores[campo]) valores[campo] = val
  }
  return { valores, deColumna }
}

const MOTIVO_EJEMPLO = 'Es la fila de ejemplo de la plantilla: bórrala del archivo.'

/**
 * ¿Es la fila de muestra que lleva la plantilla modelo? El cliente rellena
 * debajo sin borrarla y se cuela «Comercial Ejemplo S.A.» entre sus datos.
 * Solo salta si TODO lo que trae la fila coincide con el ejemplo: en cuanto el
 * cliente escribe algo propio, deja de serlo y se importa como cualquier otra.
 */
function esFilaEjemplo(
  valores: Record<string, string>, deColumna: Set<string>, adaptador: Adaptador,
): boolean {
  if (deColumna.size < 2) return false   // con un solo dato la coincidencia es casualidad
  for (const campo of deColumna) {
    const ejemplo = adaptador.campos.find(c => c.campo === campo)?.ejemplo
    if (!ejemplo || norm(valores[campo]) !== norm(ejemplo)) return false
  }
  return true
}

/**
 * Dos filas del archivo con la misma clave natural: ¿es un error del archivo o
 * son dos hechos distintos que se parecen?
 *
 * En un MAESTRO siempre es un error: dos fichas del mismo producto no existen.
 * En una entidad de HECHOS (`Adaptador.repetible`: gastos, cobros) puede ser
 * perfectamente real —dos facturas al mismo cliente, el mismo día y por el mismo
 * importe—, y eso no lo sabe el importador: lo sabe el dueño del negocio. Así que
 * no se adivina, se PREGUNTA (`MapeoImport.repetidas`), igual que con los nombres
 * que no se emparejan.
 *
 * Y para poder preguntar bien hace falta enseñar la comparación: `compararFilas`
 * mira las dos filas del archivo campo a campo y devuelve en qué se diferencian.
 * Con eso el aviso puede decir «se diferencian en las notas: "Factura No. 56" /
 * "Factura No. 49"», que es lo único que permite decidir sin abrir el Excel.
 */
function compararFilas(
  aqui: Record<string, string>, alli: Record<string, string>,
  mapeo: MapeoImport, adaptador: Adaptador,
): FilaRepetida['difieren'] {
  const out: FilaRepetida['difieren'] = []
  for (const [campo, columna] of Object.entries(mapeo.columnas)) {
    if (!columna) continue
    const a = (aqui[columna] ?? '').toString().trim()
    const b = (alli[columna] ?? '').toString().trim()
    if (norm(a) === norm(b)) continue
    out.push({
      etiqueta: adaptador.campos.find(c => c.campo === campo)?.etiqueta ?? campo,
      aqui: a || '—',
      alli: b || '—',
    })
  }
  return out
}

/**
 * Lo que las dos filas COMPARTEN, en una línea: los tres primeros campos mapeados
 * que coinciden. Sirve para reconocer de qué fila se habla sin abrir el archivo.
 */
function resumenFila(
  valores: Record<string, string>, mapeo: MapeoImport, adaptador: Adaptador,
): string {
  const partes: string[] = []
  for (const campo of Object.keys(mapeo.columnas)) {
    if (!mapeo.columnas[campo] || !valores[campo]) continue
    partes.push(valores[campo])
    if (partes.length === 3) break
  }
  return partes.join(' · ') || adaptador.etiqueta
}

/**
 * Cuánto cupo del nivel queda libre para la entidad del adaptador.
 *
 * Se informa en el DRY-RUN y se aplica de verdad en el commit. Es un dato de la
 * base —no del archivo—, así que no hace falta acumularlo entre tandas: en la
 * primera y en la última dice lo mismo, que es lo que el operador necesita saber
 * antes de pulsar «Importar».
 */
async function cupoLibre(adaptador: Adaptador, ctx: CtxImport): Promise<ResultadoValidacion['cupo']> {
  const dim = adaptador.dimension
  if (!dim || dim === 'ia_conversaciones') return undefined
  const libre = await huecoDisponible(ctx.db, ctx.client_id, dim)
  if (libre === null) return undefined            // ilimitado: nada que avisar
  const limite = await limiteDe(ctx.db, ctx.client_id, dim)
  return { dimension: dim, etiqueta: DIMENSIONES[dim].varios, libre, limite: limite ?? 0 }
}

/** Dry-run: valida cada fila SIN escribir. Marca duplicados dentro del archivo. */
export async function validarLoteFilas(
  filas: Record<string, string>[], mapeo: MapeoImport, adaptador: Adaptador, ctx: CtxImport,
  desde = 0, clavesPrevias: ClavesVistas = [],
): Promise<TrozoValidacion> {
  const t0 = Date.now()
  const vistos = new Map(clavesPrevias)
  const res: FilaResultado[] = []
  const repetidas: FilaRepetida[] = []
  const buenas: Record<string, unknown>[] = []
  // Los nombres sin emparejar se recogen aquí y suben al asistente para que el
  // operador diga a qué corresponden (§`resolver.ts`).
  ctx.pendientes  = new Map()
  ctx.resoluciones = mapeo.resoluciones

  let i = desde
  for (; i < filas.length && !seAcabaElTiempo(t0, i - desde); i++) {
    const { valores, deColumna } = construirValores(filas[i], mapeo)
    ctx.fila = i + 1
    if (esFilaEjemplo(valores, deColumna, adaptador)) {
      res.push({ fila: i + 1, ok: false, motivo: MOTIVO_EJEMPLO }); continue
    }
    const prep = await adaptador.preparar(valores, ctx, deColumna)
    if (!prep.ok) { res.push({ fila: i + 1, ok: false, motivo: prep.motivo, decidir: prep.decidir }); continue }
    const gemela = vistos.get(prep.clave)
    if (gemela !== undefined) {
      // Un maestro no se pregunta: dos fichas con la misma identidad son un error
      // del archivo y punto.
      if (!adaptador.repetible) {
        res.push({ fila: i + 1, ok: false, motivo: `Fila duplicada: es la misma que la fila ${gemela}.` })
        continue
      }
      // Se reportan SIEMPRE, incluso ya decididas: el panel del asistente es lo
      // único que dice qué se decidió, y si desapareciera al elegir, el operador
      // se quedaría sin saber si su clic hizo algo.
      const decision = mapeo.repetidas ?? 'DECIDIR'
      const difieren = compararFilas(filas[i], filas[gemela - 1], mapeo, adaptador)
      repetidas.push({ fila: i + 1, gemela, difieren, resumen: resumenFila(valores, mapeo, adaptador) })
      if (decision !== 'DISTINTAS') {
        res.push({
          fila: i + 1, ok: false, decidir: decision === 'DECIDIR',
          motivo: decision === 'DECIDIR'
            ? `Dice lo mismo que la fila ${gemela}.`
            : `Repetida de la fila ${gemela}: la dejaste fuera.`,
        })
        continue
      }
      // 'DISTINTAS': el operador ya dijo que son hechos distintos. Pasa como
      // cualquier otra fila —incluida la comprobación contra la base, que sí mira
      // lo que las diferencia y por eso encuentra su propio registro al reimportar.
    }
    vistos.set(prep.clave, i + 1)
    const existente = await adaptador.buscarExistente(prep.datos, ctx)
    const accion = !existente ? 'INSERTAR'
      : mapeo.politica === 'ACTUALIZAR' ? 'ACTUALIZAR'
      : mapeo.politica === 'CREAR' ? 'INSERTAR' : 'SALTAR'
    if (accion !== 'SALTAR') buenas.push(prep.datos)
    res.push({ fila: i + 1, ok: true, accion })
  }
  const ok         = res.filter(f => f.ok).length
  const porDecidir = res.filter(f => f.decidir).length
  // Desglose por acción de las filas OK: es lo que deja al asistente decir «20 ya
  // existen y se saltarán» en vez de esconderlo tras un «20 listas para importar».
  const nuevos     = res.filter(f => f.ok && f.accion === 'INSERTAR').length
  const actualizar = res.filter(f => f.ok && f.accion === 'ACTUALIZAR').length
  const saltar     = res.filter(f => f.ok && f.accion === 'SALTAR').length
  return {
    total: filas.length, ok, errores: res.length - ok - porDecidir, por_decidir: porDecidir,
    nuevos, actualizar, saltar, filas: res,
    resumen:    adaptador.resumen?.(buenas),
    pendientes: [...ctx.pendientes.values()],
    repetidas,
    cupo:       await cupoLibre(adaptador, ctx),
    claves:     [...vistos],
    siguiente:  i < filas.length ? i : null,
  }
}

export interface ResumenDeshacer {
  deshechas: number
  intactas:  number
  motivos:   { fila: number; motivo: string }[]
}

/**
 * Traza de una ficha que creó el lote SIN ser una fila del archivo: el proveedor
 * que un gasto nombraba y no existía todavía. Va con `fila_origen = 0` —el
 * archivo empieza en 1— para no chocar con la idempotencia por fila, y por eso
 * mismo `deshacerLoteFilas` la deshace DESPUÉS de las filas que la referencian.
 */
export async function registrarAuxiliar(
  ctx: CtxImport, entidad: string, pk: string,
): Promise<void> {
  if (!ctx.lote_id) return   // dry-run: aquí no se escribe nada
  await ctx.db.from('import_lote_items').insert({
    lote_id: ctx.lote_id, entidad, fila_origen: 0, accion: 'INSERTADA', pk_destino: pk, motivo: null,
  })
}

/**
 * Deshace un lote APLICADO: recorre lo que insertó y se lo pide al adaptador.
 * Lo que sí se deshace pierde su traza en `import_lote_items` —para poder volver
 * a aplicar el lote corregido—; lo que no se pudo deshacer la conserva, con su
 * motivo a la vista. Las filas ACTUALIZADAS no se tocan: no sabemos qué había
 * antes, y adivinarlo sería peor que dejarlo.
 *
 * Un lote puede haber creado fichas de OTRA entidad (`registrarAuxiliar`), así
 * que cada traza se deshace con el deshacedor de la suya (`porEntidad`) y esas
 * van al final: mientras el gasto que las nombra siga ahí, la ficha se niega a
 * borrarse —y con razón—. `porEntidad` acepta adaptadores completos y también
 * deshacedores sueltos: la categoría que un lote de gastos creó de paso no es
 * una entidad importable, pero sí tiene que poder desaparecer al deshacer.
 */
export async function deshacerLoteFilas(
  loteId: string, adaptador: Adaptador, ctx: CtxImport,
  porEntidad: Record<string, Pick<Adaptador, 'deshacer'>> = {},
): Promise<ResumenDeshacer> {
  ctx.lote_id = loteId
  const r: ResumenDeshacer = { deshechas: 0, intactas: 0, motivos: [] }
  if (!adaptador.deshacer) {
    return { deshechas: 0, intactas: 0, motivos: [{ fila: 0, motivo: 'Esta entidad no se puede deshacer automáticamente.' }] }
  }
  const { data } = await ctx.db.from('import_lote_items')
    .select('item_id, entidad, fila_origen, pk_destino')
    .eq('lote_id', loteId).eq('accion', 'INSERTADA').order('fila_origen')

  type Traza = { item_id: number; entidad: string; fila_origen: number; pk_destino: string | null }
  const trazas = ((data ?? []) as Traza[])
    .sort((a, b) => Number(a.fila_origen === 0) - Number(b.fila_origen === 0))

  for (const it of trazas) {
    if (!it.pk_destino) continue
    const suyo = porEntidad[it.entidad] ?? adaptador
    if (!suyo.deshacer) { r.intactas++; continue }
    let motivo: string | null
    try {
      motivo = await suyo.deshacer(it.pk_destino, ctx)
    } catch (e) {
      motivo = (e as Error).message
    }
    if (motivo) {
      r.intactas++
      // Las auxiliares no tienen fila en el archivo: se identifican por su código.
      r.motivos.push({
        fila:   it.fila_origen,
        motivo: it.fila_origen === 0 ? `${it.pk_destino}: ${motivo}` : motivo,
      })
      await ctx.db.from('import_lote_items').update({ motivo }).eq('item_id', it.item_id)
    } else {
      r.deshechas++
      await ctx.db.from('import_lote_items').delete().eq('item_id', it.item_id)
    }
  }
  return r
}

async function registrarItem(
  ctx: CtxImport, loteId: string, entidad: string, fila: number,
  accion: string, pk: string | null, motivo: string | null,
): Promise<void> {
  await ctx.db.from('import_lote_items').insert({
    lote_id: loteId, entidad, fila_origen: fila, accion, pk_destino: pk, motivo,
  })
}

/**
 * Commit: escribe cada fila vía el adaptador y traza en `import_lote_items`.
 * Idempotente ante reintentos: salta las filas ya registradas por su nº, así que
 * si una tanda se corta a medias, repetirla no duplica nada.
 */
export async function aplicarLoteFilas(
  loteId: string, filas: Record<string, string>[], mapeo: MapeoImport, adaptador: Adaptador, ctx: CtxImport,
  desde = 0, clavesPrevias: ClavesVistas = [],
): Promise<TrozoAplicacion> {
  ctx.lote_id = loteId   // los adaptadores de ledger lo dejan como referencia del movimiento
  // Las decisiones del operador van en el mapeo; aquí ya no se recoge ningún
  // pendiente (`ctx.pendientes` sin poner): lo que siga sin decidir no se escribe.
  ctx.resoluciones = mapeo.resoluciones
  const t0 = Date.now()
  const { data: prev } = await ctx.db.from('import_lote_items').select('fila_origen').eq('lote_id', loteId)
  const hechas = new Set((prev ?? []).map((r: { fila_origen: number }) => r.fila_origen))
  const vistos = new Map(clavesPrevias)
  const r: ResumenAplicacion = { insertadas: 0, actualizadas: 0, saltadas: 0, errores: 0 }

  // Presupuesto de cupo de ESTA tanda. Se recuenta contra la base al empezar cada
  // una, así que ya incluye lo que insertaron las anteriores: no hay que acumular
  // nada entre llamadas y un reintento no descuadra.
  //
  // Lo que no cabe se SALTA con su motivo, no revienta el lote. Un fichero de 400
  // productos con sitio para 58 mete 58 y deja escrito, fila por fila, por qué las
  // otras 342 no entraron; abortarlo entero dejaría al cliente sin nada y sin saber
  // qué le faltó.
  const dim = adaptador.dimension && adaptador.dimension !== 'ia_conversaciones'
    ? adaptador.dimension : null
  const cupo = dim ? await cargarContextoLimites(ctx.db, ctx.client_id) : null
  const tope = dim && cupo ? cupo.limites[dim] ?? null : null
  let presupuesto = tope === null || !dim
    ? null                                                   // ilimitado o sin dimensión
    : Math.max(0, tope - await contarActivos(ctx.db, ctx.client_id, dim))

  let i = desde
  for (; i < filas.length && !seAcabaElTiempo(t0, i - desde); i++) {
    const fila = i + 1
    if (hechas.has(fila)) continue   // ya procesada en un intento anterior
    const { valores, deColumna } = construirValores(filas[i], mapeo)
    ctx.fila = fila
    if (esFilaEjemplo(valores, deColumna, adaptador)) {
      await registrarItem(ctx, loteId, adaptador.entidad, fila, 'ERROR', null, MOTIVO_EJEMPLO); r.errores++; continue
    }
    const prep = await adaptador.preparar(valores, ctx, deColumna)
    if (!prep.ok) { await registrarItem(ctx, loteId, adaptador.entidad, fila, 'ERROR', null, prep.motivo); r.errores++; continue }
    const gemela = vistos.get(prep.clave)
    // Solo se escriben las repetidas que el operador declaró distintas. Sin
    // decidir (o decididas fuera) se saltan: el commit no pregunta nada.
    if (gemela !== undefined && !(adaptador.repetible && mapeo.repetidas === 'DISTINTAS')) {
      await registrarItem(ctx, loteId, adaptador.entidad, fila, 'SALTADA', null, `Repetida de la fila ${gemela}`)
      r.saltadas++; continue
    }
    vistos.set(prep.clave, fila)
    try {
      const existente = await adaptador.buscarExistente(prep.datos, ctx)
      if (existente && mapeo.politica === 'SALTAR') {
        await registrarItem(ctx, loteId, adaptador.entidad, fila, 'SALTADA', existente, 'Ya existe')
        r.saltadas++
      } else if (existente && mapeo.politica === 'ACTUALIZAR') {
        // Solo lo que el archivo trae (§`Preparado.provistos`): actualizar
        // rellena y corrige, nunca vacía lo que ya estaba.
        const parcial = prep.provistos
          ? Object.fromEntries(Object.entries(prep.datos).filter(([k]) => prep.provistos!.includes(k)))
          : prep.datos
        await adaptador.actualizar(existente, parcial, ctx)
        await registrarItem(ctx, loteId, adaptador.entidad, fila, 'ACTUALIZADA', existente, null)
        r.actualizadas++
      } else if (dim && presupuesto !== null && presupuesto <= 0) {
        await registrarItem(
          ctx, loteId, adaptador.entidad, fila, 'SALTADA', null,
          mensajeLimiteCrear(dim, tope ?? 0, cupo?.nivelNombre ?? ''),
        )
        r.saltadas++
      } else {
        const id = await adaptador.insertar(prep.datos, ctx)
        await registrarItem(ctx, loteId, adaptador.entidad, fila, 'INSERTADA', id, null)
        if (presupuesto !== null) presupuesto--
        r.insertadas++
      }
    } catch (e) {
      await registrarItem(ctx, loteId, adaptador.entidad, fila, 'ERROR', null, (e as Error).message)
      r.errores++
    }
  }
  return { ...r, claves: [...vistos], siguiente: i < filas.length ? i : null }
}
