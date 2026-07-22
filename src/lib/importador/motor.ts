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
  Adaptador, CtxImport, MapeoImport, FilaResultado, ResumenAplicacion,
  TrozoValidacion, TrozoAplicacion,
} from './tipos'

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

/** Dry-run: valida cada fila SIN escribir. Marca duplicados dentro del archivo. */
export async function validarLoteFilas(
  filas: Record<string, string>[], mapeo: MapeoImport, adaptador: Adaptador, ctx: CtxImport,
  desde = 0, clavesPrevias: string[] = [],
): Promise<TrozoValidacion> {
  const t0 = Date.now()
  const vistos = new Set(clavesPrevias)
  const res: FilaResultado[] = []
  const buenas: Record<string, unknown>[] = []
  let i = desde
  for (; i < filas.length && !seAcabaElTiempo(t0, i - desde); i++) {
    const { valores, deColumna } = construirValores(filas[i], mapeo)
    if (esFilaEjemplo(valores, deColumna, adaptador)) {
      res.push({ fila: i + 1, ok: false, motivo: MOTIVO_EJEMPLO }); continue
    }
    const prep = await adaptador.preparar(valores, ctx, deColumna)
    if (!prep.ok) { res.push({ fila: i + 1, ok: false, motivo: prep.motivo }); continue }
    if (vistos.has(prep.clave)) { res.push({ fila: i + 1, ok: false, motivo: 'Fila duplicada dentro del archivo.' }); continue }
    vistos.add(prep.clave)
    const existente = await adaptador.buscarExistente(prep.datos, ctx)
    const accion = !existente ? 'INSERTAR'
      : mapeo.politica === 'ACTUALIZAR' ? 'ACTUALIZAR'
      : mapeo.politica === 'CREAR' ? 'INSERTAR' : 'SALTAR'
    if (accion !== 'SALTAR') buenas.push(prep.datos)
    res.push({ fila: i + 1, ok: true, accion })
  }
  const ok = res.filter(f => f.ok).length
  return {
    total: filas.length, ok, errores: res.length - ok, filas: res,
    resumen:   adaptador.resumen?.(buenas),
    claves:    [...vistos],
    siguiente: i < filas.length ? i : null,
  }
}

export interface ResumenDeshacer {
  deshechas: number
  intactas:  number
  motivos:   { fila: number; motivo: string }[]
}

/**
 * Deshace un lote APLICADO: recorre lo que insertó y se lo pide al adaptador.
 * Lo que sí se deshace pierde su traza en `import_lote_items` —para poder volver
 * a aplicar el lote corregido—; lo que no se pudo deshacer la conserva, con su
 * motivo a la vista. Las filas ACTUALIZADAS no se tocan: no sabemos qué había
 * antes, y adivinarlo sería peor que dejarlo.
 */
export async function deshacerLoteFilas(
  loteId: string, adaptador: Adaptador, ctx: CtxImport,
): Promise<ResumenDeshacer> {
  ctx.lote_id = loteId
  const r: ResumenDeshacer = { deshechas: 0, intactas: 0, motivos: [] }
  if (!adaptador.deshacer) {
    return { deshechas: 0, intactas: 0, motivos: [{ fila: 0, motivo: 'Esta entidad no se puede deshacer automáticamente.' }] }
  }
  const { data } = await ctx.db.from('import_lote_items')
    .select('item_id, fila_origen, pk_destino')
    .eq('lote_id', loteId).eq('accion', 'INSERTADA').order('fila_origen')

  for (const it of (data ?? []) as { item_id: number; fila_origen: number; pk_destino: string | null }[]) {
    if (!it.pk_destino) continue
    let motivo: string | null
    try {
      motivo = await adaptador.deshacer(it.pk_destino, ctx)
    } catch (e) {
      motivo = (e as Error).message
    }
    if (motivo) {
      r.intactas++
      r.motivos.push({ fila: it.fila_origen, motivo })
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
  desde = 0, clavesPrevias: string[] = [],
): Promise<TrozoAplicacion> {
  ctx.lote_id = loteId   // los adaptadores de ledger lo dejan como referencia del movimiento
  const t0 = Date.now()
  const { data: prev } = await ctx.db.from('import_lote_items').select('fila_origen').eq('lote_id', loteId)
  const hechas = new Set((prev ?? []).map((r: { fila_origen: number }) => r.fila_origen))
  const vistos = new Set(clavesPrevias)
  const r: ResumenAplicacion = { insertadas: 0, actualizadas: 0, saltadas: 0, errores: 0 }

  let i = desde
  for (; i < filas.length && !seAcabaElTiempo(t0, i - desde); i++) {
    const fila = i + 1
    if (hechas.has(fila)) continue   // ya procesada en un intento anterior
    const { valores, deColumna } = construirValores(filas[i], mapeo)
    if (esFilaEjemplo(valores, deColumna, adaptador)) {
      await registrarItem(ctx, loteId, adaptador.entidad, fila, 'ERROR', null, MOTIVO_EJEMPLO); r.errores++; continue
    }
    const prep = await adaptador.preparar(valores, ctx, deColumna)
    if (!prep.ok) { await registrarItem(ctx, loteId, adaptador.entidad, fila, 'ERROR', null, prep.motivo); r.errores++; continue }
    if (vistos.has(prep.clave)) { await registrarItem(ctx, loteId, adaptador.entidad, fila, 'SALTADA', null, 'Duplicada en el archivo'); r.saltadas++; continue }
    vistos.add(prep.clave)
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
      } else {
        const id = await adaptador.insertar(prep.datos, ctx)
        await registrarItem(ctx, loteId, adaptador.entidad, fila, 'INSERTADA', id, null)
        r.insertadas++
      }
    } catch (e) {
      await registrarItem(ctx, loteId, adaptador.entidad, fila, 'ERROR', null, (e as Error).message)
      r.errores++
    }
  }
  return { ...r, claves: [...vistos], siguiente: i < filas.length ? i : null }
}
