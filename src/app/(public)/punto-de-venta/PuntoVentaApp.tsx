'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  type CajaConfig, type Producto, type LocalTicket, type LocalSesion, type LocalLinea,
  type LocalMovimiento,
  metaGet, metaSet, saveProductos, getProductos, putTicket, getTickets, putSesion, getSesiones,
  putMovimiento, getMovimientos, markTicketsSynced, markSesionesSynced, markMovimientosSynced,
} from './punto-venta-db'
// «Hoy» en la zona del NEGOCIO (America/Havana), no en UTC: con `toISOString()` a partir de
// las 20:00 la fecha ya es la de mañana, así que un documento registrado de noche el último
// día del mes caía en el mes siguiente. Una sola fuente: `lib/fecha-tz.ts`.
import { hoyEnTz, fechaEnTz, diasDeCalendario, TZ_NEGOCIO } from '@/lib/fecha-tz'
import PuntoVentaPwaRegister from './PuntoVentaPwaRegister'

type Vista = 'vender' | 'ventas' | 'turno' | 'sync'
/** `auto` sigue al sistema; los otros dos lo fuerzan desde la propia caja. */
type Tema = 'auto' | 'claro' | 'oscuro'
/** Medios de pago. Fijos por ahora; hacerlos configurables por punto (Transfermóvil,
 *  Enzona, tarjeta…) es la ficha F5 del backlog. */
const MEDIOS_PAGO = ['Efectivo', 'Transferencia', 'Otro'] as const
/** Billetes con los que se paga de verdad aquí. Los atajos del cambio SUMAN, así que dos
 *  toques en «+1000» son dos billetes de mil, igual que en la mano. */
const BILLETES = [200, 500, 1000, 2000] as const
interface CartLine { key: string; producto_id: string | null; descripcion: string; cantidad: number; precio_unitario: number }
type InstallPromptEvent = Event & { prompt: () => Promise<void> }

// Moneda inicial de venta: preferimos CUP (la de curso legal); si no, la primera
// aceptada. Lista vacía significa «ninguna configurada», NO «todas»: antes se caía a
// todas las monedas del cliente, y eso convertía una configuración incompleta en
// permiso para cobrar en cualquier moneda —incluida alguna sin caja en Tesorería, que
// es dinero que el cierre no puede contabilizar—.
function monedaPorDefecto(cfg: CajaConfig | null): string {
  const aceptadas = cfg?.caja.monedas_aceptadas ?? []
  return aceptadas.includes('CUP') ? 'CUP' : (aceptadas[0] ?? 'CUP')
}
const uid    = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const money  = (n: number) => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function fetchSeed(token: string): Promise<{ config: CajaConfig; productos: Producto[] }> {
  const res = await fetch('/punto-de-venta/api/seed', { headers: { 'x-caja-token': token }, cache: 'no-store' })
  const j = await res.json()
  if (!res.ok || !j.ok) throw new Error(j?.error || 'seed')
  return { config: { caja: j.seed.caja, monedas: j.seed.monedas, tasas: j.seed.tasas }, productos: j.seed.productos ?? [] }
}
const stripTicket = (t: LocalTicket) => ({ ticket_uuid: t.ticket_uuid, sesion_uuid: t.sesion_uuid, fecha: t.fecha, moneda: t.moneda, total: t.total, medio_pago: t.medio_pago, estado: t.estado ?? 'VIGENTE', rectifica_a: t.rectifica_a ?? null, lineas: t.lineas })
const stripSesion = (s: LocalSesion) => ({ sesion_uuid: s.sesion_uuid, abierta_at: s.abierta_at, cerrada_at: s.cerrada_at, estado: s.estado, fondo_inicial: s.fondo_inicial, efectivo_contado: s.efectivo_contado, cerrada_por: s.cerrada_por ?? null })
const stripMov = (m: LocalMovimiento) => ({ movimiento_uuid: m.movimiento_uuid, sesion_uuid: m.sesion_uuid, tipo: m.tipo, moneda: m.moneda, importe: m.importe, motivo: m.motivo, fecha: m.fecha })

interface FilaArqueo { fondo: number; ventas: number; salidas: number; entradas: number; esperado: number }
/**
 * EL ARQUEO de un turno. Por moneda: qué debería haber en la gaveta.
 *
 * `esperado = fondo + ventas EN EFECTIVO + entradas − salidas`. La clave es «en efectivo»:
 * comparar lo contado contra el total vendido —que es lo que hacía la fórmula del descuadre
 * que ya se exportaba— le exige a la gaveta el dinero de las transferencias, que nunca pasó
 * por ella; con un solo cobro por Transfermóvil el arqueo salía descuadrado sin que nada
 * estuviera mal.
 *
 * Fuera del componente y sin estado, a propósito: la pantalla lo pide del turno en curso y
 * el resumen compartible del turno que se acaba de cerrar. Con una copia por sitio, tarde o
 * temprano el texto que se manda por WhatsApp y lo que enseña la caja dejan de coincidir.
 * `tks` llega ya filtrado al turno y sin ANULADO; `mvs`, filtrado al turno.
 */
function arqueoDe(ses: LocalSesion, tks: LocalTicket[], mvs: LocalMovimiento[]): Map<string, FilaArqueo> {
  const filas = new Map<string, FilaArqueo>()
  const de = (m: string): FilaArqueo => filas.get(m) ?? { fondo: 0, ventas: 0, salidas: 0, entradas: 0, esperado: 0 }

  for (const [m, v] of Object.entries(ses.fondo_inicial ?? {})) filas.set(m, { ...de(m), fondo: Number(v) || 0 })
  for (const t of tks) {
    if ((t.medio_pago ?? 'Efectivo') !== 'Efectivo') continue
    filas.set(t.moneda, { ...de(t.moneda), ventas: round2(de(t.moneda).ventas + Number(t.total)) })
  }
  for (const mv of mvs) {
    const f = de(mv.moneda)
    filas.set(mv.moneda, mv.tipo === 'SALIDA'
      ? { ...f, salidas: round2(f.salidas + mv.importe) }
      : { ...f, entradas: round2(f.entradas + mv.importe) })
  }
  for (const [m, f] of filas) filas.set(m, { ...f, esperado: round2(f.fondo + f.ventas + f.entradas - f.salidas) })
  return filas
}
/** Lo tecleado por una persona: acepta coma decimal, que es como se escribe aquí. */
const num = (s: string): number => { const n = parseFloat((s ?? '').replace(',', '.')); return isNaN(n) ? 0 : n }


