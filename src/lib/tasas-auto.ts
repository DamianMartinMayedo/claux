// Actualización de tasas desde las fuentes automáticas (El Toque, Frankfurter).
//
// El NÚCLEO vive aquí, por cliente, para que lo compartan dos disparadores:
//  · la acción del portal (botón «Actualizar» de Monedas y del dashboard), que
//    lo corre para el cliente en sesión;
//  · el cron diario (/api/cron/tasas), que lo corre para TODOS los clientes.
// Sin esta extracción, el cron sería una copia de 100 líneas de la server action
// que se desincronizaría a la primera corrección en una de las dos.
//
// No toca sesión ni revalida: eso es responsabilidad de quien lo llama.

// «Hoy» en la zona del NEGOCIO (America/Havana), no en UTC: con `toISOString()` a partir de
// las 20:00 la fecha ya es la de mañana, así que un documento fechado de noche el último día
// del mes caía en el mes siguiente. Una sola fuente: `lib/fecha-tz.ts`.
import { hoyEnTz } from '@/lib/fecha-tz'

import type { createAdminClient } from '@/lib/supabase/admin'

type Db = ReturnType<typeof createAdminClient>

// El Toque usa código propio para el Euro.
const EL_TOQUE_MAPA: Record<string, string> = { EUR: 'ECU' }
const codElToque = (cod: string): string => EL_TOQUE_MAPA[cod] ?? cod

/** Un par que de verdad cambió de valor, para poder CONTARLO en un aviso. */
export interface CambioTasa {
  origen:  string
  destino: string
  tasa:    number
}

export interface ResultadoTasas {
  actualizadas: number
  /** Pares consultados cuya tasa venía IGUAL a la última guardada. */
  sinCambios:   number
  errores:      string[]
  /**
   * Los pares que cambiaron (los mismos que cuenta `actualizadas`). El cron los
   * necesita para decirle al dueño QUÉ cambió; el botón del portal no los usa.
   */
  cambios:      CambioTasa[]
}

interface Previa { tasa: number; fecha: string | null }

interface Fila {
  client_id:      string
  moneda_origen:  string
  moneda_destino: string
  tasa:           number
  fuente:         string
  fecha:          string
}

/** Fila lista para guardar + si su tasa es un cambio real (lo que se cuenta). */
interface Pendiente { fila: Fila; cambio: boolean }

/**
 * Última tasa guardada por par (`origen__destino`), con su fecha. Sirve para dos
 * cosas: contar como «actualizada» solo lo que de verdad CAMBIÓ de valor, y no
 * reescribir la misma tasa dos veces el mismo día (El Toque publica una vez al
 * día y el botón se pulsa muchas más).
 */
async function ultimasTasas(db: Db, clientId: string): Promise<Map<string, Previa>> {
  const { data } = await db
    .from('tasas_cambio')
    .select('moneda_origen, moneda_destino, tasa, fecha')
    .eq('client_id', clientId)
    .order('fecha',      { ascending: false })
    .order('created_at', { ascending: false })

  const mapa = new Map<string, Previa>()
  for (const t of data ?? []) {
    const k = `${t.moneda_origen}__${t.moneda_destino}`
    // La primera de cada par es la más reciente (viene ordenado desc).
    if (!mapa.has(k)) mapa.set(k, { tasa: Number(t.tasa), fecha: t.fecha ?? null })
  }
  return mapa
}

/**
 * El error va a un toast que lee el dueño del negocio, no a un log: sin códigos
 * HTTP sueltos. El caso frecuente es el 429 de El Toque (limita las consultas),
 * y ahí lo único útil es «vuelve a intentarlo en un rato».
 */
function errorFuente(fuente: string, status: number): string {
  if (status === 429) return `${fuente} limita las consultas: inténtalo de nuevo en unos minutos.`
  if (status === 401 || status === 403) return `${fuente} rechazó el acceso: revisa la clave de la fuente.`
  return `${fuente} no responde ahora mismo (error ${status}).`
}

// Igualdad con margen relativo: la tasa va y vuelve de `numeric`, y los pares
// invertidos (1/tasa) arrastran error de coma flotante.
const mismaTasa = (a: number, b: number): boolean => Math.abs(a - b) <= Math.abs(b) * 1e-9

/**
 * Qué hacer con la tasa que acaba de traer la fuente, comparada con la última
 * guardada. Tres casos, y el mensaje al dueño depende de distinguirlos:
 *  · 'cambio'   → valor distinto: se guarda y CUENTA como actualizada.
 *  · 'confirma' → mismo valor pero la última fila es de otro día: se guarda para
 *                 que la fecha diga la verdad («la fuente lo confirmó hoy») y el
 *                 widget no la marque vieja, pero NO cuenta como actualizada.
 *  · 'nada'     → mismo valor y ya guardado hoy: no se escribe nada.
 */
function decidir(nueva: number, previa: Previa | undefined, hoy: string): 'cambio' | 'confirma' | 'nada' {
  if (!previa || !mismaTasa(nueva, previa.tasa)) return 'cambio'
  return previa.fecha === hoy ? 'nada' : 'confirma'
}

/**
 * Consulta las fuentes y guarda en `tasas_cambio` la tasa de cada par automático
 * del cliente. Los pares MANUAL no se tocan (los fija el dueño). Los errores se
 * acumulan y se devuelven: un par que falla no impide guardar el resto.
 */
