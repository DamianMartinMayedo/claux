'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Copy, Check, RefreshCw, Eye, EyeOff, QrCode, X, Plus, UserPlus, Trash2 } from 'lucide-react'
import {
  guardarConfigCaja, regenerarToken, guardarOperador, archivarOperador,
  asignarOperadoresCaja, importarPersonalRRHH, listarPersonalImportable,
  type CajaConfigData, type Operador, type PersonalImportable,
} from '@/app/actions/portal/caja'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { slugPuntoVenta } from '@/lib/caja/slug'
import Tabs from '@/components/Tabs'
import CampaniasPanel, { CAMPANIA_VACIA, type BorradorCampania } from './CampaniasPanel'

type TabId = 'caja' | 'config' | 'campanias'

/**
 * Traer gente del personal a la lista de cajeros de ESTE punto de venta, eligiendo.
 * Mismo patrón (y misma tabla dentro de un modal) que «Importar personal» de Citas:
 * antes se importaba la plantilla entera, y con 500 trabajadores y 30 puntos de venta
 * eso significaba quitar uno a uno a los que no atienden este mostrador.
 */
function ImportarPersonalModal({ personal, onClose, onImportar, isPending }: {
  personal:   PersonalImportable[]
  onClose:    () => void
  onImportar: (ids: string[]) => void
  isPending:  boolean
}) {
  const disponibles = personal.filter(p => !p.ya_operador)
  // Nadie marcado de entrada: elegir es justamente lo que se venía a hacer aquí, y con
  // una plantilla larga «desmarcar 480» es el mismo trabajo que había antes.
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set())
  const todos = marcados.size === disponibles.length && disponibles.length > 0

  function toggle(id: string) {
    setMarcados(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  function toggleTodos() {
    setMarcados(todos ? new Set() : new Set(disponibles.map(p => p.empleado_id)))
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-lg" role="dialog" aria-modal aria-label="Importar del personal">
        <div className="modal-header">
          <h2 className="modal-title">Importar del personal</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className="modal-body">
          {personal.length === 0 ? (
            <p className="input-hint">
              No hay nadie en el personal de esta empresa. Da de alta a tus trabajadores en
              RRHH, o escribe el nombre a mano en la lista de cajeros.
            </p>
          ) : (
            <>
              <p className="input-hint mb-3">
                Marca a quien atienda <strong>este</strong> punto de venta. Quedan añadidos y ya
                marcados aquí; el resto de la plantilla no se toca.
              </p>
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="col-center">
                        <input type="checkbox" checked={todos} onChange={toggleTodos}
                          aria-label="Marcar todos" disabled={disponibles.length === 0} />
                      </th>
                      <th>Persona</th>
                      <th>Puesto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {personal.map(p => (
                      <tr key={p.empleado_id} className={p.ya_operador ? 'row-inactive' : undefined}>
                        <td data-label="Importar" className="col-center">
                          <input type="checkbox" checked={marcados.has(p.empleado_id)}
                            disabled={p.ya_operador} onChange={() => toggle(p.empleado_id)}
                            aria-label={`Importar a ${p.nombre}`} />
                        </td>
                        <td data-label="Persona">
                          <strong className="text-sm-bold cell-clamp">{p.nombre}</strong>
                          {/* Ya está: se enseña apagado en vez de esconderse, o la pregunta
                              pasa a ser «¿y este por qué no sale en la lista?». */}
                          {p.ya_operador && <div className="table-cell-secondary">Ya está en la lista</div>}
                        </td>
                        <td data-label="Puesto" className="text-sm-muted">{p.cargo ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={isPending || marcados.size === 0}
            onClick={() => onImportar([...marcados])}>
            {isPending
              ? <><span className="spinner spinner-sm" /> Importando…</>
              : `Importar ${marcados.size}`}
          </button>
        </div>
      </div>
    </div>
  )
}

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

  // Operadores: la lista es del cliente, las casillas son de ESTA caja. La lista se
  // lleva en estado (las acciones la devuelven ya actualizada) en vez de recargar la
  // página: añadir un cajero no puede llevarse por delante la configuración que el
  // dueño tenga a medio cambiar en este mismo formulario.
  const [operadores, setOperadores] = useState<Operador[]>(data.operadores)
  const [opsCaja, setOpsCaja]       = useState<string[]>(data.operadoresCaja)
  const [nuevoOperador, setNuevoOperador] = useState('')
  const [confirmarBaja, setConfirmarBaja] = useState<Operador | null>(null)
  // La plantilla no viaja con la página: se pide al abrir el modal (ver
  // `listarPersonalImportable`). `null` = modal cerrado.
  const [personal, setPersonal] = useState<PersonalImportable[] | null>(null)
  const [cargandoPersonal, setCargandoPersonal] = useState(false)
  // El alta/edición de campañas se abre desde la cabecera de la página (arriba a la
  // derecha) y se pinta dentro de `CampaniasPanel`: el borrador tiene que vivir donde
  // llegan los dos.
  const [borradorCampania, setBorradorCampania] = useState<BorradorCampania | null>(null)

  // El selector de empresa solo aparece si hay más de una: con una sola no es una
  // decisión, es ruido (y no hay a dónde mover el punto de venta).
  // ¿Este cliente tiene servicios que pueda vender en el mostrador? Con el módulo
  // Servicios, seguro; sin él, si ya ha catalogado alguno en el catálogo del mostrador.
  const hayServicios  = data.tieneServicios || data.serviciosActivos > 0
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
      toastSuccess('Enlace regenerado. Reinstala el punto de venta con el enlace nuevo.')
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

  function toggleOperador(id: string) {
    setOpsCaja(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function anadirOperador() {
    const limpio = nuevoOperador.trim()
    if (!limpio) return
    const ld = toastLoading('Añadiendo…')
    startTransition(async () => {
      const r = await guardarOperador(data.caja.caja_id, limpio)
      await ld.dismiss()
      if (!r.ok || !r.operadores) { toastError(r.error ?? 'No se pudo añadir.'); return }
      // Recién creado = quien lo teclea aquí lo quiere en ESTA caja. Marcarlo solo es
      // la mitad: se guarda con el resto de la configuración, como las monedas.
      const nuevos = r.operadores.filter(o => !operadores.some(p => p.operador_id === o.operador_id))
      setOperadores(r.operadores)
      setOpsCaja(prev => [...new Set([...prev, ...nuevos.map(o => o.operador_id)])])
      setNuevoOperador('')
    })
  }

  function darDeBaja(op: Operador) {
    setConfirmarBaja(null)
    const ld = toastLoading('Quitando…')
    startTransition(async () => {
      const r = await archivarOperador(data.caja.caja_id, op.operador_id)
      await ld.dismiss()
      if (!r.ok || !r.operadores) { toastError(r.error ?? 'No se pudo quitar.'); return }
      setOperadores(r.operadores)
      setOpsCaja(prev => prev.filter(x => x !== op.operador_id))
    })
  }

  /** Abrir el modal: primero la lista, que no viene con la página. */
  function abrirImportar() {
    setCargandoPersonal(true)
    startTransition(async () => {
      const r = await listarPersonalImportable(data.caja.caja_id)
      setCargandoPersonal(false)
      if (!r.ok || !r.personal) { toastError(r.error ?? 'No se pudo leer el personal.'); return }
      setPersonal(r.personal)
    })
  }

  function importarRrhh(empleado_ids: string[]) {
    const ld = toastLoading('Importando…')
    startTransition(async () => {
      const r = await importarPersonalRRHH(data.caja.caja_id, empleado_ids)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo importar.'); return }
      if (r.operadores) setOperadores(r.operadores)
      // Marcados en ESTA caja de una vez: se eligieron de una lista titulada «quién
      // maneja este punto». Se guarda con el resto de la configuración, como las casillas.
      if (r.nuevos?.length) setOpsCaja(prev => [...new Set([...prev, ...r.nuevos!])])
      setPersonal(null)
      toastSuccess(r.importados
        ? `${r.importados} ${r.importados === 1 ? 'persona importada y marcada' : 'personas importadas y marcadas'}. Guarda la configuración.`
        : 'No se importó a nadie.')
    })
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
      const [r, rOps] = await Promise.all([
        guardarConfigCaja(data.caja.caja_id, {
          nombre, empresa_id: empresaId, almacen_id: almacenId || null,
          monedas_aceptadas: monedas, cuentas_moneda: cuentasFiltradas,
          cuentas_transferencia: transfFiltradas,
          tipos_catalogo: tiposCatalogo,
        }),
        // Quién maneja la caja va con el resto de la configuración, no en cada clic:
        // es la misma decisión que las monedas aceptadas y se guarda con ellas.
        asignarOperadoresCaja(data.caja.caja_id, opsCaja),
      ])
      await ld.dismiss()
      if (!r.ok)    { toastError(r.error ?? 'No se pudo guardar.'); return }
      if (!rOps.ok) { toastError(rOps.error ?? 'No se pudo guardar quién atiende el punto de venta.'); return }
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
        {/* La acción de la pestaña abierta, arriba a la derecha, en el mismo sitio que
            «Nuevo empleado» en Personal. El formulario lo pinta `CampaniasPanel`, pero
            quien lo abre es esta cabecera: por eso el borrador es estado de la página. */}
        {puedeEditar && tab === 'campanias' && (
          <div className="tes-header-actions">
            <button type="button" className="btn btn-primary"
              onClick={() => setBorradorCampania({ ...CAMPANIA_VACIA })}>
              <Plus size={14} strokeWidth={2.5} /> Nueva campaña
            </button>
          </div>
        )}
      </div>

      <Tabs
        tabs={[
          { id: 'caja', label: 'Instalación' },
          ...(puedeEditar ? [{ id: 'config' as const, label: 'Configuración' }] : []),
          // Las campañas se VEN aunque no se puedan tocar: quien tiene solo lectura
          // también necesita saber por qué la caja está cobrando un 10 % menos.
          { id: 'campanias' as const, label: 'Descuentos', count: data.campanias.length || undefined },
        ]}
        active={tab}
        /* Cambiar de pestaña CIERRA el formulario de campañas: si no, se queda abierto en
           segundo plano y reaparece al volver, con lo que se estuviera escribiendo. */
        onChange={id => { setTab(id); setBorradorCampania(null) }}
        ariaLabel="Secciones del punto de venta"
      />

      {/* ── La caja: enlace de instalación + cómo entregarla ── */}
      {tab === 'caja' && (
        <>
          <div className="card caja-config-section">
            <h2 className="mon-section-title">Enlace de instalación</h2>
            <p className="caja-section-sub">
              Instala este punto de venta en un móvil o una tablet. Cópialo o compártelo con quien
              vaya a usarlo.
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
              {/* Solo la consecuencia inmediata: el detalle (lo que pasa con lo que el
                  dispositivo tenga sin enviar) está en la confirmación, que es donde se
                  decide. Decirlo dos veces hacía que no se leyera ninguna. */}
              <p className="caja-install-hint">
                Regenerar invalida el enlace anterior.
              </p>
            </div>
          </div>

          <div className="card caja-entrega">
            <h2 className="mon-section-title">Cómo instalarlo</h2>
            <ol className="caja-entrega-pasos">
              <li>Abre el enlace en el móvil o la tablet que hará de punto de venta.</li>
              <li>Pulsa <strong>«Instalar»</strong> para añadirlo a la pantalla de inicio.</li>
              <li>Abre el turno y empieza a cobrar: desde ahí funciona <strong>sin conexión</strong>.</li>
            </ol>
          </div>
        </>
      )}

      {/* ── Campañas de descuento (mig. 210) ── */}
      {tab === 'campanias' && (
        <CampaniasPanel cajaId={data.caja.caja_id} campanias={data.campanias}
          productos={data.productos} puedeEditar={puedeEditar}
          borrador={borradorCampania} onBorrador={setBorradorCampania} />
      )}

      {/* ── Configuración ── */}
      {/* La configuración va por SECCIONES, no en una columna de doce campos: el nombre del
          punto, sus monedas y quién lo maneja son tres decisiones distintas y el dueño entra
          a tocar una. Siguen siendo un SOLO formulario —se guarda todo de una vez— para no
          partir en tres botones lo que es una sola respuesta. */}
      {puedeEditar && tab === 'config' && (
        <form className="caja-config-form" onSubmit={guardar}>
          <section className="card caja-config-bloque">
            <h2 className="mon-section-title">General</h2>

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
                    Vuelve a elegir el almacén y las cuentas: los actuales son de{' '}
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
                Sin el módulo Inventario no se descuenta stock. Lo que se vende aquí se cataloga
                en <Link href="/portal/caja/productos">el catálogo del punto de venta</Link>.
              </p>
            )}

            {/* Hay algo que elegir cuando el cliente TIENE servicios que ofrecer: con el
                módulo Servicios, o porque los cataloga en el mostrador (con solo Caja, un
                barbero mete «corte de pelo» junto al champú). Sin ningún servicio el
                selector es un desplegable con una opción real, o sea ruido. */}
            {hayServicios && (
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
                    Los servicios no descuentan stock.
                  </p>
                )}
                {/* El catálogo y la rejilla son dos cosas: catalogar un servicio no lo pone
                    en el dispositivo si aquí dice «solo productos físicos». Antes se queda-
                    ba fuera en silencio y el dueño lo buscaba en el aparato. */}
                {tiposCatalogo === 'PRODUCTO' && data.serviciosActivos > 0 && (
                  <p className="caja-install-hint">
                    Tienes <strong>{data.serviciosActivos}</strong>{' '}
                    {data.serviciosActivos === 1 ? 'servicio' : 'servicios'} en el catálogo que{' '}
                    <strong>no {data.serviciosActivos === 1 ? 'baja' : 'bajan'}</strong> al
                    dispositivo con esta opción.
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
          </section>

          <section className="card caja-config-bloque">
            <h2 className="mon-section-title">Monedas</h2>

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
                              No hay una caja en {m} para esta empresa: sus ventas no llegarían a la
                              contabilidad.{' '}
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
                  Sin el módulo Contabilidad las ventas no se registran en Tesorería: quedan en el
                  detalle del punto de venta.
                </p>
              )}
              <p className="caja-install-hint">
                ¿No ves tu moneda?{' '}
                <Link href="/portal/monedas" className="link-primary">Añádela en Monedas y tasas</Link>.
              </p>
            </div>
          </section>

          <section className="card caja-config-bloque">
            <h2 className="mon-section-title">Trabajadores</h2>

            {/* La lista es del CLIENTE (un cajero se teclea una vez, no una por caja) y las
                casillas son de ESTE punto de venta: solo los marcados bajan al dispositivo.
                En el aparato el nombre de quien lleva el turno es OBLIGATORIO, así que esta
                lista es lo que hace que sea ELEGIR y no teclear: un campo libre en un
                mostrador con cola se rellena con «x», y entonces «¿quién llevó este turno?»
                no tiene respuesta. */}
            <div className="input-group">
              <label>
                Quién atiende este punto de venta{' '}
                <span className="label-hint">(se elige al abrir y al cerrar el turno)</span>
              </label>

              {operadores.length === 0 ? (
                <p className="caja-install-hint">
                  Aún no hay nadie. Añade a quien atienda el mostrador.
                </p>
              ) : (
                <div className="caja-moneda-list">
                  {operadores.map(op => (
                    <div key={op.operador_id} className="caja-operador-row">
                      <label className="caja-moneda-check">
                        <input type="checkbox" checked={opsCaja.includes(op.operador_id)}
                          onChange={() => toggleOperador(op.operador_id)} disabled={!puedeEditar} />
                        {' '}{op.nombre}
                      </label>
                      {/* Del personal de RRHH: se dice, porque renombrarlo aquí no cambia
                          su ficha de empleado y conviene que se sepa antes de tocarlo. */}
                      {op.empleado_id && <span className="badge badge-neutral">Del personal</span>}
                      {puedeEditar && (
                        <button type="button" className="btn-icon btn-icon-danger" title={`Quitar a ${op.nombre}`}
                          aria-label={`Quitar a ${op.nombre}`} onClick={() => setConfirmarBaja(op)}>
                          <Trash2 size={14} strokeWidth={2} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {puedeEditar && (
                <div className="caja-operador-alta">
                  <input type="text" className="input" value={nuevoOperador} placeholder="Nombre y apellidos…"
                    aria-label="Nombre de la persona que atiende el punto de venta"
                    onChange={e => setNuevoOperador(e.target.value)}
                    /* Enter añade; sin esto el formulario se enviaría entero al pulsarlo. */
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); anadirOperador() } }} />
                  <button type="button" className="btn btn-secondary" disabled={isPending || !nuevoOperador.trim()}
                    onClick={anadirOperador}>
                    <Plus size={15} strokeWidth={2} /> Añadir
                  </button>
                  {/* Llenado rápido, nunca requisito: la caja funciona igual sin RRHH.
                      Mismo botón y mismo criterio que «Importar personal» de Citas. */}
                  {data.tieneRrhh && (
                    <button type="button" className="btn btn-secondary" disabled={isPending}
                      onClick={abrirImportar}>
                      {cargandoPersonal
                        ? <><span className="spinner spinner-sm" /> Buscando…</>
                        : <><UserPlus size={15} strokeWidth={2} /> Importar del personal</>}
                    </button>
                  )}
                </div>
              )}

              <p className="caja-install-hint">
                Solo los marcados bajan al dispositivo con la próxima sincronización.
              </p>
            </div>
          </section>

          <div className="caja-actions">
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : 'Guardar configuración'}
            </button>
          </div>
        </form>
      )}

      {personal && (
        <ImportarPersonalModal personal={personal} isPending={isPending}
          onClose={() => setPersonal(null)} onImportar={importarRrhh} />
      )}

      {confirmarBaja && (
        <ConfirmDialog
          title={`Quitar a ${confirmarBaja.nombre}`}
          confirmLabel="Quitar"
          onCancel={() => setConfirmarBaja(null)}
          onConfirm={() => darDeBaja(confirmarBaja)}
          body={
            <p>
              Dejará de salir en los dispositivos. <strong>Los turnos que ya llevó
              siguen con su nombre</strong>: el histórico no cambia.
            </p>
          }
        />
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
                Escanéalo con la cámara del dispositivo que hará de punto de venta.{' '}
                <strong>Trátalo como una llave</strong>: quien lo escanee puede cobrar aquí.
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
                El enlace actual <strong>dejará de funcionar</strong>. Hazlo si se perdió el
                dispositivo o el enlace quedó en manos ajenas.
              </p>
              <p>
                <strong>Los dispositivos ya instalados dejarán de sincronizar</strong> hasta que
                los reinstales con el enlace nuevo. Lo que tengan sin enviar no se pierde, pero
                solo podrá entrar exportando su archivo y subiéndolo en «Sincronizar».
              </p>
              <p>Si hay un punto de venta cobrando ahora mismo, espera a que cierre el turno.</p>
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
