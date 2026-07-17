'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  type CajaConfig, type Producto, type LocalTicket, type LocalSesion, type LocalLinea,
  metaGet, metaSet, saveProductos, getProductos, putTicket, getTickets, putSesion, getSesiones,
  markTicketsSynced, markSesionesSynced,
} from './caja-db'

type Vista = 'vender' | 'ventas' | 'turno' | 'sync'
interface CartLine { key: string; producto_id: string | null; descripcion: string; cantidad: number; precio_unitario: number }
type InstallPromptEvent = Event & { prompt: () => Promise<void> }

// Moneda inicial de venta: preferimos CUP (la de curso legal); solo si la caja no
// la acepta caemos a la primera aceptada/disponible.
function monedaPorDefecto(cfg: CajaConfig | null): string {
  const aceptadas   = cfg?.caja.monedas_aceptadas ?? []
  const disponibles = aceptadas.length ? aceptadas : (cfg?.monedas?.map(m => m.codigo) ?? [])
  return disponibles.includes('CUP') ? 'CUP' : (disponibles[0] ?? 'CUP')
}
const uid    = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const money  = (n: number) => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function fetchSeed(token: string): Promise<{ config: CajaConfig; productos: Producto[] }> {
  const res = await fetch('/caja/api/seed', { headers: { 'x-caja-token': token }, cache: 'no-store' })
  const j = await res.json()
  if (!res.ok || !j.ok) throw new Error(j?.error || 'seed')
  return { config: { caja: j.seed.caja, monedas: j.seed.monedas, tasas: j.seed.tasas }, productos: j.seed.productos ?? [] }
}
const stripTicket = (t: LocalTicket) => ({ ticket_uuid: t.ticket_uuid, sesion_uuid: t.sesion_uuid, fecha: t.fecha, moneda: t.moneda, total: t.total, medio_pago: t.medio_pago, estado: t.estado ?? 'VIGENTE', rectifica_a: t.rectifica_a ?? null, lineas: t.lineas })
const stripSesion = (s: LocalSesion) => ({ sesion_uuid: s.sesion_uuid, abierta_at: s.abierta_at, cerrada_at: s.cerrada_at, estado: s.estado, fondo_inicial: s.fondo_inicial, efectivo_contado: s.efectivo_contado })

