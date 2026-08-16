'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Copy, Check, RefreshCw, Eye, EyeOff, QrCode, X } from 'lucide-react'
import { guardarConfigCaja, regenerarToken, type CajaConfigData } from '@/app/actions/portal/caja'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { slugPuntoVenta } from '@/lib/caja/slug'
import Tabs from '@/components/Tabs'

type TabId = 'caja' | 'config'

export default function CajaConfigView({ data, puedeEditar }: { data: CajaConfigData; puedeEditar: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tab, setTab] = useState<TabId>('caja')

  const [nombre, setNombre]       = useState(data.caja.nombre)
  const [empresaId, setEmpresaId] = useState(data.caja.empresa_id)
  const [almacenId, setAlmacenId] = useState(data.caja.almacen_id ?? '')
  const [monedas, setMonedas]     = useState<string[]>(data.caja.monedas_aceptadas ?? [])
  const [tiposCatalogo, setTiposCatalogo] = useState(data.caja.tipos_catalogo ?? 'PRODUCTO')
  const [cuentas, setCuentas]     = useState<Record<string, string>>(data.caja.cuentas_moneda ?? {})
  const [transf, setTransf]       = useState<Record<string, string>>(data.caja.cuentas_transferencia ?? {})
  const [token, setToken]         = useState(data.caja.sync_token)
  const [copied, setCopied]       = useState(false)
  const [verEnlace, setVerEnlace] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [generandoQr, setGenerandoQr] = useState(false)
  const [confirmarRegenerar, setConfirmarRegenerar] = useState(false)
  const [confirmarEmpresa, setConfirmarEmpresa] = useState(false)

  // El selector de empresa solo aparece si hay más de una: con una sola no es una
  // decisión, es ruido (y no hay a dónde mover el punto de venta).
  const multiempresa  = data.empresas.length > 1
  const cambiaEmpresa = empresaId !== data.caja.empresa_id
  const nombreEmpresa = (id: string) => data.empresas.find(e => e.empresa_id === id)?.nombre ?? id

  // En cliente usa el origen real; en SSR cae a baseUrl y se resuelve al hidratar
  // (el input lleva suppressHydrationWarning por el value distinto server/cliente).
  const base = typeof window !== 'undefined' ? window.location.origin : data.baseUrl
  // Tres piezas, cada una con su papel:
  //  · el slug del nombre → decorativo, para reconocer el enlace al compartirlo;
  //  · `?c=<caja_id>`     → identifica el punto para que la app instalada se llame
  //    como él (el manifest lo lee en servidor; no es una credencial);
  //  · `#t=<token>`       → la credencial, en el FRAGMENTO, que no viaja al servidor
  //    y por tanto no acaba en logs ni en cabeceras Referer.
  // Usa el nombre GUARDADO, no el del formulario sin guardar.
  const installUrl =
    `${base}/punto-de-venta/${slugPuntoVenta(data.caja.nombre)}?c=${data.caja.caja_id}#t=${token}`

  // Filtran por la empresa SELECCIONADA, no por la guardada: al cambiar el selector
  // las listas se recargan al vuelo y el usuario elige ya el almacén y las cuentas de
  // la empresa nueva en el mismo guardado, sin pasar por un estado intermedio roto.
  const empresaAlmacenes = data.almacenes.filter(a => a.empresa_id === empresaId)
  const cuentasDe = (moneda: string) =>
    data.cuentas.filter(c => c.empresa_id === empresaId && c.moneda === moneda)

  // Al aceptar una moneda se preselecciona su cuenta si NO hay ambigüedad (una sola
  // caja en esa moneda). Con varias no se adivina: elegir por el usuario metería el
  // dinero en una cuenta que él no ha decidido, que es otro error contable, solo que
  // más difícil de ver. Al quitarla se suelta la cuenta para no guardar huérfanas.
  function toggleMoneda(m: string) {
    const activando = !monedas.includes(m)
    setMonedas(prev => activando ? [...prev, m] : prev.filter(x => x !== m))
    if (!data.tieneBase) return
    if (activando) {
      const candidatas = cuentasDe(m)
      if (candidatas.length === 1 && !cuentas[m]) {
        setCuentas(prev => ({ ...prev, [m]: candidatas[0].cuenta_id }))
      }
    } else {
      setCuentas(prev => { const next = { ...prev }; delete next[m]; return next })
      setTransf(prev => { const next = { ...prev }; delete next[m]; return next })
    }
  }

  // Monedas aceptadas a las que les falta cuenta. Con Contabilidad activa esto no es
  // un detalle cosmético: el cierre que llegue con ventas en esa moneda NO crea su
  // ingreso en Tesorería, y el punto de venta sigue cobrando como si nada.
  const monedasSinCuenta = data.tieneBase
    ? monedas.filter(m => !cuentas[m])
    : []

  // Al cambiar de empresa, el almacén y las cuentas elegidos son de la anterior. En vez
  // de dejar todas las monedas huérfanas, se reasignan a la caja equivalente de la
  // empresa nueva cuando no hay ambigüedad (una sola en esa moneda) — la misma regla
  // que al marcar una moneda. Solo queda por elegir lo que de verdad es una decisión.
  function cambiarEmpresa(nuevo: string) {
    setEmpresaId(nuevo)
    setAlmacenId('')
    const remapeadas: Record<string, string> = {}
    if (data.tieneBase) {
      for (const m of monedas) {
        const candidatas = data.cuentas.filter(c => c.empresa_id === nuevo && c.moneda === m)
        if (candidatas.length === 1) remapeadas[m] = candidatas[0].cuenta_id
      }
    }
    setCuentas(remapeadas)
  }

  function copiar() {
    navigator.clipboard?.writeText(installUrl).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    })
  }

  // `qrcode` va por import dinámico, igual que en el catálogo: es una librería que solo
  // hace falta al pulsar y no tiene por qué viajar en el bundle de todas las visitas.
  // Cerrar SUELTA la imagen: el QR no se queda en memoria esperando a que alguien vuelva a
  // abrir el panel, y así la próxima apertura es siempre contra el enlace de ese momento.
  function cerrarQr() { setQrDataUrl(null) }

  // Se genera EN CADA PULSACIÓN, contra el `installUrl` de ahora. No se cachea a
  // propósito: un QR guardado en estado sobrevive a «Regenerar enlace» y acabaría
  // instalando la caja con un token muerto, que falla en el móvil sin decir por qué.
  async function verQr() {
    setGenerandoQr(true)
    try {
      const QRCode = (await import('qrcode')).default
      setQrDataUrl(await QRCode.toDataURL(installUrl, { width: 480, margin: 2 }))
    } catch {
      toastError('No se pudo generar el QR.')
    } finally {
      setGenerandoQr(false)
    }
  }

  function regenerar() {
    setConfirmarRegenerar(false)
    setQrDataUrl(null)   // el QR anterior apunta a un enlace que acaba de morir
    const ld = toastLoading('Regenerando…')
    startTransition(async () => {
      const r = await regenerarToken(data.caja.caja_id)
      await ld.dismiss()
      if (!r.ok || !r.token) { toastError(r.error ?? 'No se pudo regenerar el enlace.'); return }
      setToken(r.token)
      toastSuccess('Enlace regenerado. Reinstala la caja con el nuevo enlace.')
    })
  }

  // Mover un punto de venta de empresa cambia a dónde va el dinero y el stock, así
  // que no se guarda de corrido: el submit abre la confirmación y es esta la que
  // ejecuta. Sin cambio de empresa, guarda directo (no hay nada que advertir).
  function guardar(e: FormEvent) {
    e.preventDefault()
    if (monedasSinCuenta.length > 0) {
      toastError(
        `Elige la caja de Tesorería para ${monedasSinCuenta.join(', ')}. ` +
        'Sin ella, las ventas en esa moneda no llegan a tu contabilidad.',
      )
      return
    }
    if (cambiaEmpresa) { setConfirmarEmpresa(true); return }
    persistir()
  }

  function persistir() {
    setConfirmarEmpresa(false)
    const cuentasFiltradas: Record<string, string> = {}
    const transfFiltradas: Record<string, string> = {}
    for (const m of monedas) {
      if (cuentas[m]) cuentasFiltradas[m] = cuentas[m]
      if (transf[m])  transfFiltradas[m]  = transf[m]
    }
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const r = await guardarConfigCaja(data.caja.caja_id, {
        nombre, empresa_id: empresaId, almacen_id: almacenId || null,
        monedas_aceptadas: monedas, cuentas_moneda: cuentasFiltradas,
        cuentas_transferencia: transfFiltradas,
        tipos_catalogo: tiposCatalogo,
      })
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo guardar.'); return }
      toastSuccess('Configuración guardada.')
      router.refresh()
    })
  }

  return (
    <div className="view-container">
      <div className="breadcrumb">
        <Link href="/portal/caja">Puntos de venta</Link>
        <span>›</span>
        <span className="breadcrumb-current">{data.caja.nombre}</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{data.caja.nombre}</h1>
          <p className="page-subtitle">
            Instalación y configuración del punto de venta
            {multiempresa ? ` · ${nombreEmpresa(data.caja.empresa_id)}` : ''}.
          </p>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'caja', label: 'El punto de venta' },
          ...(puedeEditar ? [{ id: 'config' as const, label: 'Configuración' }] : []),
        ]}
        active={tab} onChange={setTab} ariaLabel="Secciones del punto de venta"
      />

      {/* ── La caja: enlace de instalación + cómo entregarla ── */}
      {tab === 'caja' && (
        <>
          <div className="card caja-config-section">
            <h2 className="mon-section-title">Enlace de la caja</h2>
            <p className="caja-section-sub">
              Este es el enlace que instala la caja en un dispositivo. Cópialo o compártelo con quien la vaya a usar.
            </p>
            <div className="caja-install">
              <div className="caja-link-row">
                {/* El enlace LLEVA EL TOKEN: quien lo vea puede instalar la caja y meter
                    ventas en tu contabilidad. Va tapado por defecto — copiar no necesita
                    verlo, y así no queda a la vista de quien pase por detrás. */}
                <input className="input caja-link-field" readOnly suppressHydrationWarning
                  type={verEnlace ? 'text' : 'password'} value={installUrl}
                  onFocus={e => e.currentTarget.select()} aria-label="Enlace de instalación" />
                <button type="button" className="btn btn-secondary" onClick={() => setVerEnlace(v => !v)}
                  aria-label={verEnlace ? 'Ocultar el enlace' : 'Ver el enlace'}>
                  {verEnlace ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
                  {verEnlace ? 'Ocultar' : 'Ver'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={copiar}>
                  {copied ? <><Check size={14} strokeWidth={2} /> Copiado</> : <><Copy size={14} strokeWidth={2} /> Copiar</>}
                </button>
              </div>

              {/* Instalar en el móvil de al lado sin mandar por Telegram una URL larguísima
                  que además lleva la credencial dentro.

                  EN MODAL, y no impreso en la página: el QR **es la llave** del punto de
                  venta —quien lo escanee puede cobrar—, y dejarlo pintado en la pantalla lo
                  deja a la vista de cualquiera que pase por detrás del mostrador o mire una
                  captura. Se enseña cuando se pide, se usa para instalar y se cierra. Cada
                  pulsación lo genera de nuevo a partir del enlace VIGENTE, así que después
                  de regenerar el enlace nunca se puede estar mirando el QR muerto. */}
              {/* Los dos EN FILA y a su ancho: apilados y a todo lo ancho parecían dos
                  acciones principales del tamaño de un botón de guardar, cuando una se usa
                  una vez (instalar) y la otra casi nunca (perder el móvil). Lo que hace
                  «Regenerar» se explica debajo; no cabe dentro de la etiqueta. */}
              <div className="caja-install-acciones">
                <button type="button" className="btn btn-secondary" onClick={verQr} disabled={generandoQr}>
                  <QrCode size={14} strokeWidth={2} /> {generandoQr ? 'Generando…' : 'Ver código QR'}
                </button>

                {puedeEditar && (
                  <button type="button" className="btn btn-secondary" onClick={() => setConfirmarRegenerar(true)} disabled={isPending}>
                    <RefreshCw size={14} strokeWidth={2} /> Regenerar enlace
                  </button>
                )}
              </div>
              <p className="caja-install-hint">
                Regenerar invalida el enlace anterior: los dispositivos ya instalados dejan de
                sincronizar hasta que los reinstales.
              </p>
            </div>
          </div>

          <div className="card caja-entrega">
            <h2 className="mon-section-title">Cómo instalar la caja</h2>
            <ol className="caja-entrega-pasos">
              <li>Abre el enlace de arriba (o compártelo por Telegram / WhatsApp) en el móvil o tablet que hará de caja.</li>
              <li>Pulsa <strong>«Instalar»</strong> para dejarla como una app en la pantalla de inicio.</li>
              <li>Abre el turno y empieza a cobrar. Después funciona <strong>sin conexión</strong>.</li>
            </ol>
          </div>
        </>
      )}

      {/* ── Configuración ── */}
      {puedeEditar && tab === 'config' && (
        <form className="card caja-config-form" onSubmit={guardar}>
          <h2 className="mon-section-title">Configuración</h2>

          <div className="input-group">
            <label htmlFor="cfg-nombre">Nombre <span className="required">*</span></label>
            <input id="cfg-nombre" className="input" value={nombre} onChange={e => setNombre(e.target.value)} />
          </div>

          {multiempresa && (
            <div className="input-group">
              <label htmlFor="cfg-empresa">
                Empresa <span className="label-hint">(a quién pertenece este punto de venta)</span>
              </label>
              <select id="cfg-empresa" className="input" value={empresaId}
                onChange={e => cambiarEmpresa(e.target.value)}>
                {data.empresas.map(emp => (
                  <option key={emp.empresa_id} value={emp.empresa_id}>{emp.nombre}</option>
                ))}
              </select>
              {cambiaEmpresa && (
                <p className="caja-install-hint">
                  Vuelve a elegir el almacén y las cuentas: los anteriores eran de{' '}
                  <strong>{nombreEmpresa(data.caja.empresa_id)}</strong>.
                </p>
              )}
            </div>
          )}

          {data.tieneInventario ? (
            <div className="input-group">
              <label htmlFor="cfg-almacen">Almacén <span className="label-hint">(de dónde descuenta stock)</span></label>
              <select id="cfg-almacen" className="input" value={almacenId} onChange={e => setAlmacenId(e.target.value)}>
                <option value="">— Sin descuento de stock —</option>
                {empresaAlmacenes.map(a => <option key={a.almacen_id} value={a.almacen_id}>{a.nombre}</option>)}
              </select>
            </div>
          ) : (
            <p className="caja-install-hint">
              Sin módulo Inventario: la caja no descuenta stock (los productos se teclean a mano en el dispositivo).
            </p>
          )}

          {/* Solo con los DOS módulos hay algo que elegir: con uno solo, lo que baja ya
              está determinado y un selector con una opción real es ruido. */}
          {data.tieneInventario && data.tieneServicios && (
            <div className="input-group">
              <label htmlFor="cfg-tipos">
                Qué se vende aquí <span className="label-hint">(qué baja al dispositivo)</span>
              </label>
              <select id="cfg-tipos" className="input" value={tiposCatalogo}
                onChange={e => setTiposCatalogo(e.target.value)}>
                <option value="PRODUCTO">Solo productos físicos</option>
                <option value="SERVICIO">Solo servicios</option>
                <option value="AMBOS">Servicios y productos</option>
              </select>
              {tiposCatalogo !== 'PRODUCTO' && (
                <p className="caja-install-hint">
                  Los servicios no descuentan stock: se cobran y ya.
                </p>
              )}
              {/* La MISMA venta contada dos veces: el cierre de caja escribe su fila de
                  ingreso y la factura de la suscripción cuenta como Ventas. Se avisa, no
                  se bloquea — cobrar un extra en el mostrador puede ser lo correcto. */}
              {tiposCatalogo !== 'PRODUCTO' && data.suscribiblesActivos > 0 && (
                <div className="alert alert-warning mt-2">
                  <span>
                    <strong>{data.suscribiblesActivos}</strong>{' '}
                    {data.suscribiblesActivos === 1
                      ? 'de tus servicios se factura'
                      : 'de tus servicios se facturan'}{' '}
                    por suscripción. Si además {data.suscribiblesActivos === 1 ? 'lo cobras' : 'los cobras'}{' '}
                    aquí, esa venta se contará <strong>dos veces</strong> en tus informes.
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="input-group">
            <label>Monedas aceptadas{data.tieneBase ? ' y su caja en Tesorería' : ''}</label>
            {data.monedas.length === 0 ? (
              <p className="caja-install-hint">No hay monedas activas. Configúralas en «Monedas y tasas».</p>
            ) : (
              <div className="caja-moneda-list">
                {data.monedas.map(m => {
                  const checked = monedas.includes(m)
                  const cuentasM = cuentasDe(m)
                  return (
                    <div key={m} className="caja-moneda-row">
                      <label className="caja-moneda-check">
                        <input type="checkbox" checked={checked} onChange={() => toggleMoneda(m)} /> {m}
                      </label>
                      {checked && data.tieneBase && (
                        cuentasM.length > 0 ? (
                          <>
                            <select className="input" value={cuentas[m] ?? ''}
                              aria-label={`Caja de efectivo para ${m}`}
                              onChange={e => setCuentas(prev => ({ ...prev, [m]: e.target.value }))}>
                              <option value="">— Elige la caja de {m} —</option>
                              {cuentasM.map(c => <option key={c.cuenta_id} value={c.cuenta_id}>{c.nombre}</option>)}
                            </select>
                            {/* Lo cobrado por transferencia no entra en la gaveta, entra en
                                el banco. Sin esto el saldo de la caja física decía tener un
                                dinero que no está, y el arqueo del turno no podía cuadrar.
                                Opcional: vacío = todo a la cuenta de arriba, como siempre. */}
                            <select className="input" value={transf[m] ?? ''}
                              aria-label={`Cuenta de transferencias para ${m}`}
                              onChange={e => setTransf(prev => ({ ...prev, [m]: e.target.value }))}>
                              <option value="">— Transferencias: a la misma caja —</option>
                              {cuentasM.map(c => <option key={c.cuenta_id} value={c.cuenta_id}>Transferencias → {c.nombre}</option>)}
                            </select>
                          </>
                        ) : (
                          <p className="caja-moneda-sin-cuenta">
                            No tienes una caja en {m} para esta empresa, así que sus ventas no llegarían
                            a tu contabilidad.{' '}
                            <Link href="/portal/tesoreria" className="link-primary">Añádela en Tesorería</Link>
                            {' '}o deja de aceptar {m}.
                          </p>
                        )
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {!data.tieneBase && (
              <p className="caja-install-hint">
                Sin módulo Contabilidad: las ventas no se registran en Tesorería (quedan solo en el detalle de la caja).
              </p>
            )}
            <p className="caja-install-hint">
              ¿No ves tu moneda?{' '}
              <Link href="/portal/monedas" className="link-primary">Añádela en Monedas y tasas</Link>.
            </p>
          </div>

          <div className="caja-actions">
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : 'Guardar configuración'}
            </button>
          </div>
        </form>
      )}

      {/* El QR, mientras se está usando. Se cierra y desaparece de memoria: la próxima vez
          se vuelve a generar contra el enlace vigente. */}
      {qrDataUrl && (
        <div className="modal-backdrop open dialog-top" onClick={cerrarQr}>
          <div className="modal modal-alert caja-qr-modal" role="dialog" aria-modal
            aria-label="Código QR de instalación" onClick={e => e.stopPropagation()}>
            {/* Cerrar con la «×» de la cabecera, como el resto de modales del portal. El
                botón del pie ocupaba una franja entera para la acción menos interesante de
                la pantalla, y encima era `btn-primary`: el ojo lo leía como «lo que hay que
                pulsar», cuando lo que hay que hacer es escanear. */}
            <div className="modal-header">
              <h2 className="modal-title dialog-title">Instalar en un dispositivo</h2>
              <button type="button" className="modal-close" onClick={cerrarQr} aria-label="Cerrar" autoFocus>
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            <div className="modal-body">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="Código QR del enlace de instalación" className="caja-qr-img" />
              <p className="caja-install-hint">
                Apunta con la cámara del móvil que hará de caja. <strong>Trátalo como una llave</strong>:
                quien lo escanee puede cobrar en este punto de venta.
              </p>
            </div>
          </div>
        </div>
      )}

      {confirmarRegenerar && (
        <ConfirmDialog
          danger
          title="Regenerar el enlace de instalación"
          confirmLabel="Regenerar"
          onCancel={() => setConfirmarRegenerar(false)}
          onConfirm={regenerar}
          body={
            <>
              <p>
                El enlace actual <strong>dejará de funcionar</strong>. Es lo que hay que hacer si se
                perdió el móvil o el enlace acabó donde no debía.
              </p>
              <p>
                <strong>Los dispositivos ya instalados dejarán de sincronizar</strong> hasta que
                los reinstales con el enlace nuevo. Lo que tengan sin enviar no se pierde, pero
                solo podrá entrar exportando su archivo y subiéndolo en «Sincronizar».
              </p>
              <p>Si hay una caja vendiendo ahora mismo, hazlo cuando cierre el turno.</p>
            </>
          }
        />
      )}

      {confirmarEmpresa && (
        <ConfirmDialog
          danger
          title="Cambiar la empresa del punto de venta"
          confirmLabel="Cambiar empresa"
          onCancel={() => setConfirmarEmpresa(false)}
          onConfirm={persistir}
          body={
            <>
              <p>
                Este punto de venta pasa de <strong>{nombreEmpresa(data.caja.empresa_id)}</strong>{' '}
                a <strong>{nombreEmpresa(empresaId)}</strong>. A partir de ahora sus ventas
                se registrarán en la contabilidad de {nombreEmpresa(empresaId)}.
              </p>
              {data.tieneHistorico && (
                <p>
                  <strong>Lo ya sincronizado no se mueve.</strong> Los cierres y los tickets
                  que ya subiste siguen contabilizados en {nombreEmpresa(data.caja.empresa_id)}.
                  El cambio solo afecta a lo que venga a partir de ahora.
                </p>
              )}
              <p>
                Tendrás que volver a elegir el almacén y las cuentas de Tesorería, porque los
                actuales son de {nombreEmpresa(data.caja.empresa_id)}.
              </p>
              <p>
                Y hay que <strong>sincronizar el dispositivo</strong> donde esté instalado:
                hasta que lo haga, sigue cobrando con la configuración vieja.
              </p>
            </>
          }
        />
      )}
    </div>
  )
}
