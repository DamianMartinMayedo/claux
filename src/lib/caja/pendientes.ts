import { diasDeCalendario } from '@/lib/fecha-tz'

// ── Las operaciones de gaveta que el dueño todavía no ha clasificado ─────────
//
// Un solo lector, y no una consulta por pantalla, porque el aviso NO vive en un
// sitio: sale en Tesorería (que es donde está la bandeja), en Gastos, en el estado
// de resultados y —de otra forma— en el dossier antes de publicar. Con una copia
// por consumidor, el día que cambie el criterio de «pendiente» unos avisarían y
// otros no, que es peor que no avisar.
//
// Vive fuera de `'use server'` a propósito: lo llaman cuatro acciones distintas y
// un fichero de acciones solo puede exportar funciones async (el build de Vercel lo
// caza, `tsc` no).
//
// ── Qué cuenta como PENDIENTE ────────────────────────────────────────────────
//
//   · `clasificacion is null` — el dueño no lo ha mirado. `SOLO_MUEVE` sale de la
//     bandeja aunque no genere ninguna fila: es una respuesta, no una omisión.
//   · Y **su EGRESO ya está posteado en Tesorería**. Sin cuenta mapeada para esa
//     moneda la ingesta no postea y lo reintenta al resincronizar (mismo criterio
//     que las ventas del cierre). Ofrecer ese movimiento aquí crearía un gasto que
//     nace pagado contra un pago que Tesorería no tiene — la incoherencia que esta
//     fase existe para evitar. Cuando la ingesta lo postee, aparecerá solo.

/** Una operación de gaveta esperando a que el dueño diga qué fue. */
export interface GavetaPendiente {
  movimiento_uuid: string
  sesion_uuid:     string
  caja_id:         string
  caja_nombre:     string
  empresa_id:      string
  /** SALIDA = salió dinero del cajón · ENTRADA = entró. */
  tipo:            'SALIDA' | 'ENTRADA'
  moneda:          string
  importe:         number
  /** Lo que escribió quien atendió. Es la PRUEBA con la que el dueño clasifica. */
  motivo:          string | null
  /** Del movimiento, no del cierre: se sacó cuando se sacó. */
  fecha:           string
}

/** El resumen que va en los avisos: cuántas y cuánto, por moneda. */
export interface ResumenGaveta {
  n:       number
  /** Solo las SALIDAS: es el dinero que falta por aparecer como gasto. */
  porMoneda: Record<string, number>
  /** La más antigua sin clasificar. Un aviso sin antigüedad no mueve a nadie. */
  desde:   string | null
  /**
   * Días que lleva esperando la más antigua, **calculados en el servidor**.
   *
   * Aquí y no en el componente del aviso: `diasDeCalendario` mira el reloj, y un
   * reloj leído en cliente da un número en el SSR y otro en el navegador (el
   * mismatch de hidratación del §8 del design system). Es un número, no una hora,
   * pero se rompe igual.
   */
  dias:    number
}

export const RESUMEN_GAVETA_VACIO: ResumenGaveta = { n: 0, porMoneda: {}, desde: null, dias: 0 }

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Las operaciones pendientes, con su detalle. Para la bandeja.
 *
 * `empresaIds` acota a las empresas que el usuario ve; omitirlo las trae todas. La
 * empresa **no** está en el movimiento sino en su caja, así que se resuelve por ahí
 * y no por una columna que no existe.
 */
