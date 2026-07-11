'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  type CajaConfig, type Producto, type LocalTicket, type LocalSesion, type LocalLinea,
  metaGet, metaSet, saveProductos, getProductos, putTicket, getTickets, putSesion, getSesiones,
  markTicketsSynced, markSesionesSynced,
} from './caja-db'

type Tab = 'vender' | 'turno' | 'sync' | 'ajustes'
interface CartLine { key: string; producto_id: string | null; descripcion: string; cantidad: number; precio_unitario: number }

const uid   = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const money  = (n: number) => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function fetchSeed(token: string): Promise<{ config: CajaConfig; productos: Producto[] }> {
  const res = await fetch('/caja/api/seed', { headers: { 'x-caja-token': token }, cache: 'no-store' })
  const j = await res.json()
  if (!res.ok || !j.ok) throw new Error(j?.error || 'seed')
  return { config: { caja: j.seed.caja, monedas: j.seed.monedas, tasas: j.seed.tasas }, productos: j.seed.productos ?? [] }
}
const stripTicket = (t: LocalTicket) => ({
  ticket_uuid: t.ticket_uuid, sesion_uuid: t.sesion_uuid, fecha: t.fecha, moneda: t.moneda,
  total: t.total, medio_pago: t.medio_pago, lineas: t.lineas,
})
const stripSesion = (s: LocalSesion) => ({
  sesion_uuid: s.sesion_uuid, abierta_at: s.abierta_at, cerrada_at: s.cerrada_at,
  estado: s.estado, fondo_inicial: s.fondo_inicial, efectivo_contado: s.efectivo_contado,
})

