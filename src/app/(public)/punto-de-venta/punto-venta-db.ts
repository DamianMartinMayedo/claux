// IndexedDB de la caja offline (fuente de verdad local). Solo se usa en cliente.
// Las transacciones IDB se cierran al ceder el microtask, así que evitamos hacer
// `await` de otra cosa entre operaciones de una misma transacción: leemos primero
// (tx aparte) y escribimos en una tx sin awaits intermedios.

export interface CajaConfig {
  caja:    { caja_id: string; nombre?: string; empresa_id: string; almacen_id: string | null; monedas_aceptadas: string[]; tiene_base?: boolean }
  monedas: { codigo: string; simbolo: string }[]
  tasas:   { origen: string; destino: string; tasa: number }[]
}
export interface Producto {
  producto_id: string; codigo: string; nombre: string; precios: Record<string, number>; unidad?: string
  /** PRODUCTO | SERVICIO. Sin él (semilla vieja) se asume físico, que es lo que bajaba antes. */
  tipo?: string
  /** Se factura por suscripción (mig. 120). La semilla lo manda desde el primer día y el
   *  dispositivo lo ignoraba: cobrarlo TAMBIÉN aquí mete la misma venta dos veces en el
   *  estado de resultados. No se esconde —cobrar un extra en el mostrador es legítimo—,
   *  se avisa en su ficha. */
  es_suscribible?: boolean
}
export interface LocalLinea {
  producto_id: string | null; descripcion: string; cantidad: number; precio_unitario: number; subtotal: number
}
export interface LocalTicket {
  ticket_uuid: string; sesion_uuid: string | null; fecha: string; moneda: string; total: number
  medio_pago: string | null; lineas: LocalLinea[]; synced: boolean
  // Rectificación: el original queda 'ANULADO' y se crea uno 'RECTIFICACION' que
  // apunta al original en rectifica_a. Tickets antiguos sin campo → 'VIGENTE'.
  estado?: 'VIGENTE' | 'ANULADO' | 'RECTIFICACION'; rectifica_a?: string | null
}
export interface LocalSesion {
  sesion_uuid: string; abierta_at: string; cerrada_at: string | null; estado: 'ABIERTA' | 'CERRADA'
  fondo_inicial: Record<string, number>; efectivo_contado: Record<string, number>; synced: boolean
  /** Quién contó el dinero al cerrar. Texto libre: quien cuenta rara vez es quien teclea. */
  cerrada_por?: string | null
}
/** Salida o entrada de efectivo DURANTE el turno (pagar al proveedor, retirar, meter cambio).
 *  Es la otra mitad de por qué una caja no cuadra, y hasta ahora no existía. */
export interface LocalMovimiento {
  movimiento_uuid: string; sesion_uuid: string; tipo: 'SALIDA' | 'ENTRADA'
  moneda: string; importe: number; motivo: string; fecha: string; synced: boolean
}

const DB_NAME = 'claux-caja'
// v2: `movimientos` (salidas de efectivo del turno) y `carrito` (el ticket a medias, para
// que un apagón o una recarga del service worker no se lleven una comanda empezada).
// `onupgradeneeded` solo AÑADE stores: los datos de las que ya existen no se tocan, y en un
// dispositivo en marcha ahí puede haber ventas sin sincronizar.
const DB_VERSION = 2

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('meta'))         db.createObjectStore('meta', { keyPath: 'k' })
      if (!db.objectStoreNames.contains('productos'))    db.createObjectStore('productos', { keyPath: 'producto_id' })
      if (!db.objectStoreNames.contains('tickets'))      db.createObjectStore('tickets', { keyPath: 'ticket_uuid' })
      if (!db.objectStoreNames.contains('sesiones'))     db.createObjectStore('sesiones', { keyPath: 'sesion_uuid' })
      if (!db.objectStoreNames.contains('movimientos'))  db.createObjectStore('movimientos', { keyPath: 'movimiento_uuid' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
}
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res()
    tx.onerror    = () => rej(tx.error)
    tx.onabort    = () => rej(tx.error)
  })
}