export default function CajaApp() {
  const [ready, setReady]     = useState(false)
  const [token, setToken]     = useState<string | null>(null)
  const [config, setConfig]   = useState<CajaConfig | null>(null)
  const [productos, setProds] = useState<Producto[]>([])
  const [online, setOnline]   = useState(true)
  const [installEvt, setInstallEvt] = useState<InstallPromptEvent | null>(null)
  const [standalone, setStandalone] = useState(false)
  const [installDismissed, setDismissed] = useState(false)

  const [tickets, setTickets]   = useState<LocalTicket[]>([])
  const [sesiones, setSesiones] = useState<LocalSesion[]>([])

  const [vista, setVista]     = useState<Vista>('vender')
  const [moneda, setMoneda]   = useState('')
  const [cart, setCart]       = useState<CartLine[]>([])
  const [rectiUuid, setRectiUuid] = useState<string | null>(null)  // ticket original que se está rectificando
  const [medioPago, setMedio] = useState('Efectivo')
  const [search, setSearch]   = useState('')
  const [libreOpen, setLibre] = useState(false)
  const [libreNom, setLibreNom] = useState('')
  const [librePre, setLibrePre] = useState('')
  const [contado, setContado] = useState<Record<string, string>>({})
  const [msg, setMsg]         = useState<{ t: 'ok' | 'err' | 'warn'; x: string } | null>(null)
  const [busy, setBusy]       = useState(false)

  const monedas = config?.caja.monedas_aceptadas?.length ? config.caja.monedas_aceptadas : (config?.monedas?.map(m => m.codigo) ?? [])
  const simbolo = (m: string) => config?.monedas.find(x => x.codigo === m)?.simbolo ?? m
  const precioDe = (p: Producto) => Number(p.precios?.[moneda] ?? 0)
  // El producto no tiene precio guardado en la moneda actual (no inventamos conversión).
  const sinPrecioProd = (p: Producto) => p.precios?.[moneda] == null
  const lineaSinPrecio = (l: CartLine) => l.producto_id != null && productos.find(p => p.producto_id === l.producto_id)?.precios?.[moneda] == null
  const cartInvalido = cart.some(lineaSinPrecio)
  const cartTotal = round2(cart.reduce((s, l) => s + l.cantidad * l.precio_unitario, 0))

  const sesion = useMemo(() => sesiones.find(s => s.estado === 'ABIERTA') ?? null, [sesiones])
  const pend = useMemo(() => ({
    tickets: tickets.filter(t => !t.synced).length,
    cierres: sesiones.filter(s => s.estado === 'CERRADA' && !s.synced).length,
  }), [tickets, sesiones])
  const ventasTurno = useMemo(() => {
    const m = new Map<string, { count: number; total: number }>()
    if (!sesion) return m
    for (const t of tickets) if (t.sesion_uuid === sesion.sesion_uuid) {
      const e = m.get(t.moneda) ?? { count: 0, total: 0 }
      e.count += 1; e.total += Number(t.total); m.set(t.moneda, e)
    }
    return m
  }, [tickets, sesion])
  const ventasTurnoN = useMemo(() => [...ventasTurno.values()].reduce((s, v) => s + v.count, 0), [ventasTurno])

  const reload = useCallback(async () => {
    const [tks, sess] = await Promise.all([getTickets(), getSesiones()])
    setTickets(tks); setSesiones(sess)
  }, [])

  // ── Arranque ──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let tk: string | null = null
      const m = window.location.hash.match(/[#&]t=([^&]+)/)
      if (m) { tk = decodeURIComponent(m[1]); await metaSet('token', tk); history.replaceState(null, '', window.location.pathname) }
      tk = tk ?? (await metaGet<string>('token')) ?? null
      let cfg = (await metaGet<CajaConfig>('config')) ?? null
      const teniaCache = !!cfg
      let prods = await getProductos()
      if (tk && !cfg && navigator.onLine) {
        try { const s = await fetchSeed(tk); cfg = s.config; prods = s.productos; await metaSet('config', cfg); await saveProductos(prods) } catch { /* offline */ }
      }
      if (cancelled) return
      setToken(tk); setConfig(cfg); setProds(prods)
      setMoneda(monedaPorDefecto(cfg))
      setOnline(navigator.onLine)
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
      setStandalone(isStandalone)
      setDismissed((await metaGet<boolean>('install_dismissed')) === true)
      await reload()
      setReady(true)
      // Refresco en segundo plano (ya mostramos la caja con lo cacheado): con conexión
      // re-baja productos/precios/monedas para quedar al día — quita los archivados y
      // trae cambios del portal sin que el vendedor pulse nada.
      if (tk && teniaCache && navigator.onLine) {
        try {
          const s = await fetchSeed(tk)
          if (cancelled) return
          await metaSet('config', s.config); await saveProductos(s.productos)
          setConfig(s.config); setProds(s.productos)
        } catch { /* seguimos con lo cacheado */ }
      }
    })()
    const on = () => setOnline(true), off = () => setOnline(false)
    const bip = (e: Event) => { e.preventDefault(); setInstallEvt(e as InstallPromptEvent) }
    const installed = () => { setStandalone(true); setInstallEvt(null) }
    window.addEventListener('online', on); window.addEventListener('offline', off); window.addEventListener('beforeinstallprompt', bip); window.addEventListener('appinstalled', installed)
    return () => { cancelled = true; window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('beforeinstallprompt', bip); window.removeEventListener('appinstalled', installed) }
  }, [reload])

  // ── Turno ──
  async function abrirTurno() {
    if (busy) return
    setBusy(true)
    try {
      const ses: LocalSesion = { sesion_uuid: uid(), abierta_at: new Date().toISOString(), cerrada_at: null, estado: 'ABIERTA', fondo_inicial: {}, efectivo_contado: {}, synced: false }
      await putSesion(ses); await reload(); setVista('vender'); setMsg({ t: 'ok', x: 'Turno abierto. Ya puedes cobrar.' })
    } finally { setBusy(false) }
  }
  async function cerrarTurno() {
    if (!sesion || busy) return
    setBusy(true)
    try {
      const efectivo: Record<string, number> = {}
      for (const [k, v] of Object.entries(contado)) { const n = parseFloat(v); if (!isNaN(n)) efectivo[k] = n }
      await putSesion({ ...sesion, cerrada_at: new Date().toISOString(), estado: 'CERRADA', efectivo_contado: efectivo, synced: false })
      await reload(); setContado({}); setVista('sync')
      setMsg({ t: 'ok', x: 'Turno cerrado. Sincroniza para registrarlo en Claux.' })
    } finally { setBusy(false) }
  }

  // ── POS ──
  // Cambiar la moneda de la venta re-precia las líneas de catálogo desde el precio
  // GUARDADO del producto (precios[moneda]); nunca hay conversión matemática. Los
  // artículos libres conservan el precio tecleado (su moneda se elige al añadirlos).
  function cambiarMoneda(nueva: string) {
    setMoneda(nueva)
    setCart(prev => prev.map(l => {
      if (l.producto_id == null) return l
      const p = productos.find(x => x.producto_id === l.producto_id)
      return p ? { ...l, precio_unitario: Number(p.precios?.[nueva] ?? 0) } : l
    }))
  }
  function addProducto(p: Producto) {
    if (sinPrecioProd(p)) { setMsg({ t: 'warn', x: `${p.nombre} no tiene precio en ${moneda}.` }); return }
    setCart(prev => {
      const i = prev.findIndex(l => l.producto_id === p.producto_id)
      if (i >= 0) { const c = [...prev]; c[i] = { ...c[i], cantidad: c[i].cantidad + 1 }; return c }
      return [...prev, { key: uid(), producto_id: p.producto_id, descripcion: p.nombre, cantidad: 1, precio_unitario: precioDe(p) }]
    })
  }
  function addLibre() {
    const precio = parseFloat(librePre)
    if (!libreNom.trim() || isNaN(precio) || precio < 0) { setMsg({ t: 'err', x: 'Pon nombre y precio válidos.' }); return }
    setCart(prev => [...prev, { key: uid(), producto_id: null, descripcion: libreNom.trim(), cantidad: 1, precio_unitario: round2(precio) }])
    setLibreNom(''); setLibrePre(''); setLibre(false)
  }
  function changeQty(key: string, d: number) {
    setCart(prev => prev.flatMap(l => l.key !== key ? [l] : (l.cantidad + d <= 0 ? [] : [{ ...l, cantidad: l.cantidad + d }])))
  }
  function removeLine(key: string) { setCart(prev => prev.filter(l => l.key !== key)) }

  // Cargar una venta del turno en el carrito para corregirla (cantidad/precio/moneda).
  function rectificar(t: LocalTicket) {
    if (!sesion || t.sesion_uuid !== sesion.sesion_uuid) return
    setCart(t.lineas.map(l => ({ key: uid(), producto_id: l.producto_id, descripcion: l.descripcion, cantidad: l.cantidad, precio_unitario: l.precio_unitario })))
    setMoneda(t.moneda); setMedio(t.medio_pago ?? 'Efectivo'); setRectiUuid(t.ticket_uuid)
    setVista('vender'); setMsg({ t: 'warn', x: 'Rectificando la venta: ajústala y cobra de nuevo. La original quedará anulada.' })
  }
  function cancelarRecti() { setRectiUuid(null); setCart([]); setMsg(null) }

  async function cobrar() {
    if (!cart.length || busy || !sesion) return
    if (cartInvalido) { setMsg({ t: 'err', x: `Hay artículos sin precio en ${moneda}. Cambia la moneda o quítalos.` }); return }
    setBusy(true)
    try {
      const lineas: LocalLinea[] = cart.map(l => ({ producto_id: l.producto_id, descripcion: l.descripcion, cantidad: l.cantidad, precio_unitario: l.precio_unitario, subtotal: round2(l.cantidad * l.precio_unitario) }))
      const total = round2(lineas.reduce((s, l) => s + l.subtotal, 0))
      const esRecti = rectiUuid != null
      const t: LocalTicket = {
        ticket_uuid: uid(), sesion_uuid: sesion.sesion_uuid, fecha: new Date().toISOString(),
        moneda, total, medio_pago: medioPago, lineas, synced: false,
        estado: esRecti ? 'RECTIFICACION' : 'VIGENTE', rectifica_a: rectiUuid,
      }
      await putTicket(t)
      // Anular la original (se re-sincroniza para propagar el estado).
      if (esRecti) { const orig = tickets.find(x => x.ticket_uuid === rectiUuid); if (orig) await putTicket({ ...orig, estado: 'ANULADO', synced: false }) }
      await reload()
      setCart([]); setRectiUuid(null)
      setMsg({ t: 'ok', x: esRecti ? `Rectificado · nuevo total ${simbolo(moneda)} ${money(total)}` : `Cobrado ${simbolo(moneda)} ${money(total)}` })
    } catch { setMsg({ t: 'err', x: 'No se pudo registrar el cobro.' }) }
    finally { setBusy(false) }
  }

  // ── Sync / export / productos / instalar ──
  async function sincronizar() {
    if (!token) { setMsg({ t: 'err', x: 'Caja no configurada.' }); return }
    if (!navigator.onLine) { setMsg({ t: 'warn', x: 'Sin conexión. Exporta el archivo y súbelo luego en Claux.' }); return }
    if (busy) return
    setBusy(true)
    try {
      const tks  = tickets.filter(t => !t.synced)
      const sess = sesiones.filter(s => s.estado === 'CERRADA' && !s.synced)
      if (!tks.length && !sess.length) { setMsg({ t: 'ok', x: 'Todo sincronizado.' }); return }
      const res = await fetch('/caja/api/sync', { method: 'POST', headers: { 'content-type': 'application/json', 'x-caja-token': token }, body: JSON.stringify({ tickets: tks.map(stripTicket), cierres: sess.map(stripSesion) }) })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j?.error || 'sync')
      await markTicketsSynced(tks.map(t => t.ticket_uuid)); await markSesionesSynced(sess.map(s => s.sesion_uuid)); await reload()
      setMsg({ t: 'ok', x: `Sincronizado: ${j.resultado?.tickets_nuevos ?? tks.length} ventas, ${j.resultado?.cierres_posteados ?? sess.length} cierres.` })
    } catch { setMsg({ t: 'err', x: 'No se pudo sincronizar. Reintenta o exporta el archivo.' }) }
    finally { setBusy(false) }
  }
  function exportar() {
    const tks  = tickets.filter(t => !t.synced)
    const sess = sesiones.filter(s => s.estado === 'CERRADA' && !s.synced)
    if (!tks.length && !sess.length) { setMsg({ t: 'ok', x: 'No hay nada pendiente de exportar.' }); return }
    const payload = { caja: config?.caja.caja_id ?? null, exportado_at: new Date().toISOString(), tickets: tks.map(stripTicket), cierres: sess.map(stripSesion) }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `caja-${config?.caja.caja_id ?? 'export'}-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url)
    setMsg({ t: 'ok', x: 'Archivo exportado. Súbelo en Claux → Caja → Sincronizar.' })
  }
  async function actualizarProductos() {
    if (!token) return
    if (!navigator.onLine) { setMsg({ t: 'warn', x: 'Necesitas conexión para actualizar productos.' }); return }
    setBusy(true)
    try { const s = await fetchSeed(token); await metaSet('config', s.config); await saveProductos(s.productos); setConfig(s.config); setProds(s.productos); if (!monedas.includes(moneda)) setMoneda(monedaPorDefecto(s.config)); setMsg({ t: 'ok', x: `Caja actualizada: ${s.productos.length} productos y sus monedas.` }) }
    catch { setMsg({ t: 'err', x: 'No se pudo actualizar la caja.' }) }
    finally { setBusy(false) }
  }
  async function instalar() { if (!installEvt) return; await installEvt.prompt(); setInstallEvt(null); setDismissed(true) }
  async function continuarSinInstalar() { setDismissed(true); await metaSet('install_dismissed', true) }
  // Fuerza la última versión: quita el service worker y sus cachés y recarga. Las
  // ventas y la config (IndexedDB) NO se tocan. Solo online (si no, se perdería el offline).
  async function actualizarApp() {
    if (!navigator.onLine) { setMsg({ t: 'warn', x: 'Necesitas conexión para actualizar la app.' }); return }
    setBusy(true); setMsg({ t: 'warn', x: 'Actualizando la app…' })
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map(r => r.unregister()))
      }
      if (typeof caches !== 'undefined') { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))) }
    } catch { /* recargamos igualmente */ }
    window.location.reload()
  }

  // ── Render ──
  if (!ready) return <div className="ca-panel"><p className="ca-empty">Cargando caja…</p></div>

  if (!token && !config) {
    return (
      <div className="ca-gate">
        <div className="ca-gate-card">
          <div className="ca-gate-title">Caja sin configurar</div>
          <p className="ca-gate-text">Abre esta caja desde el enlace de instalación que te dio Claux (Portal → Caja → Configurar → «Instalar en un dispositivo»). Una vez abierta con conexión, funcionará sin internet.</p>
        </div>
      </div>
    )
  }

  const prodsFiltrados = productos.filter(p => { const q = search.toLowerCase().trim(); return !q || `${p.nombre} ${p.codigo}`.toLowerCase().includes(q) }).slice(0, 80)
  const totalPend = pend.tickets + pend.cierres
  const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
  const enApp = standalone || installDismissed

  // Ventas del día (recientes primero) y qué ticket ya tiene rectificación.
  const hoy = new Date().toISOString().slice(0, 10)
  const rectificados = new Set(tickets.filter(t => t.rectifica_a).map(t => t.rectifica_a))
  const ventasDia = tickets.filter(t => t.fecha.slice(0, 10) === hoy).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))

  const gate = (
    <div className="ca-gate">
      <div className="ca-gate-card">
        <div className="ca-gate-step">Paso 1</div>
        <div className="ca-gate-title">Abre el turno</div>
        <p className="ca-gate-text">Para empezar a cobrar necesitas abrir el turno. Al final del día lo cierras y sincronizas.</p>
        <div className="ca-steps">
          <div className="ca-step-row"><span className="ca-step-num">1</span> Abre el turno</div>
          <div className="ca-step-row"><span className="ca-step-num">2</span> Cobra las ventas (funciona sin internet)</div>
          <div className="ca-step-row"><span className="ca-step-num">3</span> Cierra el turno y sincroniza</div>
        </div>
        <button className="ca-btn ca-btn-primary ca-btn-lg ca-btn-block" disabled={busy} onClick={abrirTurno}>Abrir turno</button>
        {installEvt && <button className="ca-btn ca-btn-block" onClick={instalar}>Instalar la caja en este dispositivo</button>}
      </div>
    </div>
  )

  const pos = (
    <div className="ca-pos">
      <section className="ca-productos">
        <input className="ca-search" placeholder="Buscar producto…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="ca-prod-grid">
          {prodsFiltrados.map(p => {
            const miss = sinPrecioProd(p)
            return (
              <button key={p.producto_id} className="ca-prod" onClick={() => addProducto(p)} disabled={miss}>
                <span className="ca-prod-info">
                  <span className="ca-prod-name">{p.nombre}</span>
                  {p.codigo ? <span className="ca-prod-code">{p.codigo}</span> : null}
                </span>
                <span className={`ca-prod-price${miss ? ' miss' : ''}`}>{miss ? `Sin precio en ${moneda}` : `${simbolo(moneda)} ${money(precioDe(p))}`}</span>
              </button>
            )
          })}
          {productos.length === 0 && <p className="ca-empty">Sin productos cargados. Usa «Artículo libre» para teclear la venta.</p>}
        </div>
        {libreOpen ? (
          <div className="ca-field">
            <input className="ca-input" placeholder="Nombre del artículo" value={libreNom} onChange={e => setLibreNom(e.target.value)} />
            <div className="ca-pay-row">
              {monedas.length > 1 && (
                <select className="ca-select" value={moneda} onChange={e => cambiarMoneda(e.target.value)} aria-label="Moneda del artículo">
                  {monedas.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
              <input className="ca-input" type="number" inputMode="decimal" placeholder={`Precio (${moneda})`} value={librePre} onChange={e => setLibrePre(e.target.value)} />
              <button className="ca-btn ca-btn-primary" onClick={addLibre}>Añadir</button>
              <button className="ca-btn" onClick={() => setLibre(false)}>Cancelar</button>
            </div>
          </div>
        ) : (
          <button className="ca-btn ca-btn-block" onClick={() => setLibre(true)}>＋ Artículo libre</button>
        )}
      </section>

      <aside className="ca-ticket">
        <div className="ca-ticket-head"><span>Ticket</span><span>{moneda}</span></div>
        <div className="ca-ticket-items">
          {cart.length === 0
            ? <p className="ca-empty">Toca un producto para añadirlo.</p>
            : cart.map(l => {
              const miss = lineaSinPrecio(l)
              return (
              <div key={l.key} className="ca-tick-item">
                <div>
                  <div className="ca-tick-name">{l.descripcion}</div>
                  <div className={`ca-tick-unit${miss ? ' miss' : ''}`}>{miss ? `Sin precio en ${moneda}` : `${simbolo(moneda)} ${money(l.precio_unitario)}`}</div>
                </div>
                <div className="ca-stepper">
                  <button className="ca-step-btn" onClick={() => changeQty(l.key, -1)} aria-label="Quitar uno">−</button>
                  <span className="ca-qty">{l.cantidad}</span>
                  <button className="ca-step-btn" onClick={() => changeQty(l.key, 1)} aria-label="Añadir uno">+</button>
                </div>
                <span className="ca-tick-sub">{money(l.cantidad * l.precio_unitario)}</span>
                <button className="ca-tick-x" onClick={() => removeLine(l.key)} aria-label="Quitar">×</button>
              </div>
              )
            })}
        </div>
        <div className="ca-ticket-foot">
          {rectiUuid && (
            <div className="ca-recti-banner">
              <span>Rectificando una venta · la original se anulará</span>
              <button className="ca-recti-cancel" onClick={cancelarRecti}>Cancelar</button>
            </div>
          )}
          <div className="ca-total-row"><span className="ca-total-lbl">Total</span><span className="ca-total">{simbolo(moneda)} {money(cartTotal)}</span></div>
          <div className="ca-pay-row">
            {monedas.length > 1 && (
              <select className="ca-select" value={moneda} onChange={e => cambiarMoneda(e.target.value)} aria-label="Moneda">
                {monedas.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
            <select className="ca-select" value={medioPago} onChange={e => setMedio(e.target.value)} aria-label="Medio de pago">
              <option>Efectivo</option><option>Transferencia</option><option>Otro</option>
            </select>
          </div>
          <button className="ca-cobrar" disabled={busy || cart.length === 0 || cartInvalido} onClick={cobrar}>{rectiUuid ? 'Guardar rectificación' : 'Cobrar'}</button>
        </div>
      </aside>
    </div>
  )

  const turnoPanel = sesion && (
    <div className="ca-panel">
      <div className="ca-panel-title">Turno abierto</div>
      <div className="ca-card">
        <div className="ca-muted">Abierto {new Date(sesion.abierta_at).toLocaleString('es-ES')}</div>
        {ventasTurno.size === 0
          ? <div className="ca-muted">Aún no hay ventas en este turno.</div>
          : [...ventasTurno.entries()].map(([m, v]) => (
            <div key={m} className="ca-stat-row"><span className="ca-muted">{v.count} ventas en {m}</span><span className="ca-stat-big">{simbolo(m)} {money(v.total)}</span></div>
          ))}
      </div>
      <div className="ca-card">
        <div className="ca-panel-title">Cerrar turno (arqueo)</div>
        <div className="ca-muted">Cuenta el efectivo real (opcional) y cierra:</div>
        {monedas.map(m => (
          <div className="ca-field" key={m}>
            <label className="ca-label">Efectivo contado {m}</label>
            <input className="ca-input" type="number" inputMode="decimal" placeholder="0.00" value={contado[m] ?? ''} onChange={e => setContado(c => ({ ...c, [m]: e.target.value }))} />
          </div>
        ))}
        <button className="ca-btn ca-btn-primary ca-btn-block" disabled={busy} onClick={cerrarTurno}>Cerrar turno</button>
      </div>
    </div>
  )

  const ventasPanel = (
    <div className="ca-panel">
      <div className="ca-panel-title">Ventas del día</div>
      {ventasDia.length === 0
        ? <div className="ca-card"><div className="ca-muted">Aún no hay ventas hoy.</div></div>
        : ventasDia.map(t => {
          const est = t.estado ?? 'VIGENTE'
          const anulada = est === 'ANULADO'
          const puedeRecti = !!sesion && t.sesion_uuid === sesion.sesion_uuid && !anulada && !rectificados.has(t.ticket_uuid)
          return (
            <div key={t.ticket_uuid} className={`ca-op${anulada ? ' anulada' : ''}`}>
              <div className="ca-op-info">
                <div className="ca-op-top">
                  <span className="ca-op-time">{new Date(t.fecha).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                  {anulada && <span className="ca-tag ca-tag-anulada">Anulada</span>}
                  {est === 'RECTIFICACION' && <span className="ca-tag ca-tag-recti">Rectificación</span>}
                </div>
                <div className="ca-op-desc">{t.lineas.map(l => `${l.cantidad}× ${l.descripcion}`).join(' · ')}</div>
              </div>
              <div className="ca-op-side">
                <div className="ca-op-total">{simbolo(t.moneda)} {money(t.total)}</div>
                {puedeRecti && <button className="ca-btn ca-btn-sm" onClick={() => rectificar(t)}>Rectificar</button>}
              </div>
            </div>
          )
        })}
      <p className="ca-muted">Rectificar recarga la venta para corregir cantidad, precio o moneda: se crea una venta corregida y la original queda anulada. Ambas quedan registradas en Claux.</p>
    </div>
  )

  const syncPanel = (
    <div className="ca-panel">
      <div className="ca-panel-title">Sincronizar con Claux</div>
      <div className="ca-card">
        <div className="ca-stat-row"><span className="ca-muted">Ventas sin enviar</span><span className="ca-stat-big">{pend.tickets}</span></div>
        <div className="ca-stat-row"><span className="ca-muted">Cierres sin enviar</span><span className="ca-stat-big">{pend.cierres}</span></div>
      </div>
      <button className="ca-btn ca-btn-primary ca-btn-block ca-btn-lg" disabled={busy || !online} onClick={sincronizar}>{online ? 'Sincronizar ahora' : 'Sin conexión'}</button>
      <button className="ca-btn ca-btn-block" onClick={exportar}>Exportar archivo (.json)</button>
      <button className="ca-btn ca-btn-block" disabled={busy || !online} onClick={actualizarProductos}>Actualizar productos y monedas</button>
      <button className="ca-btn ca-btn-block" disabled={busy || !online} onClick={actualizarApp}>Actualizar app (última versión)</button>
      <p className="ca-muted">¿Cambiaste productos, precios o monedas en Claux? Pulsa «Actualizar productos». ¿No ves los últimos cambios de la caja? Pulsa «Actualizar app».</p>
      {!standalone && (
        <div className="ca-card">
          <div className="ca-panel-title">Instalar en este dispositivo</div>
          {installEvt ? (
            <button className="ca-btn ca-btn-primary ca-btn-block" onClick={instalar}>Instalar la caja</button>
          ) : isIOS ? (
            <div className="ca-steps">
              <div className="ca-step-row"><span className="ca-step-num">1</span> Toca Compartir en Safari (el cuadro con la flecha ↑)</div>
              <div className="ca-step-row"><span className="ca-step-num">2</span> Elige «Añadir a pantalla de inicio»</div>
            </div>
          ) : (
            <p className="ca-muted">En el menú del navegador (⋮) elige «Instalar app» o «Añadir a pantalla de inicio». No hace falta otro navegador.</p>
          )}
        </div>
      )}
      <p className="ca-muted">Sin conexión: exporta el archivo y súbelo en Claux → Caja → Sincronizar. Se registra por fecha, sin duplicar.</p>
    </div>
  )

  const welcome = (
    <div className="ca-gate">
      <div className="ca-gate-card">
        <div className="ca-gate-step">Bienvenido</div>
        <div className="ca-gate-title">Caja {config?.caja.nombre ?? ''}</div>
        <p className="ca-gate-text">Instálala en este dispositivo para tenerla como una app y usarla siempre, incluso sin internet.</p>
        {installEvt ? (
          <button className="ca-btn ca-btn-primary ca-btn-lg ca-btn-block" onClick={instalar}>Instalar la caja</button>
        ) : isIOS ? (
          <div className="ca-steps">
            <div className="ca-step-row"><span className="ca-step-num">1</span> Toca Compartir en Safari (el cuadro con la flecha ↑)</div>
            <div className="ca-step-row"><span className="ca-step-num">2</span> Elige «Añadir a pantalla de inicio»</div>
            <div className="ca-step-row"><span className="ca-step-num">3</span> Abre la caja desde su icono</div>
          </div>
        ) : (
          <p className="ca-gate-text">En el menú del navegador (⋮) elige «Instalar app» o «Añadir a pantalla de inicio».</p>
        )}
        <button className="ca-btn ca-btn-block" onClick={continuarSinInstalar}>Continuar sin instalar</button>
      </div>
    </div>
  )

  return (
    <>
      <header className="ca-header">
        <div>
          <div className="ca-title">{config?.caja.nombre ?? 'Caja'}</div>
          <div className={`ca-turno-chip${sesion ? '' : ' closed'}`}>
            <span className="ca-dot" />{sesion ? `Turno abierto · ${ventasTurnoN} ventas` : 'Turno cerrado'}
          </div>
        </div>
        <span className={`ca-online${online ? '' : ' off'}`}><span className="ca-dot" />{online ? 'En línea' : 'Sin conexión'}</span>
      </header>

      {msg && <div className={`ca-msg ca-msg-${msg.t}`}>{msg.x}</div>}

      {!enApp ? welcome : vista === 'sync' ? syncPanel : vista === 'ventas' ? ventasPanel : !sesion ? gate : vista === 'vender' ? pos : turnoPanel}

      {enApp && (
        <nav className="ca-nav">
          <button className={`ca-nav-btn${vista === 'vender' ? ' active' : ''}`} onClick={() => { setVista('vender'); setMsg(null) }}>Vender</button>
          <button className={`ca-nav-btn${vista === 'ventas' ? ' active' : ''}`} onClick={() => { setVista('ventas'); setMsg(null) }}>Ventas</button>
          <button className={`ca-nav-btn${vista === 'turno' ? ' active' : ''}`} onClick={() => { setVista('turno'); setMsg(null) }}>Turno</button>
          <button className={`ca-nav-btn${vista === 'sync' ? ' active' : ''}`} onClick={() => { setVista('sync'); setMsg(null) }}>
            Sincronizar{totalPend > 0 && <span className="ca-nav-badge">{totalPend}</span>}
          </button>
        </nav>
      )}
    </>
  )
}