export default function CajaApp() {
  const [ready, setReady]     = useState(false)
  const [token, setToken]     = useState<string | null>(null)
  const [config, setConfig]   = useState<CajaConfig | null>(null)
  const [productos, setProds] = useState<Producto[]>([])
  const [online, setOnline]   = useState(true)
  const [tab, setTab]         = useState<Tab>('vender')

  const [moneda, setMoneda]     = useState('')
  const [cart, setCart]         = useState<CartLine[]>([])
  const [medioPago, setMedio]   = useState('Efectivo')
  const [search, setSearch]     = useState('')
  const [libreOpen, setLibre]   = useState(false)
  const [libreNom, setLibreNom] = useState('')
  const [librePre, setLibrePre] = useState('')

  const [sesion, setSesion]   = useState<LocalSesion | null>(null)
  const [contado, setContado] = useState<Record<string, string>>({})
  const [pend, setPend]       = useState({ tickets: 0, cierres: 0 })
  const [msg, setMsg]         = useState<{ t: 'ok' | 'err' | 'warn'; x: string } | null>(null)
  const [busy, setBusy]       = useState(false)

  const monedas = config?.caja.monedas_aceptadas?.length
    ? config.caja.monedas_aceptadas
    : (config?.monedas?.map(m => m.codigo) ?? [])
  const simbolo = (m: string) => config?.monedas.find(x => x.codigo === m)?.simbolo ?? m
  const precioDe = (p: Producto) => Number(p.precios?.[moneda] ?? 0)
  const cartTotal = round2(cart.reduce((s, l) => s + l.cantidad * l.precio_unitario, 0))

  const refreshPend = useCallback(async () => {
    const [tks, sess] = [await getTickets(), await getSesiones()]
    setPend({
      tickets: tks.filter(t => !t.synced).length,
      cierres: sess.filter(s => s.estado === 'CERRADA' && !s.synced).length,
    })
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
      let prods = await getProductos()
      if (tk && !cfg && navigator.onLine) {
        try { const s = await fetchSeed(tk); cfg = s.config; prods = s.productos; await metaSet('config', cfg); await saveProductos(prods) } catch { /* offline */ }
      }
      const ses = (await getSesiones()).find(s => s.estado === 'ABIERTA') ?? null
      if (cancelled) return
      setToken(tk); setConfig(cfg); setProds(prods); setSesion(ses)
      setMoneda(cfg?.caja.monedas_aceptadas?.[0] ?? cfg?.monedas?.[0]?.codigo ?? 'CUP')
      setOnline(navigator.onLine)
      await refreshPend()
      setReady(true)
    })()
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { cancelled = true; window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [refreshPend])

  // ── POS ──
  function addProducto(p: Producto) {
    setCart(prev => {
      const i = prev.findIndex(l => l.producto_id === p.producto_id)
      if (i >= 0) { const c = [...prev]; c[i] = { ...c[i], cantidad: c[i].cantidad + 1 }; return c }
      return [...prev, { key: uid(), producto_id: p.producto_id, descripcion: p.nombre, cantidad: 1, precio_unitario: precioDe(p) }]
    })
  }
  function addLibre() {
    const precio = parseFloat(librePre)
    if (!libreNom.trim() || isNaN(precio) || precio < 0) { setMsg({ t: 'err', x: 'Nombre y precio válidos para el artículo libre.' }); return }
    setCart(prev => [...prev, { key: uid(), producto_id: null, descripcion: libreNom.trim(), cantidad: 1, precio_unitario: round2(precio) }])
    setLibreNom(''); setLibrePre(''); setLibre(false)
  }
  function changeQty(key: string, d: number) {
    setCart(prev => prev.flatMap(l => l.key !== key ? [l] : (l.cantidad + d <= 0 ? [] : [{ ...l, cantidad: l.cantidad + d }])))
  }

  async function cobrar() {
    if (!cart.length || busy) return
    setBusy(true)
    try {
      let ses = sesion
      if (!ses) {
        ses = { sesion_uuid: uid(), abierta_at: new Date().toISOString(), cerrada_at: null, estado: 'ABIERTA', fondo_inicial: {}, efectivo_contado: {}, synced: false }
        await putSesion(ses); setSesion(ses)
      }
      const lineas: LocalLinea[] = cart.map(l => ({
        producto_id: l.producto_id, descripcion: l.descripcion, cantidad: l.cantidad,
        precio_unitario: l.precio_unitario, subtotal: round2(l.cantidad * l.precio_unitario),
      }))
      const total = round2(lineas.reduce((s, l) => s + l.subtotal, 0))
      const t: LocalTicket = { ticket_uuid: uid(), sesion_uuid: ses.sesion_uuid, fecha: new Date().toISOString(), moneda, total, medio_pago: medioPago, lineas, synced: false }
      await putTicket(t)
      setCart([]); setMsg({ t: 'ok', x: `Cobrado ${simbolo(moneda)} ${money(total)}` })
      await refreshPend()
      if (navigator.onLine) sincronizar(true)
    } catch { setMsg({ t: 'err', x: 'No se pudo registrar el cobro.' }) }
    finally { setBusy(false) }
  }

  // ── Turno ──
  async function abrirTurno() {
    const ses: LocalSesion = { sesion_uuid: uid(), abierta_at: new Date().toISOString(), cerrada_at: null, estado: 'ABIERTA', fondo_inicial: {}, efectivo_contado: {}, synced: false }
    await putSesion(ses); setSesion(ses); setMsg({ t: 'ok', x: 'Turno abierto.' })
  }
  async function cerrarTurno() {
    if (!sesion || busy) return
    setBusy(true)
    try {
      const efectivo: Record<string, number> = {}
      for (const [k, v] of Object.entries(contado)) { const n = parseFloat(v); if (!isNaN(n)) efectivo[k] = n }
      const cerrada: LocalSesion = { ...sesion, cerrada_at: new Date().toISOString(), estado: 'CERRADA', efectivo_contado: efectivo, synced: false }
      await putSesion(cerrada); setSesion(null); setContado({})
      setMsg({ t: 'ok', x: 'Turno cerrado. Se registrará el resumen al sincronizar.' })
      await refreshPend()
      if (navigator.onLine) sincronizar(true)
    } catch { setMsg({ t: 'err', x: 'No se pudo cerrar el turno.' }) }
    finally { setBusy(false) }
  }

  // ── Sync / export ──
  async function sincronizar(silent = false) {
    if (!token) { if (!silent) setMsg({ t: 'err', x: 'Caja no configurada.' }); return }
    if (!navigator.onLine) { if (!silent) setMsg({ t: 'warn', x: 'Sin conexión. Exporta el archivo y súbelo luego.' }); return }
    const tks  = (await getTickets()).filter(t => !t.synced)
    const sess = (await getSesiones()).filter(s => s.estado === 'CERRADA' && !s.synced)
    if (!tks.length && !sess.length) { if (!silent) setMsg({ t: 'ok', x: 'Todo sincronizado.' }); return }
    try {
      const res = await fetch('/caja/api/sync', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-caja-token': token },
        body: JSON.stringify({ tickets: tks.map(stripTicket), cierres: sess.map(stripSesion) }),
      })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j?.error || 'sync')
      await markTicketsSynced(tks.map(t => t.ticket_uuid))
      await markSesionesSynced(sess.map(s => s.sesion_uuid))
      await refreshPend()
      if (!silent) setMsg({ t: 'ok', x: `Sincronizado: ${j.resultado?.tickets_nuevos ?? tks.length} ventas, ${j.resultado?.cierres_posteados ?? sess.length} cierres.` })
    } catch { if (!silent) setMsg({ t: 'err', x: 'No se pudo sincronizar. Reintenta o exporta el archivo.' }) }
  }

  async function exportar() {
    const tks  = (await getTickets()).filter(t => !t.synced)
    const sess = (await getSesiones()).filter(s => s.estado === 'CERRADA' && !s.synced)
    if (!tks.length && !sess.length) { setMsg({ t: 'ok', x: 'No hay nada pendiente de exportar.' }); return }
    const payload = { caja: config?.caja.caja_id ?? null, exportado_at: new Date().toISOString(), tickets: tks.map(stripTicket), cierres: sess.map(stripSesion) }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `caja-${config?.caja.caja_id ?? 'export'}-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setMsg({ t: 'ok', x: 'Archivo exportado. Súbelo en Claux → Caja → Sincronizar.' })
  }

  async function actualizarProductos() {
    if (!token) return
    if (!navigator.onLine) { setMsg({ t: 'warn', x: 'Necesitas conexión para actualizar productos.' }); return }
    setBusy(true)
    try {
      const s = await fetchSeed(token)
      await metaSet('config', s.config); await saveProductos(s.productos)
      setConfig(s.config); setProds(s.productos)
      setMsg({ t: 'ok', x: `Productos actualizados (${s.productos.length}).` })
    } catch { setMsg({ t: 'err', x: 'No se pudieron actualizar los productos.' }) }
    finally { setBusy(false) }
  }

  // ── Render ──
  if (!ready) return <div className="ca-main"><p className="ca-center">Cargando caja…</p></div>

  if (!token && !config) {
    return (
      <div className="ca-main">
        <p className="ca-section-title">Caja sin configurar</p>
        <p className="ca-muted">Abre esta caja desde el enlace de instalación que te dio Claux (Portal → Caja → Configurar → «Instalar en un dispositivo»). Una vez abierta con conexión, funcionará sin internet.</p>
      </div>
    )
  }

  const prodsFiltrados = productos.filter(p => {
    const q = search.toLowerCase().trim()
    return !q || `${p.nombre} ${p.codigo}`.toLowerCase().includes(q)
  }).slice(0, 60)
  const pendTotal = pend.tickets + pend.cierres

  return (
    <>
      <header className="ca-header">
        <div>
          <div className="ca-title">{config?.caja.nombre ?? 'Caja'}</div>
          <div className="ca-sub">{sesion ? 'Turno abierto' : 'Sin turno'}</div>
        </div>
        <span className={`ca-status${online ? '' : ' off'}`}>{online ? 'En línea' : 'Sin conexión'}</span>
      </header>

      <main className="ca-main">
        {msg && <div className={`ca-msg ca-msg-${msg.t === 'ok' ? 'ok' : msg.t === 'warn' ? 'warn' : 'err'}`}>{msg.x}</div>}

        {tab === 'vender' && (
          <>
            <div className="ca-section-title">Venta actual</div>
            {cart.length === 0 ? (
              <p className="ca-muted">Toca un producto para añadirlo.</p>
            ) : (
              <div className="ca-cart">
                {cart.map(l => (
                  <div key={l.key} className="ca-cart-row">
                    <div>
                      <div className="ca-cart-name">{l.descripcion}</div>
                      <div className="ca-cart-sub">{simbolo(moneda)} {money(l.precio_unitario)}</div>
                    </div>
                    <div className="ca-stepper">
                      <button className="ca-step" onClick={() => changeQty(l.key, -1)} aria-label="Quitar uno">−</button>
                      <span className="ca-qty">{l.cantidad}</span>
                      <button className="ca-step" onClick={() => changeQty(l.key, 1)} aria-label="Añadir uno">+</button>
                    </div>
                    <div className="ca-line-total">{money(l.cantidad * l.precio_unitario)}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="ca-section-title">Productos</div>
            {monedas.length > 1 && (
              <div className="ca-field">
                <label className="ca-label" htmlFor="ca-moneda">Moneda de la venta</label>
                <select id="ca-moneda" className="ca-select" value={moneda} onChange={e => setMoneda(e.target.value)}>
                  {monedas.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            )}
            <input className="ca-input" placeholder="Buscar producto…" value={search} onChange={e => setSearch(e.target.value)} />
            <div className="ca-prod-list">
              {prodsFiltrados.map(p => (
                <button key={p.producto_id} className="ca-prod" onClick={() => addProducto(p)}>
                  <span>
                    <span className="ca-prod-name">{p.nombre}</span>
                    {p.codigo && <span className="ca-prod-code"> · {p.codigo}</span>}
                  </span>
                  <span className="ca-prod-price">{simbolo(moneda)} {money(precioDe(p))}</span>
                </button>
              ))}
              {productos.length === 0 && <p className="ca-muted">Sin productos cargados. Usa «Artículo libre» para teclear la venta.</p>}
            </div>

            {libreOpen ? (
              <div className="ca-field">
                <input className="ca-input" placeholder="Nombre del artículo" value={libreNom} onChange={e => setLibreNom(e.target.value)} />
                <div className="ca-row">
                  <input className="ca-input" type="number" inputMode="decimal" placeholder="Precio" value={librePre} onChange={e => setLibrePre(e.target.value)} />
                  <button className="ca-btn ca-btn-primary" onClick={addLibre}>Añadir</button>
                  <button className="ca-btn ca-btn-ghost" onClick={() => setLibre(false)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <button className="ca-btn ca-btn-ghost ca-btn-block" onClick={() => setLibre(true)}>＋ Artículo libre</button>
            )}
          </>
        )}

        {tab === 'turno' && (
          <>
            <div className="ca-section-title">Turno</div>
            {sesion ? (
              <>
                <div className="ca-item">
                  <div className="ca-item-main">
                    <strong>Turno abierto</strong>
                    <span className="ca-muted">Desde {new Date(sesion.abierta_at).toLocaleString('es-ES')}</span>
                  </div>
                  <span className="ca-chip ok">Abierto</span>
                </div>
                <p className="ca-muted">Efectivo contado al cerrar (opcional, para el arqueo):</p>
                {monedas.map(m => (
                  <div className="ca-field" key={m}>
                    <label className="ca-label">{m}</label>
                    <input className="ca-input" type="number" inputMode="decimal" placeholder="0.00"
                      value={contado[m] ?? ''} onChange={e => setContado(c => ({ ...c, [m]: e.target.value }))} />
                  </div>
                ))}
                <button className="ca-btn ca-btn-primary ca-btn-block" disabled={busy} onClick={cerrarTurno}>Cerrar turno</button>
              </>
            ) : (
              <>
                <p className="ca-muted">No hay turno abierto. Se abre solo al primer cobro, o ábrelo aquí.</p>
                <button className="ca-btn ca-btn-primary ca-btn-block" onClick={abrirTurno}>Abrir turno</button>
              </>
            )}
          </>
        )}

        {tab === 'sync' && (
          <>
            <div className="ca-section-title">Sincronizar</div>
            <div className="ca-item">
              <div className="ca-item-main"><strong>{pend.tickets}</strong><span className="ca-muted">ventas sin enviar</span></div>
              <div className="ca-item-main"><strong>{pend.cierres}</strong><span className="ca-muted">cierres sin enviar</span></div>
            </div>
            <button className="ca-btn ca-btn-primary ca-btn-block" disabled={busy || !online} onClick={() => sincronizar(false)}>
              {online ? 'Sincronizar ahora' : 'Sin conexión'}
            </button>
            <button className="ca-btn ca-btn-block" onClick={exportar}>Exportar archivo (.json)</button>
            <p className="ca-muted">Sin conexión: exporta el archivo y súbelo en Claux → Caja → Sincronizar. Se registra por fecha, sin duplicar.</p>
          </>
        )}

        {tab === 'ajustes' && (
          <>
            <div className="ca-section-title">Ajustes</div>
            <div className="ca-item">
              <div className="ca-item-main"><strong>{config?.caja.nombre ?? 'Caja'}</strong><span className="ca-muted">{config?.caja.caja_id}</span></div>
              <span className={`ca-status${online ? '' : ' off'}`}>{online ? 'En línea' : 'Offline'}</span>
            </div>
            <div className="ca-item">
              <div className="ca-item-main"><strong>{productos.length}</strong><span className="ca-muted">productos cargados</span></div>
            </div>
            <button className="ca-btn ca-btn-block" disabled={busy || !online} onClick={actualizarProductos}>Actualizar productos desde Claux</button>
            <p className="ca-muted">Actualiza precios y altas hechas en Inventario. Necesita conexión.</p>
          </>
        )}
      </main>

      {tab === 'vender' && (
        <div className="ca-bar">
          <div className="ca-total-row">
            <span className="ca-muted">Total</span>
            <span className="ca-total">{simbolo(moneda)} {money(cartTotal)}</span>
          </div>
          <div className="ca-row">
            <select className="ca-select" value={medioPago} onChange={e => setMedio(e.target.value)} aria-label="Medio de pago">
              <option>Efectivo</option><option>Transferencia</option><option>Otro</option>
            </select>
            <button className="ca-btn ca-btn-primary" disabled={busy || cart.length === 0} onClick={cobrar}>Cobrar</button>
          </div>
        </div>
      )}

      <nav className="ca-tabs">
        <button className={`ca-tab${tab === 'vender' ? ' active' : ''}`} onClick={() => { setTab('vender'); setMsg(null) }}>Vender</button>
        <button className={`ca-tab${tab === 'turno' ? ' active' : ''}`} onClick={() => { setTab('turno'); setMsg(null) }}>Turno</button>
        <button className={`ca-tab${tab === 'sync' ? ' active' : ''}`} onClick={() => { setTab('sync'); setMsg(null) }}>
          Sincronizar{pendTotal > 0 && <span className="ca-tab-badge">{pendTotal}</span>}
        </button>
        <button className={`ca-tab${tab === 'ajustes' ? ' active' : ''}`} onClick={() => { setTab('ajustes'); setMsg(null) }}>Ajustes</button>
      </nav>
    </>
  )
}