export async function listarGavetaPendiente(
  db: any, client_id: string, empresaIds?: string[],
): Promise<GavetaPendiente[]> {
  const { data: cajas } = await db.from('cajas')
    .select('caja_id, nombre, empresa_id').eq('client_id', client_id)
  const porCaja = new Map<string, { nombre: string; empresa_id: string }>()
  for (const c of ((cajas ?? []) as { caja_id: string; nombre: string | null; empresa_id: string }[])) {
    if (empresaIds && !empresaIds.includes(c.empresa_id)) continue
    porCaja.set(c.caja_id, { nombre: c.nombre || 'Caja', empresa_id: c.empresa_id })
  }
  if (porCaja.size === 0) return []

  const { data: movs } = await db.from('caja_turno_movimientos')
    .select('movimiento_uuid, sesion_uuid, caja_id, tipo, moneda, importe, motivo, fecha')
    .eq('client_id', client_id)
    .is('clasificacion', null)
    .in('caja_id', [...porCaja.keys()])
    .order('fecha', { ascending: true })
  const lista = (movs ?? []) as {
    movimiento_uuid: string; sesion_uuid: string; caja_id: string
    tipo: string; moneda: string; importe: number; motivo: string | null; fecha: string
  }[]
  if (lista.length === 0) return []

  // Solo los que Tesorería ya tiene. Ver la cabecera: el resto vuelve por su cuenta
  // cuando la ingesta los postee.
  const { data: posteados } = await db.from('movimientos_tesoreria')
    .select('referencia_id')
    .eq('client_id', client_id).eq('origen', 'CAJA')
    .in('referencia_id', lista.map(m => m.movimiento_uuid))
  const enTesoreria = new Set(
    ((posteados ?? []) as { referencia_id: string }[]).map(r => r.referencia_id))

  return lista
    .filter(m => enTesoreria.has(m.movimiento_uuid))
    .map(m => {
      const caja = porCaja.get(m.caja_id)!
      return {
        movimiento_uuid: m.movimiento_uuid,
        sesion_uuid:     m.sesion_uuid,
        caja_id:         m.caja_id,
        caja_nombre:     caja.nombre,
        empresa_id:      caja.empresa_id,
        tipo:            m.tipo === 'ENTRADA' ? 'ENTRADA' : 'SALIDA',
        moneda:          m.moneda,
        importe:         Number(m.importe) || 0,
        motivo:          m.motivo,
        fecha:           m.fecha,
      } satisfies GavetaPendiente
    })
}

/**
 * El resumen para los avisos.
 *
 * Se apoya en el listado en vez de en un `count`, y es deliberado: el criterio de
 * «pendiente» incluye estar posteado en Tesorería, que no se puede expresar en un
 * `head: true`. Con el índice parcial de la mig. 193 son dos consultas sobre filas
 * que se cuentan con los dedos —lo normal es cero—, y a cambio el número del aviso
 * y el de la bandeja no pueden discrepar nunca.
 */
export async function resumenGavetaPendiente(
  db: any, client_id: string, empresaIds?: string[],
): Promise<ResumenGaveta> {
  return resumenDeLista(await listarGavetaPendiente(db, client_id, empresaIds))
}

/** El resumen a partir de una lista ya traída. Quien tiene las dos cosas no consulta dos veces. */
export function resumenDeLista(pend: GavetaPendiente[]): ResumenGaveta {
  if (pend.length === 0) return RESUMEN_GAVETA_VACIO

  const porMoneda: Record<string, number> = {}
  for (const p of pend) {
    if (p.tipo !== 'SALIDA') continue
    porMoneda[p.moneda] = (porMoneda[p.moneda] ?? 0) + p.importe
  }
  return {
    n: pend.length, porMoneda,
    desde: pend[0].fecha,
    dias:  diasDeCalendario(pend[0].fecha),
  }
}

/** «3 salidas de caja sin clasificar (1.500,00 CUP)» — el texto del aviso, en un sitio. */
export function textoAvisoGaveta(r: ResumenGaveta): string {
  const monedas = Object.entries(r.porMoneda)
    .map(([m, v]) => `${v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${m}`)
    .join(' · ')
  const cuantas = r.n === 1 ? '1 operación de caja' : `${r.n} operaciones de caja`
  return monedas ? `${cuantas} sin clasificar (${monedas})` : `${cuantas} sin clasificar`
}