export async function actualizarTasasCliente(db: Db, clientId: string): Promise<ResultadoTasas> {
  const { data: pares } = await db
    .from('pares_tasa')
    .select('par_id, origen, destino, fuente')
    .eq('client_id', clientId)
    .eq('activo', true)
    .neq('fuente', 'MANUAL')

  if (!pares?.length) return { actualizadas: 0, sinCambios: 0, errores: [], cambios: [] }

  const previas = await ultimasTasas(db, clientId)
  const hoy = hoyEnTz()
  const errores: string[] = []
  const cambios: CambioTasa[] = []
  let   actualizadas = 0
  let   sinCambios   = 0

  /** Guardado sin error: los que traían valor nuevo cuentan y se anotan. */
  const anotar = (pendientes: Pendiente[]): void => {
    for (const p of pendientes.filter(p => p.cambio)) {
      actualizadas++
      cambios.push({ origen: p.fila.moneda_origen, destino: p.fila.moneda_destino, tasa: p.fila.tasa })
    }
  }

  // ── El Toque: una sola llamada para todos los pares EL_TOQUE ──────────────
  const paresElToque = pares.filter(p => p.fuente === 'EL_TOQUE')
  if (paresElToque.length > 0) {
    const apiKey = process.env.ELTOQUE_API_KEY
    if (!apiKey) {
      errores.push('El Toque no está configurado: falta su clave de acceso (ELTOQUE_API_KEY).')
    } else {
      try {
        const res = await fetch('https://tasas.eltoque.com/v1/trmi', {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
          cache:   'no-store',
          // Corta el fetch a los 8 s: con la conexión de Cuba, sin límite se cuelga y el
          // cron/la actualización manual no termina nunca.
          signal:  AbortSignal.timeout(8000),
        })
        if (!res.ok) {
          errores.push(errorFuente('El Toque', res.status))
        } else {
          const json = await res.json() as { tasas?: Record<string, number> }
          if (!json.tasas) {
            errores.push('El Toque devolvió una respuesta que no se entiende.')
          } else {
            const pendientes: Pendiente[] = []
            for (const par of paresElToque) {
              const esCupOrigen = par.origen === 'CUP'
              const monedaExt   = esCupOrigen ? par.destino : par.origen
              const elToqueCod  = codElToque(monedaExt)
              const tasaExt     = json.tasas[elToqueCod]
              if (!tasaExt) {
                errores.push(`El Toque no publica tasa para ${monedaExt}.`)
                continue
              }
              const tasa = esCupOrigen ? 1 / tasaExt : tasaExt
              const acc  = decidir(tasa, previas.get(`${par.origen}__${par.destino}`), hoy)
              if (acc !== 'cambio') sinCambios++
              if (acc === 'nada') continue
              pendientes.push({
                cambio: acc === 'cambio',
                fila: {
                  client_id:      clientId,
                  moneda_origen:  par.origen,
                  moneda_destino: par.destino,
                  tasa,
                  fuente:         'EL_TOQUE',
                  fecha:          hoy,
                },
              })
            }
            if (pendientes.length > 0) {
              const { error } = await db.from('tasas_cambio').insert(pendientes.map(p => p.fila))
              if (error) errores.push(`No se pudieron guardar las tasas de El Toque: ${error.message}`)
              else anotar(pendientes)
            }
          }
        }
      } catch {
        // Caída de red: el mensaje del fetch («fetch failed») no dice nada al dueño.
        errores.push('No se pudo conectar con El Toque. Revisa la conexión.')
      }
    }
  }

  // ── Frankfurter: agrupado por moneda base para minimizar llamadas ─────────
  const paresFrank = pares.filter(p => p.fuente === 'FRANKFURTER')
  if (paresFrank.length > 0) {
    const byOrigen = new Map<string, typeof paresFrank>()
    for (const p of paresFrank) {
      if (!byOrigen.has(p.origen)) byOrigen.set(p.origen, [])
      byOrigen.get(p.origen)!.push(p)
    }
    for (const [base, grupo] of byOrigen) {
      const symbols = grupo.map(p => p.destino).join(',')
      try {
        const url = `https://api.frankfurter.app/latest?base=${base}&symbols=${symbols}`
        const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
        if (!res.ok) { errores.push(errorFuente('Frankfurter', res.status)); continue }
        const json = await res.json() as { rates?: Record<string, number> }
        if (!json.rates) { errores.push('Frankfurter devolvió una respuesta que no se entiende.'); continue }
        const pendientes: Pendiente[] = []
        for (const [cod, valor] of Object.entries(json.rates)) {
          const acc = decidir(valor, previas.get(`${base}__${cod}`), hoy)
          if (acc !== 'cambio') sinCambios++
          if (acc === 'nada') continue
          pendientes.push({
            cambio: acc === 'cambio',
            fila: {
              client_id:      clientId,
              moneda_origen:  base,
              moneda_destino: cod,
              tasa:           valor,
              fuente:         'FRANKFURTER',
              fecha:          hoy,
            },
          })
        }
        if (pendientes.length === 0) continue
        const { error } = await db.from('tasas_cambio').insert(pendientes.map(p => p.fila))
        if (error) errores.push(`No se pudieron guardar las tasas de Frankfurter: ${error.message}`)
        else anotar(pendientes)
      } catch {
        // Caída de red: el mensaje del fetch («fetch failed») no dice nada al dueño.
        errores.push('No se pudo conectar con Frankfurter. Revisa la conexión.')
      }
    }
  }

  return { actualizadas, sinCambios, errores, cambios }
}
