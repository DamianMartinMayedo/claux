'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  type CajaConfig, type Producto, type LocalTicket, type LocalSesion, type LocalLinea,
  metaGet, metaSet, saveProductos, getProductos, putTicket, getTickets, putSesion, getSesiones,
  markTicketsSynced, markSesionesSynced,
} from './caja-db'

type Vista = 'vender' | 'turno' | 'sync'
interface CartLine { key: string; producto_id: string | null; descripcion: string; cantidad: number; precio_unitario: number }
type InstallPromptEvent = Event & { prompt: () => Promise<void> }

const uid    = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const money  = (n: number) => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function fetchSeed(token: string): Promise<{ config: CajaConfig; productos: Producto[] }> {
  const res = await fetch('/caja/api/seed', { headers: { 'x-caja-token': token }, cache: 'no-store' })
  const j = await res.json()
  if (!res.ok || !j.ok) throw new Error(j?.error || 'seed')
  return { config: { caja: j.seed.caja, monedas: j.seed.monedas, tasas: j.seed.tasas }, productos: j.seed.productos ?? [] }
}
const stripTicket = (t: LocalTicket) => ({ ticket_uuid: t.ticket_uuid, sesion_uuid: t.sesion_uuid, fecha: t.fecha, moneda: t.moneda, total: t.total, medio_pago: t.medio_pago, lineas: t.lineas })
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
      let prods = await getProductos()
      if (tk && !cfg && navigator.onLine) {
        try { const s = await fetchSeed(tk); cfg = s.config; prods = s.productos; await metaSet('config', cfg); await saveProductos(prods) } catch { /* offline */ }
      }
      if (cancelled) return
      setToken(tk); setConfig(cfg); setProds(prods)
      setMoneda(cfg?.caja.monedas_aceptadas?.[0] ?? cfg?.monedas?.[0]?.codigo ?? 'CUP')
      setOnline(navigator.onLine)
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
      setStandalone(isStandalone)
      setDismissed((await metaGet<boolean>('install_dismissed')) === true)
      await reload()
      setReady(true)
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
  function addProducto(p: Producto) {
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
    setCart(prev => prev.reduce<CartLine[]>((acc, l) => {
      if (l.key !== key) { acc.push(l); return acc }
      const nueva = l.cantidad + d
      if (nueva > 0) acc.push({ ...l, cantidad: nueva })
      return acc
    }, []))
  }
  function removeLine(key: string) { setCart(prev => prev.filter(l => l.key !== key)) }

  async function cobrar() {
    if (!cart.length || busy || !sesion) return
    setBusy(true)
    try {
      const lineas: LocalLinea[] = cart.map(l => ({ producto_id: l.producto_id, descripcion: l.descripcion, cantidad: l.cantidad, precio_unitario: l.precio_unitario, subtotal: round2(l.cantidad * l.precio_unitario) }))
      const total = round2(lineas.reduce((s, l) => s + l.subtotal, 0))
      const t: LocalTicket = { ticket_uuid: uid(), sesion_uuid: sesion.sesion_uuid, fecha: new Date().toISOString(), moneda, total, medio_pago: medioPago, lineas, synced: false }
      await putTicket(t); await reload()
      setCart([]); setMsg({ t: 'ok', x: `Cobrado ${simbolo(moneda)} ${money(total)}` })
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
    try { const s = await fetchSeed(token); await metaSet('config', s.config); await saveProductos(s.productos); setConfig(s.config); setProds(s.productos); setMsg({ t: 'ok', x: `Productos actualizados (${s.productos.length}).` }) }
    catch { setMsg({ t: 'err', x: 'No se pudieron actualizar los productos.' }) }
    finally { setBusy(false) }
  }
  async function instalar() { if (!installEvt) return; await installEvt.prompt(); setInstallEvt(null); setDismissed(true) }
  async function continuarSinInstalar() { setDismissed(true); await metaSet('install_dismissed', true) }

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
          {prodsFiltrados.map(p => (
            <button key={p.producto_id} className="ca-prod" onClick={() => addProducto(p)}>
              <span className="ca-prod-name">{p.nombre}</span>
              <span className="ca-prod-price">{simbolo(moneda)} {money(precioDe(p))}</span>
            </button>
          ))}
          {productos.length === 0 && <p className="ca-empty">Sin productos cargados. Usa «Artículo libre» para teclear la venta.</p>}
        </div>
        {libreOpen ? (
          <div className="ca-field">
            <input className="ca-input" placeholder="Nombre del artículo" value={libreNom} onChange={e => setLibreNom(e.target.value)} />
            <div className="ca-pay-row">
              <input className="ca-input" type="number" inputMode="decimal" placeholder="Precio" value={librePre} onChange={e => setLibrePre(e.target.value)} />
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
            : cart.map(l => (
              <div key={l.key} className="ca-tick-item">
                <div>
                  <div className="ca-tick-name">{l.descripcion}</div>
                  <div className="ca-tick-unit">{simbolo(moneda)} {money(l.precio_unitario)}</div>
                </div>
                <div className="ca-stepper">
                  <button className="ca-step-btn" onClick={() => changeQty(l.key, -1)} aria-label="Quitar uno">−</button>
                  <span className="ca-qty">{l.cantidad}</span>
                  <button className="ca-step-btn" onClick={() => changeQty(l.key, 1)} aria-label="Añadir uno">+</button>
                </div>
                <span className="ca-tick-sub">{money(l.cantidad * l.precio_unitario)}</span>
                <button className="ca-tick-x" onClick={() => removeLine(l.key)} aria-label="Quitar">×</button>
              </div>
            ))}
        </div>
        <div className="ca-ticket-foot">
          <div className="ca-total-row"><span className="ca-total-lbl">Total</span><span className="ca-total">{simbolo(moneda)} {money(cartTotal)}</span></div>
          <div className="ca-pay-row">
            {monedas.length > 1 && (
              <select className="ca-select" value={moneda} onChange={e => setMoneda(e.target.value)} aria-label="Moneda">
                {monedas.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
            <select className="ca-select" value={medioPago} onChange={e => setMedio(e.target.value)} aria-label="Medio de pago">
              <option>Efectivo</option><option>Transferencia</option><option>Otro</option>
            </select>
          </div>
          <button className="ca-cobrar" disabled={busy || cart.length === 0} onClick={cobrar}>Cobrar</button>
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

  const syncPanel = (
    <div className="ca-panel">
      <div className="ca-panel-title">Sincronizar con Claux</div>
      <div className="ca-card">
        <div className="ca-stat-row"><span className="ca-muted">Ventas sin enviar</span><span className="ca-stat-big">{pend.tickets}</span></div>
        <div className="ca-stat-row"><span className="ca-muted">Cierres sin enviar</span><span className="ca-stat-big">{pend.cierres}</span></div>
      </div>
      <button className="ca-btn ca-btn-primary ca-btn-block ca-btn-lg" disabled={busy || !online} onClick={sincronizar}>{online ? 'Sincronizar ahora' : 'Sin conexión'}</button>
      <button className="ca-btn ca-btn-block" onClick={exportar}>Exportar archivo (.json)</button>
      <button className="ca-btn ca-btn-block" disabled={busy || !online} onClick={actualizarProductos}>Actualizar productos desde Claux</button>
      {installEvt && <button className="ca-btn ca-btn-block" onClick={instalar}>Instalar la caja en este dispositivo</button>}
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

      {!enApp ? welcome : vista === 'sync' ? syncPanel : !sesion ? gate : vista === 'vender' ? pos : turnoPanel}

      {enApp && (
        <nav className="ca-nav">
          <button className={`ca-nav-btn${vista === 'vender' ? ' active' : ''}`} onClick={() => { setVista('vender'); setMsg(null) }}>Vender</button>
          <button className={`ca-nav-btn${vista === 'turno' ? ' active' : ''}`} onClick={() => { setVista('turno'); setMsg(null) }}>Turno</button>
          <button className={`ca-nav-btn${vista === 'sync' ? ' active' : ''}`} onClick={() => { setVista('sync'); setMsg(null) }}>
            Sincronizar{totalPend > 0 && <span className="ca-nav-badge">{totalPend}</span>}
          </button>
        </nav>
      )}
    </>
  )
}