export default function PuntoVentaApp() {
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
  const [movs, setMovs]         = useState<LocalMovimiento[]>([])

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
  const [fondo, setFondo]     = useState<Record<string, string>>({})   // al ABRIR el turno
  const [cerradaPor, setCerradaPor] = useState('')
  const [confirmarCierre, setConfirmarCierre] = useState(false)
  const [salidaOpen, setSalidaOpen] = useState(false)
  const [salida, setSalida]   = useState({ moneda: '', importe: '', motivo: '' })
  const [pagaCon, setPagaCon] = useState('')                            // calculadora de cambio
  const [pagando, setPagando] = useState(false)                         // paso de cobro
  const [resumenVisible, setResumenVisible] = useState(false)
  const [qtyEdit, setQtyEdit] = useState<{ key: string; valor: string } | null>(null)
  const [anular, setAnular]   = useState<LocalTicket | null>(null)
  const [tema, setTema]       = useState<Tema>('auto')
  // La hoja del ticket. Se abre sola al añadir el primer artículo —ver el efecto de
  // abajo— porque a nadie hay que enseñarle a desplegarla en mitad de una venta.
  const [sheetOpen, setSheetOpen] = useState(false)
  // En pantalla ancha el ticket NO es una hoja: es la columna de la derecha, siempre
  // abierta. Ahí la cabecera tiene que ser un título y no un botón — si sigue siendo
  // botón, se pliega al tocarla (y con lector de pantalla se anuncia «plegar el
  // ticket», que es mentira). Empieza en `false` y se resuelve al montar, que es lo
  // que hidrata igual en servidor y cliente.
  const [esColumna, setEsColumna] = useState(false)
  const [msg, setMsg]         = useState<{ t: 'ok' | 'err' | 'warn'; x: string } | null>(null)
  const [busy, setBusy]       = useState(false)
  // Cuándo se bajó el catálogo y cuándo se subió lo vendido. Los dos viven en `meta`
  // (IndexedDB), así que sobreviven al cierre de la app y se leen sin conexión.
  const [seedAt, setSeedAt]   = useState<string | null>(null)
  const [syncAt, setSyncAt]   = useState<string | null>(null)
  /**
   * ACUSE DE RECIBO del último envío, y sobrevive a recargar la app.
   *
   * Sin esto, la sincronización automática subía las ventas **sin decir nada** (es
   * silenciosa a propósito: un banner a media venta desplaza la pantalla). El cajero, que
   * sabía que tenía 3 ventas esperando, entraba después en Sincronizar, leía «no hay nada
   * que sincronizar» y lo daba por un fallo — cuando era lo contrario: ya estaban arriba.
   * Un cero sin explicación no se distingue de un cero por avería, y en Cuba, donde la
   * conexión va y viene, esa duda es lo que hace que nadie se fíe de la pantalla.
   */
  const [ultimoEnvio, setUltimoEnvio] = useState<{ at: string; ventas: number; cierres: number; movs: number } | null>(null)
  /**
   * VENTAS QUE CLAUX NO ACEPTÓ. Persistente, no un toast: el envío automático es
   * silencioso, y un rechazo que solo se ve si mirabas la pantalla en ese segundo es un
   * rechazo que nadie ve. Se limpia solo en cuanto una sincronización entra entera.
   */
  const [rechazo, setRechazo] = useState<{ at: string; n: number } | null>(null)
  /**
   * Intentos de sincronizar seguidos que se han quedado en nada POR CONEXIÓN, y cuándo
   * salió el último archivo. De estos dos depende que el `.json` se enseñe o no.
   *
   * El archivo es la salida de emergencia, no una forma normal de trabajar: puesto al lado
   * de «Sincronizar ahora» invita a descargarlo cada día, y cada archivo suelto es un lote
   * que alguien tiene que acordarse de subir. Aparece cuando de verdad hace falta —dos
   * intentos fallidos— y se retira solo en cuanto una sincronización entra.
   */
  const [fallosSync, setFallosSync] = useState(0)
  const [exportAt, setExportAt] = useState<string | null>(null)
  /**
   * QUÉ está haciendo la caja ahora mismo, en palabras. `busy` apagaba los botones y nada
   * más: en un móvil viejo con la red de aquí, entre pulsar «Sincronizar» y ver el
   * resultado pasan varios segundos con la pantalla idéntica — y lo que hace cualquiera
   * es volver a pulsar, o dar por hecho que no funcionó. Siempre que la caja tenga que
   * esperar a algo, lo dice: una franja con su rueda y la etiqueta de lo que está pasando.
   */
  const [cargando, setCargando] = useState<string | null>(null)
  /**
   * EL RESUMEN DEL ÚLTIMO CIERRE, ya escrito y guardado.
   *
   * Aquí estaba el fallo de fondo: el resumen se armaba en vivo a partir de `sesion`,
   * `contado` y `cerradaPor`, y **cerrar el turno se lleva los tres** —`cerrarTurno` limpia
   * los dos últimos y la sesión deja de ser la abierta—. O sea que el texto solo existía
   * mientras el turno estaba abierto, que es cuando todavía no hay nada que contar: el
   * arqueo salía sin la línea de «contado» y sin descuadre. Y en el único momento en que
   * de verdad se quiere mandar —recién cerrado— el botón ni siquiera aparecía.
   * Se escribe AL CERRAR, con las cifras delante, y se guarda en IndexedDB para que
   * sobreviva a recargar la app.
   */
  const [resumenCierre, setResumenCierre] = useState<string | null>(null)

  // Sin caída a «todas las monedas del cliente»: solo se cobra en las que Claux mandó,
  // que ya vienen filtradas a las que tienen caja de Tesorería asignada.
  const monedas = config?.caja.monedas_aceptadas ?? []
  const simbolo = (m: string) => config?.monedas.find(x => x.codigo === m)?.simbolo ?? m
  const precioDe = (p: Producto) => Number(p.precios?.[moneda] ?? 0)
  // El producto no tiene precio guardado en la moneda actual (no inventamos conversión).
  const sinPrecioProd = (p: Producto) => p.precios?.[moneda] == null
  const lineaSinPrecio = (l: CartLine) => l.producto_id != null && productos.find(p => p.producto_id === l.producto_id)?.precios?.[moneda] == null
  const cartInvalido = cart.some(lineaSinPrecio)
  const cartTotal = round2(cart.reduce((s, l) => s + l.cantidad * l.precio_unitario, 0))

  const sesion = useMemo(() => sesiones.find(s => s.estado === 'ABIERTA') ?? null, [sesiones])
  // Lo que cuenta como TRABAJO PENDIENTE de enviar. La sesión abierta viaja con el lote
  // (ver `sincronizar`) pero NO se cuenta aquí: un turno en curso no es un pendiente, y
  // pintar «1 cierre sin enviar» durante toda la jornada es enseñar una alarma que no lo es.
  const pend = useMemo(() => {
    const sinEnviar = tickets.filter(t => !t.synced)
    return {
      tickets: sinEnviar.length,
      // Cuántas de las que esperan son ANULACIONES. Una anulación tiene que subir —si no,
      // Claux se quedaría con la venta buena y con la mala—, pero **no viaja como venta**:
      // el cierre las excluye del total. Sin decirlo, «2 ventas sin enviar» después de
      // rectificar una da a entender que se va a cobrar dos veces.
      anuladas: sinEnviar.filter(t => (t.estado ?? 'VIGENTE') === 'ANULADO').length,
      cierres: sesiones.filter(s => s.estado === 'CERRADA' && !s.synced).length,
      // Las salidas y entradas de efectivo cuentan igual que una venta. Se quedaron fuera
      // al añadirlas: el envío SÍ las llevaba, pero la pantalla no las veía, así que sacar
      // dinero de la gaveta dejaba el panel diciendo «Todo enviado» con el movimiento
      // todavía dentro del móvil, y el botón apagado. Y ese movimiento es justo lo que
      // resta en el efectivo esperado del arqueo.
      movs: movs.filter(m => !m.synced).length,
    }
  }, [tickets, sesiones, movs])
  // Antigüedad de lo que está esperando: el badge decía «3» sin decir desde cuándo, y
  // «3 ventas de hace ocho días» es otra cosa que «3 de hace diez minutos».
  const diasSinEnviar = useMemo(() => {
    const viejos = tickets.filter(t => !t.synced)
    if (!viejos.length) return 0
    const antiguo = viejos.reduce((a, t) => (t.fecha < a ? t.fecha : a), viejos[0].fecha)
    return diasDeCalendario(antiguo)
  }, [tickets])
  // La FECHA de lo más viejo que espera, no solo cuántos días. «Quedan 8 ventas del 4 de
  // agosto» sitúa al dueño en una jornada concreta; «de hace 2 días» le obliga a contar.
  const fechaMasAntigua = useMemo(() => {
    const viejos = tickets.filter(t => !t.synced)
    if (!viejos.length) return null
    return viejos.reduce((a, t) => (t.fecha < a ? t.fecha : a), viejos[0].fecha)
  }, [tickets])
  /**
   * Lo que YA está arriba. El contrapeso de `pend`: sin esto, la pantalla de sincronizar
   * en reposo decía «0 · Todo enviado» y nada más, y quien acababa de vender lo leía como
   * «no se ha subido nada» — o peor, como que hay que cerrar el turno para que suba.
   * Con las ventas del turno ya enviadas escritas al lado, el cero se entiende.
   */
  const yaEnviado = useMemo(() => {
    if (!sesion) return { ventas: 0, turno: false }
    return {
      ventas: tickets.filter(t => t.sesion_uuid === sesion.sesion_uuid && t.synced && (t.estado ?? 'VIGENTE') !== 'ANULADO').length,
      turno: sesion.synced === true,
    }
  }, [tickets, sesion])

  /**
   * Ventas del turno. **Los ANULADO quedan fuera**, que es lo que se vendió de verdad.
   *
   * Sin ese filtro, rectificar una venta la contaba DOS veces: la original anulada y su
   * corrección. La pantalla decía «2 ventas · 6.300 CUP» con el arqueo justo debajo
   * diciendo 3.150, y ese 6.300 era además el número que se iba en el resumen del turno
   * por WhatsApp y en el diálogo de cerrar. El servidor siempre lo hizo bien (la ingesta
   * excluye los anulados desde la mig. 091), así que la contabilidad nunca estuvo mal:
   * mentía el dispositivo, que es donde se mira.
   */
  const ventasTurno = useMemo(() => {
    const m = new Map<string, { count: number; total: number }>()
    if (!sesion) return m
    for (const t of tickets) {
      if (t.sesion_uuid !== sesion.sesion_uuid) continue
      if ((t.estado ?? 'VIGENTE') === 'ANULADO') continue
      const e = m.get(t.moneda) ?? { count: 0, total: 0 }
      e.count += 1; e.total += Number(t.total); m.set(t.moneda, e)
    }
    return m
  }, [tickets, sesion])
  const ventasTurnoN = useMemo(() => [...ventasTurno.values()].reduce((s, v) => s + v.count, 0), [ventasTurno])

  /**
   * EL ARQUEO. Por moneda: qué debería haber en la gaveta y qué hay.
   *
   * La clave está en `soloEfectivo`. Comparar lo contado contra el total vendido —que es lo
   * que hacía la fórmula del descuadre que ya se exportaba— le exige a la gaveta el dinero
   * de las transferencias, que nunca pasó por ella: con un solo cobro por Transfermóvil, el
   * arqueo salía descuadrado sin que nada estuviera mal. Aquí solo cuenta el EFECTIVO.
   *
   * esperado = fondo + ventas en efectivo + entradas − salidas
   */
  // La pantalla usa el del turno en curso; el RESUMEN necesita poder calcularlo el de un
  // turno concreto —el que se acaba de cerrar—, así que el cálculo vive en `arqueoDe`,
  // fuera del componente y sin estado. Una sola fórmula para los dos, que es lo que impide
  // que la pantalla y el texto que se manda por WhatsApp digan cosas distintas.
  const arqueo = useMemo(() => {
    if (!sesion) return new Map<string, FilaArqueo>()
    return arqueoDe(
      sesion,
      tickets.filter(t => t.sesion_uuid === sesion.sesion_uuid && (t.estado ?? 'VIGENTE') !== 'ANULADO'),
      movs.filter(m => m.sesion_uuid === sesion.sesion_uuid),
    )
  }, [sesion, tickets, movs])

  const reload = useCallback(async () => {
    const [tks, sess, mvs] = await Promise.all([getTickets(), getSesiones(), getMovimientos()])
    setTickets(tks); setSesiones(sess); setMovs(mvs)
  }, [])

  // El toast se va solo. Antes se quedaba en pantalla hasta que cambiabas de pestaña, así
  // que «Cobrado CUP 300» seguía ahí durante la venta siguiente y dejaba de leerse. Los
  // errores duran más: son los que hay que llegar a leer.
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), msg.t === 'ok' ? 4000 : 7000)
    return () => clearTimeout(t)
  }, [msg])

  // Puente al `sincronizar` de este render, para que los oyentes registrados al montar
  // (evento `online`) llamen siempre a la versión actual y no a la del primer render.
  const sincronizarRef = useRef<(silencioso?: boolean) => Promise<void>>(async () => {})

  // ── Arranque ──
  useEffect(() => {
    let cancelled = false
    /**
     * NO hay sincronización automática al arrancar ni al recuperar la conexión.
     *
     * Las hubo, y el motivo por el que se van es Cuba: aquí la señal va y viene decenas de
     * veces al día, así que el evento `online` disparaba un envío cada vez que parpadeaba
     * —y durante un turno con ventas siempre hay algo que mandar, o sea que cada parpadeo
     * era una petición pagada—. El arranque tenía el mismo problema en menor escala.
     *
     * Queda **un solo envío automático: el del cierre de turno** (`cerrarTurno`), que es el
     * momento en que el trabajo está terminado y hay una persona delante. Lo demás es el
     * botón manual, que se puede pulsar las veces que haga falta sin duplicar nada.
     *
     * Lo que sustituye a la red de seguridad que se pierde: **se dice**. La pantalla de
     * abrir turno enseña lo que quedó sin sincronizar y desde cuándo, con su botón; el
     * punto rojo del nav sigue encendido; y el portal avisa a los 7/15/30 días.
     */
    ;(async () => {
      let tk: string | null = null
      const m = window.location.hash.match(/[#&]t=([^&]+)/)
      // Se limpia SOLO el fragmento (el token). La query se conserva: en `?c=` viaja la
      // identidad del punto, de la que dependen el nombre de la app instalada y su manifest.
      if (m) { tk = decodeURIComponent(m[1]); await metaSet('token', tk); history.replaceState(null, '', window.location.pathname + window.location.search) }
      tk = tk ?? (await metaGet<string>('token')) ?? null
      let cfg = (await metaGet<CajaConfig>('config')) ?? null
      const teniaCache = !!cfg
      let prods = await getProductos()
      if (tk && !cfg && navigator.onLine) {
        try { const s = await fetchSeed(tk); cfg = s.config; prods = s.productos; await metaSet('config', cfg); await saveProductos(prods); await metaSet('seed_at', new Date().toISOString()) } catch { /* offline */ }
      }
      if (cancelled) return
      setToken(tk); setConfig(cfg); setProds(prods)
      setMoneda(monedaPorDefecto(cfg))
      setOnline(navigator.onLine)
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
      setStandalone(isStandalone)
      setDismissed((await metaGet<boolean>('install_dismissed')) === true)
      setSeedAt((await metaGet<string>('seed_at')) ?? null)
      setTema((await metaGet<Tema>('tema')) ?? 'auto')
      setSyncAt((await metaGet<string>('sync_at')) ?? null)
      setUltimoEnvio((await metaGet<{ at: string; ventas: number; cierres: number; movs: number }>('sync_last')) ?? null)
      setRechazo((await metaGet<{ at: string; n: number }>('sync_rechazo')) ?? null)
      setFallosSync((await metaGet<number>('sync_fallos')) ?? 0)
      setExportAt((await metaGet<string>('export_at')) ?? null)
      setResumenCierre((await metaGet<string>('resumen_cierre')) ?? null)
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
          const ahora = new Date().toISOString(); await metaSet('seed_at', ahora)
          setConfig(s.config); setProds(s.productos); setSeedAt(ahora)
          // La semilla puede haber retirado la moneda que estaba seleccionada; seguir
          // cobrando en ella produce una venta que el cierre NO podrá contabilizar.
          setMoneda(prev => (s.config.caja.monedas_aceptadas ?? []).includes(prev) ? prev : monedaPorDefecto(s.config))
        } catch { /* seguimos con lo cacheado */ }
      }
    })()
    // Los oyentes se quedan SOLO para el chip de «En línea»: ya no disparan ningún envío.
    const on = () => setOnline(true), off = () => setOnline(false)
    const bip = (e: Event) => { e.preventDefault(); setInstallEvt(e as InstallPromptEvent) }
    const installed = () => { setStandalone(true); setInstallEvt(null) }
    window.addEventListener('online', on); window.addEventListener('offline', off); window.addEventListener('beforeinstallprompt', bip); window.addEventListener('appinstalled', installed)
    return () => { cancelled = true; window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('beforeinstallprompt', bip); window.removeEventListener('appinstalled', installed) }
  }, [reload])

  // Mismo umbral que el CSS (720px = tablet en vertical o móvil en horizontal). Se sigue
  // en vivo porque girar el teléfono cruza ese umbral sin recargar nada.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 720px)')
    const aplicar = () => setEsColumna(mq.matches)
    aplicar()
    mq.addEventListener('change', aplicar)
    return () => mq.removeEventListener('change', aplicar)
  }, [])

  // ── Turno ──
  //
  // Deja el mostrador como recién abierto: sin ticket a medias, sin rectificación colgando
  // y sin la hoja del ticket desplegada. Lo usan abrir y cerrar turno, que son los dos
  // momentos en que lo que hubiera empezado deja de tener dónde cobrarse.
  function limpiarTicket() {
    setCart([]); setRectiUuid(null); setPagaCon(''); setSheetOpen(false); setPagando(false)
  }
  //
  // **El fondo inicial se pide al ABRIR.** La columna existía desde el primer día y nadie
  // la escribía nunca, así que el arqueo comparaba el dinero contado contra las ventas — y
  // el fondo con el que se abre la gaveta para dar cambio salía siempre como descuadre.
  async function abrirTurno() {
    if (busy) return
    setBusy(true); setCargando('Abriendo el turno…')
    try {
      const inicial: Record<string, number> = {}
      for (const [k, v] of Object.entries(fondo)) { const n = num(v); if (n > 0) inicial[k] = n }
      const ses: LocalSesion = { sesion_uuid: uid(), abierta_at: new Date().toISOString(), cerrada_at: null, estado: 'ABIERTA', fondo_inicial: inicial, efectivo_contado: {}, synced: false }
      // Sin toast: la pantalla pasa al mostrador y el chip de la cabecera dice «Turno
      // abierto». Un mensaje que repite lo que ya se ve es ruido que además tapa sitio.
      await putSesion(ses); await reload(); setFondo({}); setVista('vender')
      // Un turno EMPIEZA VACÍO. El carrito se guarda en `meta.carrito` para que un apagón
      // no se lleve la venta a medias, pero esa red de seguridad vale dentro del turno:
      // restaurado en el siguiente, aparecen dos artículos de ayer en el ticket y se
      // cobran hoy, en otro turno y en otro arqueo. Se limpia aquí además de al cerrar,
      // porque así también sale de en medio lo que dejó una versión anterior.
      limpiarTicket()
    } finally { setBusy(false); setCargando(null) }
  }

  // Salida o entrada de efectivo del turno: se pagó al proveedor, el dueño retiró, se metió
  // cambio. Es la otra mitad de por qué una caja no cuadra, y hasta ahora no existía.
  async function registrarSalida() {
    if (!sesion || busy) return
    const importe = num(salida.importe)
    if (importe <= 0)          { setMsg({ t: 'err', x: 'Pon un importe.' }); return }
    if (!salida.motivo.trim()) { setMsg({ t: 'err', x: 'Di para qué salió el dinero.' }); return }
    setBusy(true); setCargando('Registrando la salida…')
    try {
      await putMovimiento({
        movimiento_uuid: uid(), sesion_uuid: sesion.sesion_uuid,
        tipo: 'SALIDA', moneda: salida.moneda || moneda,
        importe, motivo: salida.motivo.trim(), fecha: new Date().toISOString(), synced: false,
      })
      await reload()
      setSalida({ moneda: '', importe: '', motivo: '' }); setSalidaOpen(false)
      setMsg({ t: 'ok', x: 'Salida de efectivo registrada.' })
    } finally { setBusy(false); setCargando(null) }
  }

  async function cerrarTurno() {
    if (!sesion || busy) return
    setConfirmarCierre(false)
    setBusy(true); setCargando('Cerrando el turno…')
    try {
      const efectivo: Record<string, number> = {}
      for (const [k, v] of Object.entries(contado)) { const n = num(v); if (v.trim() !== '') efectivo[k] = n }
      const cerrada = { ...sesion, cerrada_at: new Date().toISOString(), estado: 'CERRADA' as const,
        efectivo_contado: efectivo, cerrada_por: cerradaPor.trim() || null, synced: false }
      await putSesion(cerrada)
      // El resumen se escribe AQUÍ, con `contado` y `cerradaPor` todavía llenos: dos líneas
      // más abajo se vacían, y calcularlo después daba un arqueo sin dinero contado.
      const texto = resumenTurno(cerrada, contado, cerradaPor)
      await metaSet('resumen_cierre', texto); setResumenCierre(texto)
      // Lo que quedara empezado se descarta: el turno donde se iba a cobrar ya no existe.
      await reload(); setContado({}); setCerradaPor(''); limpiarTicket(); setVista('sync')
      setMsg(navigator.onLine
        ? { t: 'ok', x: 'Turno cerrado. Sincronizando…' }
        : { t: 'warn', x: 'Turno cerrado. Sincronízalo cuando tengas conexión.' })
    } finally { setBusy(false); setCargando(null) }
    // **El único envío automático que queda.** Cerrar es el momento en que la venta puede
    // llegar a la contabilidad, y hay una persona delante mirando la pantalla — así que va
    // EN VOZ ALTA (`false`), no en silencio: su resultado sustituye al «Sincronizando…» de
    // arriba y es el acuse que el cajero necesita para irse tranquilo. Sin conexión no
    // pasa nada: queda pendiente, lo dice el punto rojo y el cartel del próximo turno.
    if (navigator.onLine) void sincronizarRef.current(false)
  }

  // Anular una venta entera. Rectificar sirve para CORREGIRLA, pero `cobrar()` exige
  // carrito con líneas, así que un cobro hecho por error —el clásico doble toque— no se
  // podía deshacer de ninguna forma. Deja el mismo rastro que una rectificación: el ticket
  // no se borra, se marca ANULADO y sale del neto que va a Tesorería e Inventario.
  async function anularVenta(t: LocalTicket) {
    if (busy) return
    setAnular(null)
    setBusy(true); setCargando('Anulando la venta…')
    try {
      await putTicket({ ...t, estado: 'ANULADO', synced: false })
      await reload()
      setMsg({ t: 'ok', x: `Venta anulada (${simbolo(t.moneda)} ${money(t.total)}).` })
    } finally { setBusy(false); setCargando(null) }
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
  /** Cantidad tecleada de golpe. Cero o menos quita la línea, igual que bajar con el «−». */
  function setQty(key: string, n: number) {
    setCart(prev => prev.flatMap(l => l.key !== key ? [l] : (n <= 0 ? [] : [{ ...l, cantidad: n }])))
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
    setBusy(true); setCargando('Registrando el cobro…')
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
      setCart([]); setRectiUuid(null); setPagaCon(''); setSheetOpen(false); setPagando(false)
      // **La moneda vuelve siempre a la de por defecto (CUP).** Se quedaba pegada a la de
      // la última venta, así que después de cobrar en EUR la siguiente empezaba en EUR y
      // el vendedor tenía que acordarse de cambiarla. En un mostrador cubano la moneda
      // normal es una y las demás son la excepción: la excepción se elige, no se hereda.
      setMoneda(monedaPorDefecto(config))
      setMsg({ t: 'ok', x: esRecti ? `Rectificado · nuevo total ${simbolo(moneda)} ${money(total)}` : `Cobrado ${simbolo(moneda)} ${money(total)}` })
    } catch { setMsg({ t: 'err', x: 'No se pudo registrar el cobro.' }) }
    finally { setBusy(false); setCargando(null) }
  }

  // ── Sync / export / productos / instalar ──
  //
  // **El turno ABIERTO viaja con el lote, y ese es el arreglo de fondo del módulo.**
  // Antes solo subían los turnos CERRADA, y como los resúmenes a Tesorería, `gastos_cobros`
  // e Inventario los escribe el CIERRE, un turno que nadie cerraba —se acabó la batería, se
  // fue la luz, el cajero se marchó— dejaba sus ventas fuera de la contabilidad PARA
  // SIEMPRE: visibles en Operaciones, ausentes del informe, y sin que ninguna pantalla lo
  // dijera. Mandando la sesión abierta el servidor sabe que el turno existe, puede avisar de
  // que lleva días sin cerrar y el dueño puede rescatarlo desde el portal.
  // Son ~200 bytes dentro del POST que ya lleva los tickets: coste de datos adicional, cero.
  //
  // `silencioso` = intento automático (evento `online`, arranque, cierre de turno): no pinta
  // banners —uno a media venta desplaza la pantalla— ni bloquea `busy`, que apagaría el
  // botón de Cobrar. El acuse de recibo es el badge bajando a cero y la línea de «última
  // sincronización». `enviandoRef` impide que el automático y el manual se pisen.
  const enviandoRef = useRef(false)
  // Un intento que no llega a Claux teniendo trabajo pendiente. Se cuenta también el
  // automático —que es la mayoría— porque es justo el que revela que este dispositivo no
  // está viendo la red, y es lo que decide si aparece el archivo.
  const anotarFallo = async () => {
    const n = fallosSync + 1
    await metaSet('sync_fallos', n); setFallosSync(n)
  }
  /**
   * @param silencioso solo silencia los MENSAJES; nunca decide si se envía o no.
   *
   * Dos cosas que aquí se hicieron mal y costaron un rato:
   *
   * 1. **Lo que se manda se lee de IndexedDB, no del estado de React.** `cerrarTurno`
   *    llama a esta función justo después de escribir el cierre, en el mismo microtask, o
   *    sea **antes de que React haya re-renderizado**: el `sincronizar` al que apunta el
   *    puente sigue siendo el del render anterior, con la sesión todavía ABIERTA y marcada.
   *    Leyendo de la base no hay closure que se quede viejo — y es la fuente de verdad.
   *
   * 2. **Ya no se mira `busy`.** La guarda era `busy && !silencioso`, y por eso el envío
   *    del cierre funcionaba en silencio y dejó de funcionar al pasarlo a voz alta: en ese
   *    instante `busy` seguía valiendo `true` en el closure, así que salía por la puerta de
   *    atrás sin decir nada y el «Sincronizando…» se quedaba clavado para siempre.
   *    Contra el doble envío basta `enviandoRef`, que es lo que de verdad lo impide; y el
   *    botón manual ya está `disabled` mientras haya algo en marcha.
   */
  async function sincronizar(silencioso = false) {
    const aviso = (m: { t: 'ok' | 'err' | 'warn'; x: string }) => { if (!silencioso) setMsg(m) }
    if (!token) { aviso({ t: 'err', x: 'Punto de venta no configurado.' }); return }
    if (enviandoRef.current) return
    enviandoRef.current = true
    if (!silencioso) setBusy(true)
    setCargando('Sincronizando con Claux…')
    try {
      const [tksAll, sessAll, mvsAll] = await Promise.all([getTickets(), getSesiones(), getMovimientos()])
      const tks  = tksAll.filter(t => !t.synced)
      const sess = sessAll.filter(s => !s.synced)   // incluye el turno abierto
      const mvs  = mvsAll.filter(m => !m.synced)
      const hayPendiente = tks.length > 0 || sess.length > 0 || mvs.length > 0
      if (!navigator.onLine) {
        if (hayPendiente) await anotarFallo()
        aviso({ t: 'warn', x: 'Sin conexión. Vuelve a intentarlo cuando tengas señal.' })
        return
      }
      if (!hayPendiente) { aviso({ t: 'ok', x: 'Todo sincronizado.' }); return }
      const res = await fetch('/punto-de-venta/api/sync', { method: 'POST', headers: { 'content-type': 'application/json', 'x-caja-token': token }, body: JSON.stringify({ tickets: tks.map(stripTicket), cierres: sess.map(stripSesion), movimientos: mvs.map(stripMov) }) })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j?.error || 'sync')

      /**
       * SOLO SE MARCA LO QUE EL SERVIDOR ACEPTÓ. Aquí se perdía dinero, en silencio.
       *
       * La ingesta no lanza cuando un ticket falla —moneda que el punto ya no acepta,
       * fecha fuera de rango, cualquier error de la base—: lo apunta y sigue, para que uno
       * malo no tumbe el lote. Y la ruta devolvía `ok: true` pasara lo que pasara. Como
       * aquí se marcaba TODO lo enviado, la venta rechazada desaparecía de la cola del
       * móvil sin haber llegado nunca a Claux, y la caja se quedaba diciendo «Todo
       * sincronizado». No había ningún sitio donde se pudiera ver que faltaba.
       *
       * `rechazados` viene con los uuid que no entraron; esos NO se marcan, así que
       * siguen contando como pendientes y se reintentan en la siguiente sincronización.
       */
      const rechazados = new Set<string>(Array.isArray(j.resultado?.rechazados) ? j.resultado.rechazados : [])
      const okTks  = tks.filter(t => !rechazados.has(t.ticket_uuid))
      const okSess = sess.filter(s => !rechazados.has(s.sesion_uuid))
      const okMvs  = mvs.filter(m => !rechazados.has(m.movimiento_uuid))
      // Se marcan también las abiertas: al cerrarlas, `putSesion` vuelve a dejarlas sin
      // marcar (invariante de `punto-venta-db.ts`), así que su cierre sube igual y no hay
      // que reenviar el turno entero en cada sincronización.
      await markTicketsSynced(okTks.map(t => t.ticket_uuid)); await markSesionesSynced(okSess.map(s => s.sesion_uuid))
      await markMovimientosSynced(okMvs.map(m => m.movimiento_uuid))
      const ahora = new Date().toISOString(); await metaSet('sync_at', ahora); setSyncAt(ahora)
      // Entró: se borra la racha de fallos y el rastro del archivo. Lo que se hubiera
      // exportado ya está aquí —por uuid, sin duplicar—, así que el `.json` vuelve a
      // guardarse hasta que la conexión vuelva a fallar.
      await metaSet('sync_fallos', 0); setFallosSync(0)
      await metaSet('export_at', null); setExportAt(null)
      await reload()
      // Los cierres se cuentan de lo que se ACEPTÓ cerrado, no de `sess`: ahí va también el
      // turno abierto, y decir «1 cierre» de un turno en curso sería mentir.
      const cerradosEnviados = okSess.filter(s => s.estado === 'CERRADA').length
      // El acuse queda GUARDADO, no solo en un toast: el envío automático no pinta toast, y
      // aunque lo pintara, se va. Esto es lo que después explica el cero de la pantalla.
      const recibo = { at: ahora, ventas: okTks.length, cierres: cerradosEnviados, movs: okMvs.length }
      await metaSet('sync_last', recibo); setUltimoEnvio(recibo)
      // El rechazo se dice SIEMPRE, aunque el envío fuera automático: es dinero que no ha
      // entrado en Claux, y callarlo en una sincronización silenciosa es exactamente el
      // agujero que se acaba de tapar. Se guarda además para que se vea al volver.
      if (rechazados.size > 0) {
        /**
         * DOS MENSAJES, y ninguno técnico. Aquí se llegó a enseñar en pantalla
         * `cierre dcdcf4dd-…: TypeError: fetch failed` junto a «hay algo mal configurado»,
         * cuando lo único que pasaba era que se había caído la red. Los textos de
         * `errores` llevan uuids y excepciones: son para el dueño en el portal, donde se
         * puede actuar sobre ellos. Al mostrador solo le sirven dos frases —o falta
         * conexión, o hay algo que revisar—, y solo la segunda pide hacer algo.
         */
        const porRed = j.resultado?.rechazo_motivo === 'CONEXION'
        await metaSet('sync_rechazo', porRed ? null : { at: ahora, n: rechazados.size })
        setRechazo(porRed ? null : { at: ahora, n: rechazados.size })
        if (porRed) { await anotarFallo(); aviso({ t: 'warn', x: 'No se pudo completar. Vuelve a intentarlo.' }) }
        else setMsg({ t: 'warn', x: `${rechazados.size} ${rechazados.size === 1 ? 'venta no se pudo registrar' : 'ventas no se pudieron registrar'}. Revísalo en Claux.` })
      } else {
        await metaSet('sync_rechazo', null); setRechazo(null)
        aviso({ t: 'ok', x: `Sincronizado: ${j.resultado?.tickets_nuevos ?? okTks.length} ventas, ${j.resultado?.cierres_posteados ?? cerradosEnviados} cierres.` })
      }
    } catch { await anotarFallo(); aviso({ t: 'err', x: 'No se pudo sincronizar. Inténtalo de nuevo.' }) }
    finally { enviandoRef.current = false; if (!silencioso) setBusy(false); setCargando(null) }
  }
  // El puente se refresca tras cada render (sin lista de dependencias a propósito): los
  // oyentes se registran una vez al montar y tienen que llamar al `sincronizar` de ahora,
  // con los tickets y la sesión de ahora.
  useEffect(() => { sincronizarRef.current = sincronizar })

  /**
   * EL ARCHIVO. La salida de emergencia cuando la conexión no aparece.
   *
   * **No marca nada como sincronizado**, y es deliberado: el dispositivo no tiene forma de
   * saber si ese archivo llegó a subirse, y marcarlo por si acaso es exactamente cómo se
   * pierde una venta —el fallo que ya costó caro—. Así que las ventas siguen en la cola y
   * el aviso sigue encendido. Lo que sí se guarda es que el archivo SALIÓ, para poder
   * decir que quizá ya esté arriba y que volver a sincronizar no duplica: la ingesta
   * reconoce cada venta por su uuid, venga por archivo o por red.
   */
  async function exportar() {
    const tks  = tickets.filter(t => !t.synced)
    const sess = sesiones.filter(s => !s.synced)   // el turno abierto también, como en el envío
    const mvs  = movs.filter(m => !m.synced)
    if (!tks.length && !sess.length && !mvs.length) { setMsg({ t: 'ok', x: 'No hay nada pendiente de exportar.' }); return }
    const payload = { caja: config?.caja.caja_id ?? null, exportado_at: new Date().toISOString(), tickets: tks.map(stripTicket), cierres: sess.map(stripSesion), movimientos: mvs.map(stripMov) }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `caja-${config?.caja.caja_id ?? 'export'}-${hoyEnTz()}.json`; a.click(); URL.revokeObjectURL(url)
    const ahora = new Date().toISOString(); await metaSet('export_at', ahora); setExportAt(ahora)
    setMsg({ t: 'ok', x: 'Archivo descargado. Súbelo en Claux → Punto de venta → Sincronizar.' })
  }
  async function actualizarProductos() {
    if (!token) return
    if (!navigator.onLine) { setMsg({ t: 'warn', x: 'Necesitas conexión para actualizar productos.' }); return }
    setBusy(true); setCargando('Bajando productos y precios…')
    try {
      const s = await fetchSeed(token)
      await metaSet('config', s.config); await saveProductos(s.productos)
      const ahora = new Date().toISOString(); await metaSet('seed_at', ahora)
      setConfig(s.config); setProds(s.productos); setSeedAt(ahora)
      // Contra las monedas NUEVAS, no contra las de antes: `monedas` es de este render.
      if (!(s.config.caja.monedas_aceptadas ?? []).includes(moneda)) setMoneda(monedaPorDefecto(s.config))
      setMsg({ t: 'ok', x: `Punto de venta actualizado: ${s.productos.length} productos y sus monedas.` })
    }
    catch { setMsg({ t: 'err', x: 'No se pudo actualizar la caja.' }) }
    finally { setBusy(false); setCargando(null) }
  }
  async function instalar() { if (!installEvt) return; await installEvt.prompt(); setInstallEvt(null); setDismissed(true) }
  async function continuarSinInstalar() { setDismissed(true); await metaSet('install_dismissed', true) }
  // Fuerza la última versión: quita el service worker y sus cachés y recarga. Las
  // ventas y la config (IndexedDB) NO se tocan. Solo online (si no, se perdería el offline).
  async function actualizarApp() {
    if (!navigator.onLine) { setMsg({ t: 'warn', x: 'Necesitas conexión para actualizar la app.' }); return }
    setBusy(true); setCargando('Actualizando la app…')
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map(r => r.unregister()))
      }
      if (typeof caches !== 'undefined') { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))) }
    } catch { /* recargamos igualmente */ }
    window.location.reload()
  }

  // ── Tema ──
  // El atributo va en `.ca-app`, que lo pinta el layout (componente de servidor), así que
  // se escribe en el DOM: es el patrón normal de un tema y no hay nada de React ahí dentro
  // que se pueda desincronizar. Se guarda en IndexedDB, no en localStorage, porque es
  // donde vive ya todo lo demás de la caja.
  useEffect(() => {
    const raiz = document.querySelector('.ca-app')
    if (!raiz) return
    if (tema === 'auto') raiz.removeAttribute('data-tema')
    else raiz.setAttribute('data-tema', tema)
  }, [tema])

  function cambiarTema() {
    // auto → claro → oscuro → auto. Tres estados y no un interruptor: «automático» es
    // la respuesta correcta la mayor parte del tiempo y tiene que poder recuperarse.
    const siguiente: Tema = tema === 'auto' ? 'claro' : tema === 'claro' ? 'oscuro' : 'auto'
    setTema(siguiente)
    void metaSet('tema', siguiente)
  }

  // La hoja del ticket se abre sola con la primera línea y se pliega al cobrar: en medio
  // de una venta nadie debería tener que descubrir que eso se despliega.
  useEffect(() => { if (cart.length === 1) setSheetOpen(true) }, [cart.length])

  // ── Carrito persistido ──
  // `useState` a secas se lo llevaba TODO: un apagón, un cierre de la app o la recarga
  // automática del service worker tras un despliegue borraban la venta a medias. En un país
  // de apagones eso no es un caso raro. Se guarda con rebote (no en cada toque) y se
  // recupera al arrancar.
  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => { void metaSet('carrito', { moneda, medioPago, rectiUuid, lineas: cart }) }, 400)
    return () => clearTimeout(t)
  }, [cart, moneda, medioPago, rectiUuid, ready])

  useEffect(() => {
    if (!ready) return
    let vivo = true
    ;(async () => {
      const g = await metaGet<{ moneda: string; medioPago: string; rectiUuid: string | null; lineas: CartLine[] }>('carrito')
      if (!vivo || !g?.lineas?.length) return
      // Solo se restaura si el carrito de ahora está vacío: si ya se empezó otra venta,
      // recuperar la vieja encima sería peor que perderla.
      setCart(prev => prev.length ? prev : g.lineas)
      if (g.moneda) setMoneda(m => m || g.moneda)
      if (g.medioPago) setMedio(g.medioPago)
      setRectiUuid(g.rectiUuid ?? null)
    })()
    return () => { vivo = false }
    // Solo al quedar lista: es una restauración, no una sincronización continua.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  // ── Render ──
  if (!ready) return <div className="ca-panel"><p className="ca-empty">Cargando caja…</p></div>

  if (!token && !config) {
    return (
      <div className="ca-gate">
        <div className="ca-gate-card">
          <div className="ca-gate-title">Punto de venta sin configurar</div>
          <p className="ca-gate-text">Abre este punto de venta desde el enlace de instalación que te dio Claux (Portal → Puntos de venta → Configurar → «Instalar en un dispositivo»). Una vez abierto con conexión, funcionará sin internet.</p>
        </div>
      </div>
    )
  }

  // Configurado pero sin ninguna moneda cobrable. Se para aquí en vez de enseñar un
  // selector vacío. Con trabajo pendiente NO se corta: primero hay que poder exportar
  // lo ya vendido, o se perdería.
  //
  // El motivo —y por tanto la instrucción— depende del módulo contratado, así que el
  // mensaje se bifurca: pedirle «asigna la caja de Tesorería» a un cliente que solo
  // tiene Punto de venta es mandarlo a arreglar algo que en su plan no existe.
  if (config && monedas.length === 0 && pend.tickets + pend.cierres === 0) {
    return (
      <div className="ca-gate">
        <div className="ca-gate-card">
          <div className="ca-gate-title">Sin monedas para cobrar</div>
          <p className="ca-gate-text">
            {config.caja.tiene_base
              ? <>Ninguna moneda de este punto de venta tiene su caja de Tesorería asignada, así
                  que las ventas no llegarían a tu contabilidad. Asígnala en Claux (Puntos de
                  venta → Configurar).</>
              : <>Este punto de venta no tiene ninguna moneda marcada. Márcala en Claux (Puntos
                  de venta → Configurar); si no tienes ninguna creada, añádela antes en Monedas
                  y tasas.</>}
            {' '}Después vuelve a abrir esto con conexión para actualizarlo.
          </p>
        </div>
      </div>
    )
  }

  // El techo de la rejilla DEJA DE SER MUDO. Con 300 referencias se pintaban las 80
  // primeras por orden alfabético y no había ninguna señal de que faltaran 220: para el
  // vendedor, esos productos no existían. La búsqueda sí recorre el catálogo entero, así
  // que lo que faltaba era decirlo.
  const prodsCoinciden = productos.filter(p => { const q = search.toLowerCase().trim(); return !q || `${p.nombre} ${p.codigo}`.toLowerCase().includes(q) })
  const prodsFiltrados = prodsCoinciden.slice(0, 80)
  const ocultos = prodsCoinciden.length - prodsFiltrados.length

  // Mostrador y servicios se separan SOLO si hay de los dos: un corte de pelo perdido
  // entre veinte champús no se encuentra. Si la caja baja de un solo tipo (lo normal),
  // se pinta la rejilla de siempre, sin encabezados que no separan nada.
  const esServicio = (p: Producto) => p.tipo === 'SERVICIO'
  const servicios  = prodsFiltrados.filter(esServicio)
  const fisicos    = prodsFiltrados.filter(p => !esServicio(p))
  const gruposProd = servicios.length > 0 && fisicos.length > 0
    ? [{ titulo: 'Servicios', items: servicios }, { titulo: 'Productos', items: fisicos }]
    : [{ titulo: '', items: prodsFiltrados }]
  const totalPend = pend.tickets + pend.cierres + pend.movs
  // Cuándo se ofrece el archivo. **Sin conexión sale a la primera**: descargarlo NO usa la
  // red —se arma desde IndexedDB, en el propio móvil—, así que esconderlo justo en el
  // momento en que es la única salida era exactamente lo contrario de lo que hace falta.
  // Con red, hay que haberlo intentado dos veces; o ya haber descargado uno.
  const mostrarArchivo = totalPend > 0 && (!online || fallosSync >= 2 || !!exportAt)
  const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
  const enApp = standalone || installDismissed

  // Ventas del día (recientes primero) y qué ticket ya tiene rectificación.
  //
  // `fechaEnTz` y NO `t.fecha.slice(0, 10)`: la fecha del ticket se guarda en UTC y Cuba va
  // cuatro o cinco horas por detrás, así que **a partir de las 20:00 hora local una venta
  // recién cobrada saltaba al día siguiente** y desaparecía de esta lista en el mismo
  // momento de hacerla — con ella, el botón de Rectificar. En un restaurante eso era el
  // servicio de cena entero.
  const hoy = hoyEnTz()
  const rectificados = new Set(tickets.filter(t => t.rectifica_a).map(t => t.rectifica_a))
  const ventasDia = tickets.filter(t => fechaEnTz(t.fecha) === hoy).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))

  /**
   * Las ventas del día PARTIDAS POR TURNO, el actual primero.
   *
   * Eran una lista corrida y el botón de Rectificar aparecía o no sin explicar por qué:
   * solo se puede rectificar dentro del turno en curso —una vez cerrado, su dinero ya
   * viajó a Tesorería y corregirlo ahí dejaría el cierre y la contabilidad diciendo cosas
   * distintas—, pero eso no se veía en ninguna parte. Un cajero que ha hecho dos turnos en
   * el día ve las mismas filas con y sin acciones y concluye que la app falla.
   * Partido por turno, el motivo está escrito en la cabecera de cada bloque.
   *
   * Código plano y NO `useMemo`, igual que `ventasDia` y `rectificados` justo encima: este
   * tramo va después de los `return` tempranos del componente (la pantalla de bienvenida y
   * la de «configura el punto»), así que un hook aquí se salta en esos renders y React
   * pierde el orden. Es un agrupamiento sobre la lista de un día: no hay nada que memorizar.
   */
  const ventasPorTurno = (() => {
    const grupos = new Map<string, { sesion_uuid: string; abierto: boolean; cerradaAt: string | null; tickets: LocalTicket[] }>()
    for (const t of ventasDia) {
      const clave = t.sesion_uuid ?? 'sin-turno'
      const g = grupos.get(clave) ?? {
        sesion_uuid: clave,
        abierto: !!sesion && t.sesion_uuid === sesion.sesion_uuid,
        // CUÁNDO se cerró. Sin la hora, «Turno cerrado» con cuatro ventas dentro no se
        // distingue del de al lado: en un día con tres turnos, todas las cabeceras eran la
        // misma palabra y había que deducir cuál era cuál por los importes.
        cerradaAt: sesiones.find(s => s.sesion_uuid === t.sesion_uuid)?.cerrada_at ?? null,
        tickets: [],
      }
      g.tickets.push(t); grupos.set(clave, g)
    }
    // El turno en curso arriba; los cerrados, el más reciente primero.
    return [...grupos.values()].sort((a, b) =>
      Number(b.abierto) - Number(a.abierto) || (b.cerradaAt ?? '').localeCompare(a.cerradaAt ?? ''))
  })()

  // ── Lo que la caja tiene que decir sin que se lo pregunten ──
  // La campana del portal la mira el dueño, casi nunca quien está en el mostrador — y
  // además necesita conexión. Estos avisos salen de lo que ya hay en IndexedDB, así que
  // funcionan con el país sin datos, que es cuando hacen falta.
  const diasTurno = sesion ? diasDeCalendario(sesion.abierta_at) : 0
  const diasSeed  = seedAt ? diasDeCalendario(seedAt) : null
  const cuantosDias = (d: number) => d === 1 ? 'desde ayer' : `desde hace ${d} días`

  // UNA franja, la más importante, y solo cuando hay algo que decir: dos avisos apilados
  // en una pantalla de cobro no se leen, se ignoran.
  const alerta =
    diasTurno >= 1
      ? `Turno abierto ${cuantosDias(diasTurno)}. Ciérralo para que la venta llegue a Claux.`
      : diasSinEnviar >= 1
        ? `${pend.tickets} ${pend.tickets === 1 ? 'venta' : 'ventas'} sin enviar ${cuantosDias(diasSinEnviar)}. Pulsa Sincronizar.`
        : null

  const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  // Con el mes escrito, para el cartel de abrir turno: ahí no se está barriendo una lista,
  // se está leyendo una frase, y «4 de agosto» se entiende sin releerla.
  const fechaLarga = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: TZ_NEGOCIO })
  const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: TZ_NEGOCIO })
  const movsTurno = sesion ? movs.filter(m => m.sesion_uuid === sesion.sesion_uuid) : []

  /**
   * El resumen del cierre, en texto plano para mandarlo por Telegram o WhatsApp.
   *
   * El dueño no está en el local, y hasta ahora cerrar el turno no producía **nada** que se
   * le pudiera enseñar: tenía que esperar a que el móvil sincronizara y entrar al portal.
   */
  function resumenTurno(ses = sesion, contadoAhora = contado, quien = cerradaPor): string {
    if (!ses) return ''
    const tks = tickets.filter(t => t.sesion_uuid === ses.sesion_uuid && (t.estado ?? 'VIGENTE') !== 'ANULADO')
    const mvs = movs.filter(m => m.sesion_uuid === ses.sesion_uuid)

    // La fecha del TURNO, no la de hoy. Estaba `new Date()`: el resumen de un cierre
    // guardado se releía al día siguiente con la fecha de ese día, y sin `timeZone` un
    // cierre de las 21:00 en Cuba se fechaba ya en el día siguiente.
    const cuando = ses.cerrada_at ?? ses.abierta_at
    const l: string[] = [
      `${config?.caja.nombre ?? 'Punto de venta'} — cierre del ${fechaLarga(cuando)}`,
      `Turno de ${hora(ses.abierta_at)}${ses.cerrada_at ? ` a ${hora(ses.cerrada_at)}` : ' (todavía abierto)'}`,
    ]

    // Ventas por moneda y, dentro, POR MEDIO DE PAGO. El desglose lo pedía el plan y
    // faltaba: sin él, quien lee el resumen no puede cuadrar el efectivo de la gaveta
    // contra el total vendido, que es justo para lo que se manda esto.
    const porMoneda = new Map<string, { n: number; total: number; medios: Map<string, number> }>()
    for (const t of tks) {
      const e = porMoneda.get(t.moneda) ?? { n: 0, total: 0, medios: new Map<string, number>() }
      const medio = t.medio_pago ?? 'Efectivo'
      e.n += 1; e.total += Number(t.total)
      e.medios.set(medio, (e.medios.get(medio) ?? 0) + Number(t.total))
      porMoneda.set(t.moneda, e)
    }
    if (porMoneda.size === 0) l.push('Sin ventas en este turno.')
    for (const [m, v] of porMoneda) {
      l.push(`${v.n} ${v.n === 1 ? 'venta' : 'ventas'} en ${m}: ${simbolo(m)} ${money(round2(v.total))}`)
      if (v.medios.size > 1) {
        for (const [medio, imp] of v.medios) l.push(`  · ${medio}: ${simbolo(m)} ${money(round2(imp))}`)
      }
    }

    // El arqueo, con el FONDO a la vista: «esperado 5.400» a secas no se puede comprobar
    // desde WhatsApp, y el fondo es la mitad de por qué ese número es ese.
    for (const [m, a] of arqueoDe(ses, tks, mvs)) {
      const escrito = (contadoAhora[m] ?? '').trim() !== ''
      const dif = escrito ? round2(num(contadoAhora[m]) - a.esperado) : null
      const detalle = `fondo ${money(a.fondo)} + ventas ${money(a.ventas)}${a.entradas ? ` + entradas ${money(a.entradas)}` : ''}${a.salidas ? ` − salidas ${money(a.salidas)}` : ''}`
      l.push(`Efectivo ${m}: esperado ${money(a.esperado)} (${detalle})`)
      if (escrito) {
        l.push(`  · contado ${money(num(contadoAhora[m]))}${dif === 0 ? ' · cuadra' : ` · ${dif! > 0 ? 'sobran' : 'faltan'} ${money(Math.abs(dif!))}`}`)
      }
    }

    // ENTRADA se imprimía como «Salida». Hoy el dispositivo solo registra salidas, pero el
    // tipo existe en la base y en la ingesta, así que la etiqueta sigue al dato.
    for (const mv of mvs) {
      l.push(`${mv.tipo === 'ENTRADA' ? 'Entrada' : 'Salida'}: ${mv.motivo ?? 'sin motivo'} — ${simbolo(mv.moneda)} ${money(mv.importe)}`)
    }
    if (quien.trim()) l.push(`Contado por ${quien.trim()}`)
    return l.join('\n')
  }

  async function compartirResumen() {
    const texto = sesion ? resumenTurno() : (resumenCierre ?? '')
    if (!texto) { setMsg({ t: 'warn', x: 'No hay resumen que compartir todavía.' }); setResumenVisible(false); return }
    try {
      // `navigator.share` es lo natural en un móvil; sin él (escritorio, navegador viejo)
      // el portapapeles hace el mismo trabajo y no deja al usuario sin salida.
      const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> }
      if (nav.share) { await nav.share({ text: texto }); return }
      await navigator.clipboard?.writeText(texto)
      setMsg({ t: 'ok', x: 'Resumen copiado. Pégalo donde quieras mandarlo.' })
    } catch { /* el usuario canceló el diálogo de compartir */ }
    finally { setResumenVisible(false) }
  }

  const gate = (
    <div className="ca-gate">
      {/* LO QUE QUEDÓ ATRÁS, aquí. Es el sitio: hay una persona delante, con calma, antes
          de empezar a cobrar — no a media venta. Y es lo que sustituye al envío automático
          de arranque que se quitó: en vez de gastar datos por si acaso, se dice y se
          decide. Con fecha, porque «del 4 de agosto» sitúa y «hace 2 días» hace contar. */}
      {totalPend > 0 && (
        <div className="ca-gate-aviso">
          {/* Texto GENERAL: lo pendiente puede ser una venta, un cierre o una salida de
              efectivo, y contar solo las ventas dejaba el cartel diciendo «Queda trabajo»
              —o cuadrando mal el verbo— justo cuando lo que faltaba era un cierre. Lo que
              hace falta saber aquí es que queda algo y de cuándo; el desglose está en
              Sincronizar, a un toque. */}
          <div className="ca-gate-aviso-txt">
            <strong>Hay pendientes de sincronizar</strong>
            <span className="ca-seed">
              {fechaMasAntigua ? `Desde el ${fechaLarga(fechaMasAntigua)}. ` : ''}
              {online ? 'Todavía no está en Claux.' : 'Sin conexión: puedes abrir el turno igual.'}
            </span>
          </div>
          {online && (
            <button className="ca-btn ca-btn-aviso" disabled={busy} onClick={() => sincronizar()}>
              {/* Icono, como los del banner del portal: es la mitad de por qué aquellos se
                  leen como una acción y este parecía un botón del sistema. SVG inline con
                  `width`/`height` como atributos, que es la regla del design system. */}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.36-2.64L3 16" />
                <path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.36 2.64L21 8" />
                <path d="M21 3v5h-5M3 21v-5h5" />
              </svg>
              Sincronizar
            </button>
          )}
        </div>
      )}
      <div className="ca-gate-card">
        <div className="ca-gate-step">Paso 1</div>
        <div className="ca-gate-title">Abre el turno</div>
        <p className="ca-gate-text">Para empezar a cobrar necesitas abrir el turno. Al final del día lo cierras y sincronizas.</p>
        {/* El fondo con el que se abre la gaveta para dar cambio. Es opcional, pero sin él
            el arqueo del cierre lo cuenta como dinero de más y siempre sale descuadrado. */}
        <div className="ca-field">
          <label className="ca-label">Dinero con el que empiezas, para dar cambio (opcional)</label>
          {monedas.map(m => (
            <div className="ca-fondo-row" key={m}>
              <span className="ca-fondo-cod">{m}</span>
              <input className="ca-input" type="text" inputMode="decimal" placeholder="0"
                aria-label={`Fondo inicial en ${m}`}
                value={fondo[m] ?? ''} onChange={e => setFondo(f => ({ ...f, [m]: e.target.value }))} />
            </div>
          ))}
        </div>
        <button className="ca-btn ca-btn-primary ca-btn-lg ca-btn-block" disabled={busy} onClick={abrirTurno}>Abrir turno</button>
        <div className="ca-steps">
          <div className="ca-step-row"><span className="ca-step-num">1</span> Abre el turno</div>
          <div className="ca-step-row"><span className="ca-step-num">2</span> Cobra las ventas (funciona sin internet)</div>
          <div className="ca-step-row"><span className="ca-step-num">3</span> Cierra el turno y sincroniza</div>
        </div>
        {installEvt && <button className="ca-btn ca-btn-block" onClick={instalar}>Instalar la caja en este dispositivo</button>}
      </div>
    </div>
  )

  const pos = (
    <div className="ca-pos">
      <section className="ca-productos">
        <input className="ca-search" placeholder="Buscar…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Buscar producto" />
        {/* De cuándo son los precios. Con la inflación de aquí, un dispositivo que lleva
            tres semanas sin bajar el catálogo está COBRANDO MAL y hasta ahora nada lo decía. */}
        {seedAt && diasSeed !== null && (
          <p className={`ca-seed${diasSeed >= 7 ? ' vieja' : ''}`}>
            {diasSeed >= 7
              ? `Precios de hace ${diasSeed} días (${fechaCorta(seedAt)}) — actualízalos en Sincronizar.`
              : `Precios del ${fechaCorta(seedAt)}.`}
          </p>
        )}
        {gruposProd.map(g => (
          <div key={g.titulo || 'todo'}>
            {g.titulo && <p className="ca-prod-grupo">{g.titulo}</p>}
            <div className="ca-prod-grid">
              {g.items.map(p => {
                const miss = sinPrecioProd(p)
                // Dos datos y una jerarquía: NOMBRE y PRECIO. Hubo una inicial de color por
                // producto y se retiró — decoraba sin ayudar, y le quitaba ancho justo al
                // nombre, que es lo que se lee. El código solo sale si lo hay, y en pequeño:
                // nadie busca por código en un mostrador.
                return (
                  <button key={p.producto_id} className="ca-prod" onClick={() => addProducto(p)} disabled={miss}>
                    <span className="ca-prod-name">{p.nombre}</span>
                    {/* El aviso de doble conteo, DONDE está quien cobra. La semilla manda
                        `es_suscribible` desde la mig. 120 y el dispositivo lo ignoraba: el
                        aviso solo vivía en la pantalla de configuración del portal, que no
                        la mira el vendedor. Si esto se factura por suscripción y además se
                        cobra aquí, la misma venta entra dos veces en el informe. */}
                    {p.es_suscribible
                      ? <span className="ca-prod-susc">Va por suscripción</span>
                      : p.codigo ? <span className="ca-prod-code">{p.codigo}</span> : null}
                    <span className={`ca-prod-price${miss ? ' miss' : ''}`}>{miss ? `Sin precio en ${moneda}` : `${simbolo(moneda)} ${money(precioDe(p))}`}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        {ocultos > 0 && (
          <p className="ca-seed vieja">
            Viendo {prodsFiltrados.length} de {prodsCoinciden.length}. Escribe en el buscador para llegar al resto.
          </p>
        )}
        {productos.length === 0 && <p className="ca-empty">Sin nada cargado. Usa «Artículo libre» para teclear la venta.</p>}
        {libreOpen ? (
          <div className="ca-libre">
            <input className="ca-input" placeholder="Nombre del artículo" aria-label="Nombre del artículo" value={libreNom} onChange={e => setLibreNom(e.target.value)} />
            {monedas.length > 1 && (
              <div className="ca-segmento" role="group" aria-label="Moneda del artículo">
                {monedas.map(m => (
                  <button key={m} type="button" className={`ca-seg-btn${m === moneda ? ' activo' : ''}`}
                    aria-pressed={m === moneda} onClick={() => cambiarMoneda(m)}>{m}</button>
                ))}
              </div>
            )}
            <input className="ca-input" type="text" inputMode="decimal" placeholder={`Precio (${moneda})`} value={librePre} onChange={e => setLibrePre(e.target.value)} />
            <div className="ca-pay-row">
              <button className="ca-btn ca-btn-primary" onClick={addLibre}>Añadir</button>
              <button className="ca-btn" onClick={() => setLibre(false)}>Cancelar</button>
            </div>
          </div>
        ) : (
          <button className="ca-btn ca-btn-block" onClick={() => setLibre(true)}>＋ Artículo libre</button>
        )}
      </section>

      {/* En móvil el ticket es una HOJA INFERIOR: colapsada deja a la vista lo único que
          importa siempre —el total y Cobrar, a un pulgar— y se despliega para revisar las
          líneas. Antes ocupaba el 46 % de la pantalla a todas horas y, con la calculadora
          de cambio dentro, la lista de artículos se quedaba en dos renglones. En pantallas
          anchas (tablet, o un móvil en horizontal) vuelve a ser la columna de siempre y el
          CSS la mantiene abierta. */}
      <aside className={`ca-ticket${sheetOpen || esColumna ? ' abierta' : ''}`}>
        {/* La cabecera solo es un CONTROL cuando el ticket es hoja. Plegarse al tocar el
            título sin nada que lo anuncie es de las cosas que hacen desconfiar de una
            caja: parece que se han borrado las líneas. De ahí «Ver ▾ / Ocultar ▴», con
            palabra y flecha — el asa sola no la lee nadie. */}
        {esColumna ? (
          <div className="ca-ticket-head">
            <span>Ticket{cart.length > 0 ? ` · ${cart.length}` : ''}</span>
            <span className="ca-ticket-cuenta">{moneda}</span>
          </div>
        ) : (
          <button type="button" className="ca-ticket-head"
            onClick={() => setSheetOpen(o => !o)}
            aria-expanded={sheetOpen} aria-controls="ca-ticket-items">
            <span>Ticket{cart.length > 0 ? ` · ${cart.length}` : ''}</span>
            <span className="ca-ticket-cuenta">{moneda}</span>
            <span className="ca-ticket-toggle">{sheetOpen ? 'Ocultar' : 'Ver'}<span className="ca-chevron" aria-hidden="true">▾</span></span>
          </button>
        )}
        <div className="ca-ticket-items" id="ca-ticket-items">
          {cart.length === 0
            ? <p className="ca-empty">Toca un producto para añadirlo.</p>
            : cart.map(l => {
              const miss = lineaSinPrecio(l)
              // DOS FILAS, siempre: el nombre arriba a todo lo ancho y los controles debajo.
              // En una sola fila las columnas fijas —dos botones de 44, la cantidad, el
              // subtotal y la «×»— se comían 230 px, así que en la columna del ticket
              // (360 px en escritorio, menos en tablet) al nombre le quedaban cien y
              // «Café en grano 1kg» salía partido en cuatro renglones.
              return (
              <div key={l.key} className="ca-tick-item">
                <div className="ca-tick-info">
                  <div className="ca-tick-name">{l.descripcion}</div>
                  <div className={`ca-tick-unit${miss ? ' miss' : ''}`}>{miss ? `Sin precio en ${moneda}` : `${simbolo(moneda)} ${money(l.precio_unitario)}`}</div>
                </div>
                <button className="ca-tick-x" onClick={() => removeLine(l.key)} aria-label={`Quitar ${l.descripcion}`}>×</button>
                <div className="ca-tick-acciones">
                <div className="ca-stepper">
                  <button className="ca-step-btn" onClick={() => changeQty(l.key, -1)} aria-label="Quitar uno">−</button>
                  {/* Tocar la cantidad abre el teclado numérico: vender 12 unidades eran
                      12 toques en el «+», y eso en un mostrador con cola no se hace. */}
                  {qtyEdit?.key === l.key ? (
                    <input className="ca-qty-input" type="text" inputMode="numeric" autoFocus
                      aria-label="Cantidad" value={qtyEdit.valor}
                      onChange={e => setQtyEdit({ key: l.key, valor: e.target.value })}
                      onBlur={() => { setQty(l.key, num(qtyEdit.valor)); setQtyEdit(null) }}
                      onKeyDown={e => { if (e.key === 'Enter') { setQty(l.key, num(qtyEdit.valor)); setQtyEdit(null) } }} />
                  ) : (
                    <button className="ca-qty" onClick={() => setQtyEdit({ key: l.key, valor: String(l.cantidad) })}
                      aria-label={`Cambiar la cantidad, ahora ${l.cantidad}`}>{l.cantidad}</button>
                  )}
                  <button className="ca-step-btn" onClick={() => changeQty(l.key, 1)} aria-label="Añadir uno">+</button>
                </div>
                <span className="ca-tick-sub">{money(l.cantidad * l.precio_unitario)}</span>
                </div>
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
          {/* El PAGO se ha ido a su propio paso (el diálogo de abajo). Aquí queda lo justo:
              cuánto es y el botón. Con la moneda, el medio de pago y la calculadora de
              cambio metidos en el pie, la hoja del ticket ocupaba la pantalla entera y en
              un móvil **no se veían los productos que faltaban por añadir**. Construir la
              venta y cobrarla son dos momentos distintos y ahora son dos pantallas. */}
          <button className="ca-cobrar" disabled={busy || cart.length === 0 || cartInvalido}
            onClick={() => { setPagaCon(''); setPagando(true) }}>
            {rectiUuid ? 'Guardar rectificación' : 'Cobrar'}
          </button>
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
      {/* Salidas de efectivo: se pagó al proveedor, el dueño retiró. Sin esto el dinero
          que sale de la gaveta durante el día aparece al cerrar como un descuadre. */}
      <div className="ca-card">
        <div className="ca-panel-title">Salidas de efectivo</div>
        {movsTurno.length === 0
          ? <div className="ca-muted">No ha salido dinero de la caja en este turno.</div>
          : movsTurno.map(mv => (
            <div key={mv.movimiento_uuid} className="ca-stat-row">
              <span className="ca-muted">{mv.motivo}</span>
              <span className="ca-mov-imp">− {simbolo(mv.moneda)} {money(mv.importe)}</span>
            </div>
          ))}
        {salidaOpen ? (
          <>
            {monedas.length > 1 && (
              <div className="ca-segmento" role="group" aria-label="Moneda de la salida">
                {monedas.map(m => (
                  <button key={m} type="button"
                    className={`ca-seg-btn${m === (salida.moneda || moneda) ? ' activo' : ''}`}
                    aria-pressed={m === (salida.moneda || moneda)}
                    onClick={() => setSalida(s => ({ ...s, moneda: m }))}>{m}</button>
                ))}
              </div>
            )}
            <input className="ca-input" type="text" inputMode="decimal" placeholder="Importe"
              aria-label="Importe que sale" value={salida.importe}
              onChange={e => setSalida(s => ({ ...s, importe: e.target.value }))} />
            <input className="ca-input" placeholder="¿Para qué? (pagué al proveedor…)"
              aria-label="Motivo de la salida" value={salida.motivo}
              onChange={e => setSalida(s => ({ ...s, motivo: e.target.value }))} />
            <div className="ca-pay-row">
              <button className="ca-btn ca-btn-primary" disabled={busy} onClick={registrarSalida}>Registrar</button>
              <button className="ca-btn" onClick={() => setSalidaOpen(false)}>Cancelar</button>
            </div>
          </>
        ) : (
          <button className="ca-btn ca-btn-block" onClick={() => setSalidaOpen(true)}>＋ Sacar dinero de la caja</button>
        )}
      </div>

      <div className="ca-card">
        <div className="ca-panel-title">Cerrar turno (arqueo)</div>
        {/* Antes esto era un campo por moneda que se guardaba y no se comparaba con nada.
            Ahora dice lo que TIENE que haber —fondo + ventas en efectivo + entradas −
            salidas— y enseña el descuadre ANTES de cerrar, que es cuando se puede buscar. */}
        <div className="ca-muted">Cuenta el efectivo de la gaveta y escríbelo. Las transferencias no cuentan: no pasaron por aquí.</div>
        {monedas.map(m => {
          const a = arqueo.get(m) ?? { fondo: 0, ventas: 0, salidas: 0, entradas: 0, esperado: 0 }
          const escrito = (contado[m] ?? '').trim() !== ''
          const dif = escrito ? round2(num(contado[m]) - a.esperado) : null
          return (
            <div className="ca-field" key={m}>
              <label className="ca-label" htmlFor={`contado-${m}`}>Efectivo contado {m}</label>
              <div className="ca-arqueo-linea">
                <span className="ca-muted">
                  Fondo {money(a.fondo)} + ventas {money(a.ventas)}
                  {a.entradas > 0 ? ` + entradas ${money(a.entradas)}` : ''}
                  {a.salidas > 0 ? ` − salidas ${money(a.salidas)}` : ''}
                </span>
                <span className="ca-arqueo-esperado">= {money(a.esperado)}</span>
              </div>
              <input id={`contado-${m}`} className="ca-input" type="text" inputMode="decimal" placeholder="0.00"
                value={contado[m] ?? ''} onChange={e => setContado(c => ({ ...c, [m]: e.target.value }))} />
              {dif !== null && (
                <span className={`ca-descuadre${dif === 0 ? ' ok' : ''}`}>
                  {dif === 0 ? 'Cuadra' : dif > 0 ? `Sobran ${money(dif)} ${m}` : `Faltan ${money(Math.abs(dif))} ${m}`}
                </span>
              )}
            </div>
          )
        })}
        <div className="ca-field">
          <label className="ca-label" htmlFor="cerrada-por">¿Quién cuenta el dinero? (opcional)</label>
          <input id="cerrada-por" className="ca-input" placeholder="Nombre"
            value={cerradaPor} onChange={e => setCerradaPor(e.target.value)} />
        </div>
        {/* Cerrar es lo único irreversible del dispositivo y estaba a un solo toque: uno
            accidental a media tarde partía el día en dos turnos. Ahora confirma. */}
        <button className="ca-btn ca-btn-primary ca-btn-block" disabled={busy} onClick={() => setConfirmarCierre(true)}>Cerrar turno</button>
      </div>
    </div>
  )

  /**
   * VENTAS DEL DÍA, por turno y en tabla.
   *
   * Tabla y no tarjetas porque la lista **no crece**: solo se ven las de hoy (la vista
   * filtra por día del negocio), así que caben de un vistazo y lo que se busca es una
   * hora, un importe y una acción — tres columnas, no tres tarjetas.
   */
  const ventasPanel = (
    <div className="ca-panel">
      <div className="ca-panel-title">Ventas del día</div>
      {ventasDia.length === 0 ? (
        <div className="ca-card"><div className="ca-muted">Aún no hay ventas hoy.</div></div>
      ) : ventasPorTurno.map(g => (
        <div className="ca-card ca-turno-bloque" key={g.sesion_uuid}>
          {/* La cabecera del bloque es la que explica por qué hay o no botones. */}
          <div className="ca-turno-cab">
            <strong>
              {g.abierto
                ? 'Turno en curso'
                : g.cerradaAt
                  ? `Cerrado a las ${new Date(g.cerradaAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: TZ_NEGOCIO })}`
                  : 'Turno cerrado'}
            </strong>
            <span className="ca-seed">{g.tickets.length} {g.tickets.length === 1 ? 'venta' : 'ventas'}</span>
          </div>
          <table className="ca-tabla">
            <tbody>
              {g.tickets.map(t => {
                const est = t.estado ?? 'VIGENTE'
                const anulada = est === 'ANULADO'
                const puedeRecti = g.abierto && !anulada && !rectificados.has(t.ticket_uuid)
                return (
                  <tr key={t.ticket_uuid} className={anulada ? 'anulada' : undefined}>
                    <td className="ca-td-hora">
                      {new Date(t.fecha).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: TZ_NEGOCIO })}
                    </td>
                    <td className="ca-td-det">
                      <span className="ca-op-desc">{t.lineas.map(l => `${l.cantidad}× ${l.descripcion}`).join(' · ')}</span>
                      {anulada && <span className="ca-tag ca-tag-anulada">Anulada</span>}
                      {est === 'RECTIFICACION' && <span className="ca-tag ca-tag-recti">Rectificación</span>}
                    </td>
                    <td className="ca-td-imp">{simbolo(t.moneda)} {money(t.total)}</td>
                    <td className="ca-td-acc">
                      {puedeRecti && (
                        <div className="ca-op-btns">
                          <button className="ca-btn ca-btn-sm" onClick={() => rectificar(t)}>Rectificar</button>
                          {/* Deshacer un cobro entero. Rectificar sirve para corregirlo, pero
                              exige dejar algo en el ticket: un doble toque no se podía anular. */}
                          <button className="ca-btn ca-btn-sm ca-btn-danger" onClick={() => setAnular(t)}>Anular</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
      {/* UNA vez al pie, no repetido en cada turno cerrado. Estaba dentro de cada bloque, y
          con tres turnos en el día el mismo párrafo salía tres veces: en una pantalla de
          móvil, el aviso ocupaba más que las ventas. Contesta además a lo que se pregunta
          solo al día siguiente —la lista amanece vacía y parece que se ha borrado algo—. */}
      <p className="ca-seed">Solo se corrige dentro del turno abierto: al cerrarlo, su dinero ya pasó a tu contabilidad y lo demás se arregla desde Claux. Rectificar crea una venta corregida y anula la original; las dos quedan registradas.</p>
      <p className="ca-seed">Aquí están solo las ventas de hoy. Mañana la lista empieza de cero y las de hoy siguen en Claux.</p>
    </div>
  )

  /**
   * SINCRONIZAR. Reordenada por importancia, no como una pila de botones iguales.
   *
   * Antes eran cinco botones a todo lo ancho, del mismo tamaño y sin jerarquía: en un móvil
   * era una lista interminable y en escritorio, cinco barras de dos mil píxeles. Ahora:
   * el ESTADO arriba (que es la pregunta real: ¿me falta algo por enviar?), UNA acción
   * primaria, y el resto —que se usan una vez al mes— en una rejilla de secundarias.
   */
  const syncPanel = (
    <div className="ca-panel">
      <div className="ca-panel-title">Sincronizar con Claux</div>

      {/* QUÉ se va a enviar, con su nombre. Aquí había un número grande y un titular que lo
          repetía («Faltan 3 cosas por enviar»), y ese total sumaba ventas con cierres: un
          recuento de «cosas» no es información, y encima obligaba a leer la lista de abajo
          para saber de qué hablaba. Ahora el titular solo dice si queda algo o no, y lo que
          queda se enumera con su nombre — que es lo único que hacía falta. */}
      {/* LO QUE CLAUX NO ACEPTÓ, arriba del todo y hasta que entre. Es lo único de esta
          pantalla que no puede esperar: son ventas que el dispositivo tiene y la
          contabilidad no, y antes no se decían en ninguna parte. */}
      {rechazo && (
        <div className="ca-card ca-sync-rechazo">
          <strong className="ca-sync-titulo">
            {rechazo.n === 1 ? '1 venta no entró en Claux' : `${rechazo.n} ventas no entraron en Claux`}
          </strong>
          {/* Sin lista de errores: los motivos llevan uuids y excepciones, y el detalle
              está en el portal, que es donde se puede arreglar. Aquí, qué pasa y qué hacer. */}
          <p className="ca-muted">No se han perdido: siguen en este dispositivo. Hay algo que revisar en el punto de venta — díselo al dueño y se ve desde Claux.</p>
        </div>
      )}

      <div className={`ca-card ca-sync-estado${totalPend > 0 ? ' pendiente' : ''}`}>
        <div className="ca-sync-cabecera">
          <span className="ca-sync-marca" aria-hidden>{totalPend === 0 ? '✓' : ''}</span>
          {/* UNA sola palabra para esto en toda la app: SINCRONIZAR. La pestaña decía
              «Sincronizar», el botón «enviar», el panel «subir» y el toast «sincronizado»:
              cuatro verbos para un solo gesto hacen dudar de si son cuatro cosas distintas. */}
          <strong className="ca-sync-titulo">
            {totalPend === 0 ? 'Todo sincronizado' : 'Pendiente de sincronizar'}
          </strong>
        </div>

        {/* El cero, con nombre y apellidos. La sincronización automática (al recuperar
            conexión o al arrancar) es silenciosa a propósito, así que quien no mira esta
            pantalla justo después no llega a ver que subió: aquí queda escrito qué está
            ya en Claux y que el turno abierto no bloquea nada. */}
        {totalPend === 0 && (
          <ul className="ca-sync-lista">
            {/* QUÉ se acaba de sincronizar. Es la línea que faltaba: la sincronización
                automática sube en silencio, así que quien tenía 3 ventas esperando entraba
                aquí, veía el cero y creía que se habían perdido. Ahora el cero viene con
                su explicación — lo que subió y cuándo. */}
            {ultimoEnvio && ultimoEnvio.ventas + ultimoEnvio.cierres + ultimoEnvio.movs > 0 && (
              <li>
                <span>
                  Se sincronizaron {[
                    ultimoEnvio.ventas > 0 ? `${ultimoEnvio.ventas} ${ultimoEnvio.ventas === 1 ? 'venta' : 'ventas'}` : null,
                    ultimoEnvio.cierres > 0 ? `${ultimoEnvio.cierres} ${ultimoEnvio.cierres === 1 ? 'cierre' : 'cierres'}` : null,
                    ultimoEnvio.movs > 0 ? `${ultimoEnvio.movs} ${ultimoEnvio.movs === 1 ? 'movimiento' : 'movimientos'}` : null,
                  ].filter(Boolean).join(' · ')}
                </span>
                <span className="ca-seed">{fechaCorta(ultimoEnvio.at)} a las {new Date(ultimoEnvio.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: TZ_NEGOCIO })}</span>
              </li>
            )}
            <li>
              <span>
                {yaEnviado.ventas > 0
                  ? `${yaEnviado.ventas} ${yaEnviado.ventas === 1 ? 'venta de este turno ya está' : 'ventas de este turno ya están'} en Claux`
                  : sesion ? 'Este turno todavía no tiene ventas' : 'No hay nada esperando'}
              </span>
            </li>
            {/* LO QUE FALTA DE VERDAD. «Todo sincronizado» es cierto y aun así deja al dueño
                pensando que su dinero no ha llegado: en Claux esas ventas salen en «Sin
                contabilizar» hasta que alguien cierra el turno, porque es el cierre —y no la
                sincronización— lo que las lleva a Tesorería y descuenta el stock. Decir solo
                que está todo enviado, sin decir eso, es lo que hacía parecer una avería. */}
            {sesion && (
              <li>
                <span>{yaEnviado.ventas > 0 ? 'Falta cerrar el turno' : 'El turno sigue abierto'}</span>
                <span className="ca-seed">
                  {yaEnviado.ventas > 0
                    ? 'hasta que lo cierres, estas ventas salen en Claux como «sin contabilizar»: es el cierre lo que lleva el dinero a Tesorería'
                    : 'ciérralo al terminar la jornada'}
                </span>
              </li>
            )}
          </ul>
        )}

        {totalPend > 0 && (
          <ul className="ca-sync-lista">
            {pend.tickets > 0 && (
              <li>
                <span>{pend.tickets} {pend.tickets === 1 ? 'venta' : 'ventas'}</span>
                {/* Responde a la pregunta que provoca ver «2 ventas» tras rectificar una:
                    la anulación sube para que Claux sepa que esa venta se anuló, pero no
                    se cobra — el cierre la deja fuera del total. */}
                {pend.anuladas > 0 && <span className="ca-seed">incluye {pend.anuladas} {pend.anuladas === 1 ? 'anulación, que no suma' : 'anulaciones, que no suman'}</span>}
              </li>
            )}
            {pend.cierres > 0 && (
              <li>
                <span>{pend.cierres} {pend.cierres === 1 ? 'cierre de turno' : 'cierres de turno'}</span>
                <span className="ca-seed">es lo que lleva el dinero a tu contabilidad</span>
              </li>
            )}
            {pend.movs > 0 && (
              <li>
                <span>{pend.movs} {pend.movs === 1 ? 'movimiento de efectivo' : 'movimientos de efectivo'}</span>
              </li>
            )}
            {diasSinEnviar >= 1 && (
              <li><span className="ca-seed vieja">Lo más antiguo espera {cuantosDias(diasSinEnviar)}</span></li>
            )}
            {/* Con un archivo fuera, esto SIGUE contando como pendiente aunque quizá ya
                esté arriba: el móvil no puede saber si lo subiste. Se dice, en vez de
                marcarlo por si acaso —marcar sin certeza es como se pierde una venta—. */}
            {exportAt && (
              <li>
                <span className="ca-seed">Descargaste el archivo {fechaCorta(exportAt)}; si ya lo subiste, esto ya está en Claux</span>
                <span className="ca-seed">sincronizar de nuevo no lo duplica</span>
              </li>
            )}
          </ul>
        )}

        <p className="ca-seed">
          {syncAt
            ? `Última vez: ${fechaCorta(syncAt)} a las ${new Date(syncAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: TZ_NEGOCIO })}`
            : 'Todavía no has sincronizado nada desde este punto de venta.'}
        </p>
      </div>

      {/* `() => sincronizar()` y no `sincronizar`: `onClick` pasa el evento como primer
          argumento, y ese primer argumento es `silencioso` — el botón manual se habría
          quedado mudo, sin decir ni que fue bien ni que falló. */}
      {/* Apagado cuando no hay nada: un botón que se puede pulsar y no hace nada enseña a
          desconfiar de él. La razón por la que llegó a mentir —el contador se dejaba fuera
          los movimientos de efectivo, y el servidor daba por buenas ventas que había
          rechazado— está corregida en el origen, que es donde tocaba. */}
      <button className="ca-btn ca-btn-primary ca-btn-lg ca-btn-block" disabled={busy || !online || totalPend === 0}
        onClick={() => sincronizar()}>
        {!online ? 'Sin conexión' : totalPend === 0 ? 'No hay nada que sincronizar' : 'Sincronizar ahora'}
      </button>
      {!online && (
        <p className="ca-muted">Sin conexión. Las ventas están guardadas aquí; sincroniza cuando vuelva la señal.</p>
      )}

      {/* EL ARCHIVO, solo cuando de verdad hace falta: dos intentos seguidos que no han
          llegado, o uno ya descargado sin que haya entrado nada desde entonces. Estaba
          siempre a la vista, junto a las acciones de mantenimiento, y eso lo convertía en
          una rutina — y cada archivo suelto es un lote que alguien tiene que acordarse de
          subir. Desaparece solo en cuanto una sincronización entra. */}
      {mostrarArchivo && (
        <div className="ca-card">
          <div className="ca-panel-title">Sin conseguir conexión</div>
          <p className="ca-muted">
            Puedes descargar las ventas en un archivo —no hace falta conexión para esto— y subirlo en
            Claux → Punto de venta → Sincronizar desde cualquier otro dispositivo que sí tenga.
          </p>
          <button className="ca-btn ca-btn-block" onClick={exportar}>Descargar archivo (.json)</button>
        </div>
      )}

      <div className="ca-panel-title">Otras acciones</div>
      <div className="ca-acciones">
        {/* Con turno abierto, el resumen de lo que va; sin turno, el del ÚLTIMO CIERRE —que
            es el que se manda—. Antes solo existía el primero, así que el botón desaparecía
            justo al cerrar, que es el único momento en que alguien quiere compartirlo. */}
        {(sesion || resumenCierre) && (
          <button className="ca-btn" onClick={() => setResumenVisible(true)}>
            {sesion ? 'Ver resumen del turno' : 'Ver resumen del último cierre'}
          </button>
        )}
        <button className="ca-btn" disabled={busy || !online} onClick={actualizarProductos}>Actualizar productos y precios</button>
        <button className="ca-btn" disabled={busy || !online} onClick={actualizarApp}>Actualizar la app</button>
      </div>
      <p className="ca-seed">
        ¿Cambiaste productos, precios o monedas en Claux? «Actualizar productos». ¿No ves los últimos cambios de la caja? «Actualizar la app».
      </p>

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
    </div>
  )

  const welcome = (
    <div className="ca-gate">
      <div className="ca-gate-card">
        <div className="ca-gate-step">Bienvenido</div>
        <div className="ca-gate-title">{config?.caja.nombre ?? 'Punto de venta'}</div>
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
      {/* `ocupado`: con una venta a medias, la versión nueva del service worker NO recarga
          la pantalla encima de ella. Se aplicará al reabrir la caja. */}
      <PuntoVentaPwaRegister ocupado={cart.length > 0} />
      <header className="ca-header">
        <div className="ca-header-info">
          <div className="ca-title">{config?.caja.nombre ?? 'Punto de venta'}</div>
          {/* Los dos estados que importan, en píldoras y no en texto suelto: se leen de
              un vistazo desde el otro lado del mostrador. El color dice el estado y el
              texto lo confirma — nunca solo el color. */}
          <div className="ca-chips">
            <span className={`ca-turno-chip${sesion ? (diasTurno >= 1 ? ' vieja' : '') : ' closed'}`}>
              <span className="ca-dot" />
              {sesion
                ? `Turno abierto${diasTurno >= 1 ? ` ${cuantosDias(diasTurno)}` : ''} · ${ventasTurnoN} ventas`
                : 'Turno cerrado'}
            </span>
            <span className={`ca-online${online ? '' : ' off'}`}>
              <span className="ca-dot" />{online ? 'En línea' : 'Sin conexión'}
            </span>
          </div>
        </div>
        <div className="ca-header-acciones">
          {/* El tema se puede FORZAR desde aquí. Sigue al sistema por defecto, pero el
              aparato de la caja se queda en el mostrador y quien cobra de noche no va a
              entrar en los ajustes del móvil para que la pantalla deje de deslumbrar. */}
          <button type="button" className="ca-icon-btn" onClick={cambiarTema}
            aria-label={`Tema: ${tema === 'auto' ? 'automático' : tema}. Cambiar.`}
            title={`Tema: ${tema === 'auto' ? 'automático' : tema}`}>
            {tema === 'claro' ? '☀' : tema === 'oscuro' ? '☾' : '◐'}
          </button>
        </div>
      </header>

      {/* Franja persistente, no un toast: lo que avisa es que hay dinero que todavía no ha
          salido del móvil, y eso no se resuelve solo ni se va con el tiempo. */}
      {enApp && alerta && <div className="ca-alerta" role="status">{alerta}</div>}

      {/* LA CAJA ESTÁ TRABAJANDO. Va pegada bajo la cabecera, siempre visible, diga lo que
          diga la pantalla de debajo: en un móvil viejo y con la red de aquí, entre pulsar
          y ver el resultado pasan segundos en los que antes no cambiaba nada — y lo que
          hace cualquiera es volver a pulsar. Con la etiqueta, además, se sabe QUÉ espera. */}
      {cargando && (
        <div className="ca-cargando" role="status" aria-live="polite">
          <span className="ca-spinner" aria-hidden />{cargando}
        </div>
      )}

      {/* El toast FLOTA sobre el contenido, encima de la barra de abajo. Iba en el flujo,
          justo bajo la cabecera, así que al sincronizar desde la pantalla de abrir turno
          —que está centrada en vertical— la respuesta aparecía a media pantalla de
          distancia de donde estabas mirando y no se veía. */}
      {msg && <div className={`ca-msg ca-msg-${msg.t}`} role="status" aria-live="polite">{msg.x}</div>}

      {!enApp ? welcome : vista === 'sync' ? syncPanel : vista === 'ventas' ? ventasPanel : !sesion ? gate : vista === 'vender' ? pos : turnoPanel}

      {/* Diálogos propios. `confirm()` del navegador está prohibido (SKILL §5) y aquí
          además sería un aviso del sistema encima de una app que se vende como caja. */}
      {confirmarCierre && sesion && (
        <div className="ca-dialogo" role="dialog" aria-modal aria-label="Cerrar el turno">
          <div className="ca-dialogo-card">
            <div className="ca-gate-title">¿Cerrar el turno?</div>
            <p className="ca-gate-text">Después no se pueden añadir ni rectificar ventas en él. Esto es lo que se cierra:</p>
            <div className="ca-card">
              {ventasTurno.size === 0
                ? <div className="ca-muted">Sin ventas en este turno.</div>
                : [...ventasTurno.entries()].map(([m, v]) => (
                  <div key={m} className="ca-stat-row">
                    <span className="ca-muted">{v.count} ventas en {m}</span>
                    <span className="ca-stat-big">{simbolo(m)} {money(v.total)}</span>
                  </div>
                ))}
              {[...arqueo.entries()].map(([m, a]) => {
                const escrito = (contado[m] ?? '').trim() !== ''
                if (!escrito) return null
                const dif = round2(num(contado[m]) - a.esperado)
                return (
                  <div key={`arq-${m}`} className="ca-stat-row">
                    <span className="ca-muted">Efectivo {m}</span>
                    <span className={`ca-descuadre${dif === 0 ? ' ok' : ''}`}>
                      {dif === 0 ? 'Cuadra' : dif > 0 ? `Sobran ${money(dif)}` : `Faltan ${money(Math.abs(dif))}`}
                    </span>
                  </div>
                )
              })}
            </div>
            {/* Aquí había un párrafo explicando qué se enviaba y que no se duplica. Fuera:
                quien está cerrando el turno mira el descuadre, no la mecánica del envío —y
                el envío no es una decisión suya, sale solo. La contabilidad del cierre se
                explica en el panel de Sincronizar, que es donde se pregunta. */}
            <button className="ca-btn ca-btn-primary ca-btn-lg ca-btn-block" disabled={busy} onClick={cerrarTurno}>Sí, cerrar el turno</button>
            <button className="ca-btn ca-btn-block" onClick={() => setConfirmarCierre(false)}>Seguir vendiendo</button>
          </div>
        </div>
      )}

      {/* ── El COBRO, en su propio paso ── */}
      {pagando && (
        <div className="ca-dialogo" role="dialog" aria-modal aria-label="Cobrar">
          <div className="ca-dialogo-card">
            <div className="ca-total-row">
              <span className="ca-total-lbl">A cobrar</span>
              <span className="ca-total">{simbolo(moneda)} {money(cartTotal)}</span>
            </div>

            {monedas.length > 1 && (
              <div className="ca-segmento" role="group" aria-label="Moneda">
                {monedas.map(m => (
                  <button key={m} type="button" className={`ca-seg-btn${m === moneda ? ' activo' : ''}`}
                    aria-pressed={m === moneda} onClick={() => cambiarMoneda(m)}>{m}</button>
                ))}
              </div>
            )}
            <div className="ca-segmento" role="group" aria-label="Medio de pago">
              {MEDIOS_PAGO.map(m => (
                <button key={m} type="button" className={`ca-seg-btn${m === medioPago ? ' activo' : ''}`}
                  aria-pressed={m === medioPago} onClick={() => setMedio(m)}>{m}</button>
              ))}
            </div>

            {medioPago === 'Efectivo' && (
              <div className="ca-cambio">
                <div className="ca-pay-row">
                  <input className="ca-input" type="text" inputMode="decimal" placeholder="Paga con…"
                    aria-label="Con cuánto paga" value={pagaCon}
                    onChange={e => setPagaCon(e.target.value)} />
                  <button className="ca-btn" onClick={() => setPagaCon(String(cartTotal))}>Justo</button>
                </div>
                {/* Los atajos SUMAN, no sustituyen: quien paga con dos billetes de 1000 y
                    uno de 500 toca +1000, +1000, +500 — que es literalmente lo que hace con
                    la mano. Antes cada botón pisaba el importe anterior y con dos billetes
                    ya había que teclear. Los valores son los billetes que circulan aquí. */}
                <div className="ca-cambio-atajos">
                  {BILLETES.map(v => (
                    <button key={v} className="ca-btn ca-btn-sm"
                      onClick={() => setPagaCon(String(round2(num(pagaCon) + v)))}>+{money(v)}</button>
                  ))}
                </div>
                <div className="ca-total-row">
                  <span className="ca-total-lbl">Cambio</span>
                  {pagaCon.trim() === '' ? (
                    <span className="ca-muted">—</span>
                  ) : (
                    <span className={`ca-cambio-imp${num(pagaCon) < cartTotal ? ' falta' : ''}`}>
                      {num(pagaCon) < cartTotal
                        ? `Faltan ${simbolo(moneda)} ${money(cartTotal - num(pagaCon))}`
                        : `${simbolo(moneda)} ${money(num(pagaCon) - cartTotal)}`}
                    </span>
                  )}
                </div>
                {pagaCon.trim() !== '' && (
                  <button className="ca-btn ca-btn-sm" onClick={() => setPagaCon('')}>Borrar lo tecleado</button>
                )}
              </div>
            )}

            <button className="ca-cobrar" disabled={busy} onClick={cobrar}>
              {rectiUuid ? 'Guardar rectificación' : `Cobrar ${simbolo(moneda)} ${money(cartTotal)}`}
            </button>
            <button className="ca-btn ca-btn-block" onClick={() => setPagando(false)}>Volver al ticket</button>
          </div>
        </div>
      )}

      {/* Qué es exactamente «compartir el resumen»: se ve ANTES de mandarlo. Un botón que
          abre el menú de compartir del sistema sin enseñar qué se comparte no se pulsa. */}
      {resumenVisible && (
        <div className="ca-dialogo" role="dialog" aria-modal aria-label="Resumen del turno">
          <div className="ca-dialogo-card">
            <div className="ca-gate-title">{sesion ? 'Resumen del turno' : 'Resumen del último cierre'}</div>
            <p className="ca-muted">Esto es lo que se manda. Sirve para pasarle el día al dueño por Telegram o WhatsApp sin que tenga que entrar a Claux.</p>
            {/* Con turno abierto se recalcula en vivo; cerrado, se enseña el texto que se
                guardó al cerrar — el único que lleva el dinero contado y el descuadre. */}
            <pre className="ca-resumen">{sesion ? resumenTurno() : resumenCierre}</pre>
            <button className="ca-btn ca-btn-primary ca-btn-block" onClick={compartirResumen}>Compartir</button>
            <button className="ca-btn ca-btn-block" onClick={() => setResumenVisible(false)}>Cerrar</button>
          </div>
        </div>
      )}

      {anular && (
        <div className="ca-dialogo" role="dialog" aria-modal aria-label="Anular la venta">
          <div className="ca-dialogo-card">
            <div className="ca-gate-title">¿Anular esta venta?</div>
            <p className="ca-gate-text">
              {anular.lineas.map(l => `${l.cantidad}× ${l.descripcion}`).join(' · ')} — {simbolo(anular.moneda)} {money(anular.total)}
            </p>
            <p className="ca-muted">Queda registrada como anulada (no se borra) y deja de contar para la caja, la contabilidad y el stock.</p>
            <button className="ca-btn ca-btn-primary ca-btn-lg ca-btn-block" disabled={busy} onClick={() => anularVenta(anular)}>Sí, anular</button>
            <button className="ca-btn ca-btn-block" onClick={() => setAnular(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {enApp && (
        <nav className="ca-nav">
          <button className={`ca-nav-btn${vista === 'vender' ? ' active' : ''}`} onClick={() => { setVista('vender'); setMsg(null) }}>Vender</button>
          <button className={`ca-nav-btn${vista === 'ventas' ? ' active' : ''}`} onClick={() => { setVista('ventas'); setMsg(null) }}>Ventas</button>
          <button className={`ca-nav-btn${vista === 'turno' ? ' active' : ''}`} onClick={() => { setVista('turno'); setMsg(null) }}>Turno</button>
          <button className={`ca-nav-btn${vista === 'sync' ? ' active' : ''}`} onClick={() => { setVista('sync'); setMsg(null) }}>
            {/* Un PUNTO, no un contador. El número no cabía en una pestaña de la barra y
                además no se puede actuar sobre él: lo único que hay que saber desde aquí es
                si queda algo dentro del móvil. El detalle está a un toque, en el panel. */}
            Sincronizar{totalPend > 0 && <span className="ca-nav-badge" role="img" aria-label="Queda algo por sincronizar" />}
          </button>
        </nav>
      )}
    </>
  )
}
