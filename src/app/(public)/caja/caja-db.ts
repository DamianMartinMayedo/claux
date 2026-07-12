// IndexedDB de la caja offline (fuente de verdad local). Solo se usa en cliente.
// Las transacciones IDB se cierran al ceder el microtask, así que evitamos hacer
// `await` de otra cosa entre operaciones de una misma transacción: leemos primero
// (tx aparte) y escribimos en una tx sin awaits intermedios.

export interface CajaConfig {
  caja:    { caja_id: string; nombre?: string; empresa_id: string; almacen_id: string | null; monedas_aceptadas: string[] }
  monedas: { codigo: string; simbolo: string }[]
  tasas:   { origen: string; destino: string; tasa: number }[]
}
export interface Producto {
  producto_id: string; codigo: string; nombre: string; precios: Record<string, number>; unidad?: string
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
}

const DB_NAME = 'claux-caja'
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('meta'))      db.createObjectStore('meta', { keyPath: 'k' })
      if (!db.objectStoreNames.contains('productos')) db.createObjectStore('productos', { keyPath: 'producto_id' })
      if (!db.objectStoreNames.contains('tickets'))   db.createObjectStore('tickets', { keyPath: 'ticket_uuid' })
      if (!db.objectStoreNames.contains('sesiones'))  db.createObjectStore('sesiones', { keyPath: 'sesion_uuid' })
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

// ── tickets ──
export async function putTicket(t: LocalTicket): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('tickets', 'readwrite')
  tx.objectStore('tickets').put(t)
  await txDone(tx)
}
export async function getTickets(): Promise<LocalTicket[]> {
  const db = await openDB()
  return await reqP(db.transaction('tickets').objectStore('tickets').getAll()) as LocalTicket[]
}

// ── sesiones ──
export async function putSesion(s: LocalSesion): Promise<void> {
  const db = await openDB()
  const tx = db.transaction('sesiones', 'readwrite')
  tx.objectStore('sesiones').put(s)
  await txDone(tx)
}
export async function getSesiones(): Promise<LocalSesion[]> {
  const db = await openDB()
  return await reqP(db.transaction('sesiones').objectStore('sesiones').getAll()) as LocalSesion[]
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