// ── meta (token, config, banderas) ──
export async function metaGet<T = unknown>(k: string): Promise<T | undefined> {
  const db = await openDB()
  const rec = await reqP(db.transaction('meta').objectStore('meta').get(k)) as { k: string; v: T } | undefined
  return rec ? rec.v : undefined
}
export async function metaSet(k: string, v: unknown): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('meta', 'readwrite')
  tx.objectStore('meta').put({ k, v })
  await txDone(tx)
}

// ── productos ──
export async function saveProductos(list: Producto[]): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('productos', 'readwrite')
  const s = tx.objectStore('productos')
  s.clear()
  for (const p of list) s.put(p)
  await txDone(tx)
}
export async function getProductos(): Promise<Producto[]> {
  const db = await openDB()
  return await reqP(db.transaction('productos').objectStore('productos').getAll()) as Producto[]
}

// ── tickets y sesiones ──
//
// **Invariante: escribir aquí SIEMPRE deja `synced: false`.** No es una comodidad, es lo
// que hace que un cambio no se quede dentro del móvil: la sincronización manda «lo que no
// está marcado», así que mutar una fila sin bajar el flag es perderla en silencio. Por eso
// el flag lo fuerza esta función y no cada llamador —olvidarlo era cuestión de tiempo—, y
// el ÚNICO sitio que lo pone a `true` es `markTicketsSynced`/`markSesionesSynced`, que
// escriben directamente en el store después de que el servidor confirme.
//
// De ahí cuelga que la sesión ABIERTA pueda viajar y marcarse: cerrarla es una escritura,
// así que vuelve a salir sin marcar y su cierre sube igual. Sin esta regla habría que
// reenviar la sesión abierta en cada sincronización, y en Cuba los datos se pagan.
export async function putTicket(t: LocalTicket): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('tickets', 'readwrite')
  tx.objectStore('tickets').put({ ...t, synced: false })
  await txDone(tx)
}
export async function getTickets(): Promise<LocalTicket[]> {
  const db = await openDB()
  return await reqP(db.transaction('tickets').objectStore('tickets').getAll()) as LocalTicket[]
}

export async function putSesion(s: LocalSesion): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('sesiones', 'readwrite')
  tx.objectStore('sesiones').put({ ...s, synced: false })
  await txDone(tx)
}
export async function getSesiones(): Promise<LocalSesion[]> {
  const db = await openDB()
  return await reqP(db.transaction('sesiones').objectStore('sesiones').getAll()) as LocalSesion[]
}

// ── movimientos de efectivo del turno ──
export async function putMovimiento(m: LocalMovimiento): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('movimientos', 'readwrite')
  tx.objectStore('movimientos').put({ ...m, synced: false })
  await txDone(tx)
}
export async function getMovimientos(): Promise<LocalMovimiento[]> {
  const db = await openDB()
  return await reqP(db.transaction('movimientos').objectStore('movimientos').getAll()) as LocalMovimiento[]
}
export async function markMovimientosSynced(uuids: string[]): Promise<void> {
  if (!uuids.length) return
  const all = await getMovimientos()
  const set = new Set(uuids)
  const db  = await openDB()
  const tx  = db.transaction('movimientos', 'readwrite')
  const s   = tx.objectStore('movimientos')
  for (const m of all) if (set.has(m.movimiento_uuid) && !m.synced) { m.synced = true; s.put(m) }
  await txDone(tx)
}

// ── marcar sincronizado (lee primero, escribe sin awaits intermedios) ──
export async function markTicketsSynced(uuids: string[]): Promise<void> {
  if (!uuids.length) return
  const all = await getTickets()
  const set = new Set(uuids)
  const db  = await openDB()
  const tx  = db.transaction('tickets', 'readwrite')
  const s   = tx.objectStore('tickets')
  for (const t of all) if (set.has(t.ticket_uuid) && !t.synced) { t.synced = true; s.put(t) }
  await txDone(tx)
}
export async function markSesionesSynced(uuids: string[]): Promise<void> {
  if (!uuids.length) return
  const all = await getSesiones()
  const set = new Set(uuids)
  const db  = await openDB()
  const tx  = db.transaction('sesiones', 'readwrite')
  const s   = tx.objectStore('sesiones')
  for (const x of all) if (set.has(x.sesion_uuid) && !x.synced) { x.synced = true; s.put(x) }
  await txDone(tx)
}
