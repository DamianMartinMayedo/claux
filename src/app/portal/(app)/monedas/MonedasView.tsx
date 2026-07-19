'use client'

import { toastError } from '@/app/contexts/ToastContext'
import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, Plus, Pencil, Trash2, RefreshCw, Star, ArrowRight, Info, AlertTriangle } from 'lucide-react'
import { CATALOGO_MONEDAS } from '@/lib/monedas-catalogo'
import { puntosVentaConMoneda } from '@/app/actions/portal/caja'
import {
  guardarMoneda,
  guardarPar,
  cambiarMonedaConsolidacion,
  actualizarTasasAuto,
  contarUsoMoneda,
  eliminarMoneda,
  type Moneda,
  type Par,
  type UsoMoneda,
} from '@/app/actions/portal/monedas'

// ── Helpers ───────────────────────────────────────────────────────────────────

const FUENTE_LABEL: Record<string, string> = {
  EL_TOQUE:    'El Toque',
  FRANKFURTER: 'Frankfurter',
  MANUAL:      'Manual',
}

const FUENTE_COLOR: Record<string, string> = {
  EL_TOQUE:    'var(--color-primary)',
  FRANKFURTER: 'var(--color-success)',
  MANUAL:      'var(--color-text-muted)',
}

function fmtTasa(t?: number) {
  if (t == null) return '—'
  return t.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}

// ── Modal Moneda ──────────────────────────────────────────────────────────────

function MonedaModal({
  moneda,
  onClose,
  onSaved,
  onPedirEliminar,
}: {
  moneda:  Moneda | null
  onClose: () => void
  onSaved: () => void
  onPedirEliminar: () => void
}) {
  const catalogoArr = [...CATALOGO_MONEDAS]
  const [isPending, startTransition] = useTransition()
  const [catalogo,  setCatalogo]     = useState<string>(() => {
    if (!moneda) return 'USD'
    const hit = catalogoArr.find(c => c.codigo === moneda.codigo)
    return hit ? hit.codigo : 'OTRA'
  })
  const [nombre,  setNombre]  = useState(moneda?.nombre  ?? catalogoArr[0].nombre)
  const [simbolo, setSimbol]  = useState(moneda?.simbolo ?? catalogoArr[0].simbolo)
  const [codigo,  setCodigo]  = useState(moneda?.codigo  ?? '')

  const esEdicion = !!moneda

  // Puntos de venta que aceptan esta moneda: si se desactiva, dejan de poder cobrar en
  // ella al sincronizar. Se consulta al abrir la edición (una query) para poder nombrar
  // cuáles en el aviso, en vez de que se entere el cajero en el mostrador.
  const [activa, setActiva]   = useState(moneda?.activa ?? true)
  const [puntos, setPuntos]   = useState<string[]>([])
  useEffect(() => {
    if (!moneda) return
    let vivo = true
    puntosVentaConMoneda(moneda.codigo).then(p => { if (vivo) setPuntos(p) })
    return () => { vivo = false }
  }, [moneda])

  function handleCatalogoChange(val: string) {
    setCatalogo(val)
    if (val !== 'OTRA') {
      const hit = catalogoArr.find(c => c.codigo === val)
      if (hit) { setNombre(hit.nombre); setSimbol(hit.simbolo); setCodigo('') }
    } else {
      setNombre(''); setSimbol(''); setCodigo('')
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await guardarMoneda(fd)
      if (!result.ok) { toastError(result.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-520" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{esEdicion ? 'Editar moneda' : 'Añadir moneda'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={20} strokeWidth={2} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body modal-body-wide">
            {esEdicion && <input type="hidden" name="codigo_original" value={moneda.codigo} />}

            <div className="mon-form-grid">

              {!esEdicion && (
                <div className="input-group mon-full">
                  <label>Moneda <span className="required">*</span></label>
                  <select
                    className="input"
                    name="catalogo"
                    value={catalogo}
                    onChange={e => handleCatalogoChange(e.target.value)}
                  >
                    {catalogoArr.map(m => (
                      <option key={m.codigo} value={m.codigo}>
                        {m.codigo} — {m.nombre}
                      </option>
                    ))}
                    <option value="OTRA">Otra (personalizada)</option>
                  </select>
                </div>
              )}

              {(!esEdicion && catalogo === 'OTRA') && (
                <div className="input-group mon-full">
                  <label>Código <span className="required">*</span></label>
                  <input
                    className="input input-uppercase"
                    name="codigo"
                    value={codigo}
                    onChange={e => setCodigo(e.target.value.toUpperCase())}
                    placeholder="Ej: CUPB"
                    maxLength={10}
                    required
                  />
                  <span className="input-hint">Identificador único, sin espacios. Ej: CUPB para tasa oficial bancaria.</span>
                </div>
              )}

              <div className="input-group">
                <label>Nombre <span className="required">*</span></label>
                <input
                  className="input"
                  name="nombre"
                  value={nombre}
                  onChange={e => setNombre(e.target.value)}
                  placeholder="Ej: Peso cubano bancario"
                  required
                />
              </div>

              <div className="input-group">
                <label>Símbolo</label>
                <input
                  className="input"
                  name="simbolo"
                  value={simbolo}
                  onChange={e => setSimbol(e.target.value)}
                  placeholder="Ej: $"
                  maxLength={5}
                />
              </div>

              {esEdicion && !moneda.es_consolidacion && (
                <div className="input-group mon-full">
                  <label>Estado</label>
                  <select className="input" name="activa" value={activa ? 'true' : 'false'}
                    onChange={e => setActiva(e.target.value === 'true')}>
                    <option value="true">Activa</option>
                    <option value="false">Inactiva</option>
                  </select>
                  {!activa && puntos.length > 0 && (
                    <div className="alert alert-warning mon-aviso-puntos">
                      <AlertTriangle size={16} strokeWidth={2} />
                      <span>
                        {puntos.length === 1
                          ? <>El punto de venta <strong>{puntos[0]}</strong> cobra en {moneda.codigo}.</>
                          : <>Estos puntos de venta cobran en {moneda.codigo}: <strong>{puntos.join(', ')}</strong>.</>}
                        {' '}Al sincronizar dejarán de ofrecerla, y si era la única no podrán cobrar.
                      </span>
                    </div>
                  )}
                </div>
              )}

            </div>

          </div>

          <div className="modal-footer modal-footer-split">
            {esEdicion && !moneda.es_consolidacion && (
              <button type="button" className="btn btn-danger-text" onClick={onPedirEliminar} disabled={isPending}>
                <Trash2 size={14} strokeWidth={2} /> Eliminar
              </button>
            )}
            <div className="modal-footer-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={isPending}>
                {isPending
                  ? <><span className="spinner spinner-sm" />{esEdicion ? 'Guardando…' : 'Añadir'}</>
                  : esEdicion ? 'Guardar cambios' : 'Añadir moneda'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal Par ─────────────────────────────────────────────────────────────────

function ParModal({
  par,
  onClose,
  onSaved,
}: {
  par:     Par
  onClose: () => void
  onSaved: (tasa?: number, fecha?: string) => void
}) {
  const [isPending, startTransition] = useTransition()
  const [fuente, setFuente]  = useState<Par['fuente']>(par.fuente)
  const [tasa,   setTasa]    = useState(par.tasa?.toString() ?? '')

  // Si la fuente cambia a auto, limpiar la tasa manual (en el propio handler,
  // sin setState dentro de un efecto → evita renders en cascada).
  function cambiarFuente(nueva: Par['fuente']) {
    setFuente(nueva)
    if (nueva !== 'MANUAL') setTasa('')
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData()
    fd.set('par_id', par.par_id.toString())
    fd.set('fuente', fuente)
    if (fuente === 'MANUAL') fd.set('tasa', tasa)

    startTransition(async () => {
      const result = await guardarPar(fd)
      if (!result.ok) { toastError(result.error ?? 'Error inesperado.'); return }
      onSaved(result.tasa, result.fecha)
    })
  }

  const esAuto = fuente !== 'MANUAL'

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Configurar par</h2>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={20} strokeWidth={2} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body modal-body-form">

            {/* Identificación del par */}
            <div className="par-modal-id">
              <span className="par-cod">{par.origen}</span>
              <ArrowRight size={18} strokeWidth={2} />
              <span className="par-cod">{par.destino}</span>
            </div>

            <div className="input-group">
              <label>Fuente de la tasa</label>
              <select className="input" value={fuente} onChange={e => cambiarFuente(e.target.value as Par['fuente'])}>
                <option value="EL_TOQUE">El Toque — tasas informales CUP</option>
                <option value="FRANKFURTER">Frankfurter — mercado internacional</option>
                <option value="MANUAL">Manual — ingreso directo</option>
              </select>
            </div>

            {fuente === 'MANUAL' ? (
              <div className="input-group">
                <label>Tasa <span className="required">*</span></label>
                <input
                  className="input"
                  type="number"
                  step="any"
                  min="0.000001"
                  value={tasa}
                  onChange={e => setTasa(e.target.value)}
                  placeholder="Ej: 531.00"
                  required
                />
                <span className="input-hint">
                  Unidades de <strong>{par.destino}</strong> por cada unidad de <strong>{par.origen}</strong>
                </span>
              </div>
            ) : (
              <div className="par-auto-info">
                <Info size={16} strokeWidth={2} className="text-primary flex-shrink-0" />
                <span>
                  Al guardar se consultará <strong>{FUENTE_LABEL[fuente]}</strong> y se actualizará la tasa.
                  {par.tasa != null && (
                    <> Tasa actual: <strong>{fmtTasa(par.tasa)}</strong> ({par.fecha})</>
                  )}
                </span>
              </div>
            )}

          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" />{esAuto ? 'Obteniendo…' : 'Guardando…'}</>
                : esAuto ? 'Guardar y obtener tasa' : 'Guardar tasa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal Consolidación ───────────────────────────────────────────────────────

function ConsolidacionModal({
  monedas,
  actual,
  onClose,
  onSaved,
}: {
  monedas: Moneda[]
  actual:  string
  onClose: () => void
  onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [sel,       setSel]          = useState(actual)

  function handleConfirm() {
    if (sel === actual) { onClose(); return }
    startTransition(async () => {
      const result = await cambiarMonedaConsolidacion(sel)
      if (!result.ok) { toastError(result.error ?? 'Error.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-sm" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Moneda de consolidación</h2>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={20} strokeWidth={2} /></button>
        </div>
        <div className="modal-body modal-body-wide">
          <p className="text-sm-muted mb-4">
            Todos los estados consolidados se expresan en esta moneda (IAS 21).
          </p>
          <div className="mon-radio-list">
            {monedas.filter(m => m.activa).map(m => (
              <label key={m.codigo} className={`mon-radio-item${sel === m.codigo ? ' selected' : ''}`}>
                <input type="radio" name="consolidacion" value={m.codigo} checked={sel === m.codigo} onChange={() => setSel(m.codigo)} />
                <div className="mon-radio-info">
                  <strong>{m.codigo}</strong>
                  <span>{m.nombre}</span>
                </div>
                {m.es_consolidacion && <span className="mon-badge mon-badge-info">Actual</span>}
              </label>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={handleConfirm} disabled={isPending || sel === actual}>
            {isPending ? <><span className="spinner spinner-sm" />Cambiando…</> : 'Establecer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal Eliminar moneda ─────────────────────────────────────────────────────

function EliminarMonedaModal({
  moneda,
  monedas,
  onClose,
  onDone,
}: {
  moneda:  Moneda
  monedas: Moneda[]
  onClose: () => void
  onDone:  () => void
}) {
  const [uso,      setUso]      = useState<UsoMoneda | null>(null)
  const [accion,   setAccion]   = useState<'desactivar' | 'fusionar'>('desactivar')
  const [isPending, startTransition] = useTransition()

  const otras = monedas.filter(m => m.codigo !== moneda.codigo && m.activa)
  const [destino, setDestino] = useState(otras[0]?.codigo ?? '')

  useEffect(() => {
    let vivo = true
    contarUsoMoneda(moneda.codigo).then(u => { if (vivo) setUso(u) })
    return () => { vivo = false }
  }, [moneda.codigo])

  function eliminarLimpio() {
    startTransition(async () => {
      const r = await eliminarMoneda(moneda.codigo)
      if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
      onDone()
    })
  }

  function aplicarConDatos() {
    startTransition(async () => {
      if (accion === 'desactivar') {
        const fd = new FormData()
        fd.set('codigo_original', moneda.codigo)
        fd.set('nombre',  moneda.nombre)
        fd.set('simbolo', moneda.simbolo)
        fd.set('activa',  'false')
        const r = await guardarMoneda(fd)
        if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
        onDone()
      } else {
        if (!destino) { toastError('Elige una moneda destino.'); return }
        const r = await eliminarMoneda(moneda.codigo, destino)
        if (!r.ok) { toastError(r.error ?? 'Error inesperado.'); return }
        onDone()
      }
    })
  }

  const cargando = uso === null
  const sinDatos = uso !== null && uso.total === 0

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-xl" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Eliminar {moneda.codigo}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={20} strokeWidth={2} /></button>
        </div>

        <div className="modal-body modal-body-wide">
          {cargando ? (
            <div className="mon-uso-loading"><span className="spinner spinner-sm" /> Comprobando uso…</div>
          ) : (
            <div className="mon-elim-grid">

              {/* Izquierda: qué afecta */}
              <div className="mon-elim-side">
                <h3 className="mon-elim-h">Qué afecta</h3>
                {sinDatos ? (
                  <p className="text-sm-muted">
                    <strong>{moneda.codigo}</strong> no se usa en ningún documento. Solo se eliminarán su definición y sus pares de cambio.
                  </p>
                ) : (
                  <>
                    <p className="text-sm-muted mb-3">
                      <strong>{uso!.total}</strong> registro{uso!.total !== 1 ? 's' : ''} usan <strong>{moneda.codigo}</strong>:
                    </p>
                    <ul className="mon-uso-list">
                      {uso!.detalle.map(d => (
                        <li key={d.entidad}><span>{d.entidad}</span><strong>{d.n}</strong></li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              {/* Derecha: qué hacer */}
              <div className="mon-elim-side">
                <h3 className="mon-elim-h">Qué hacer</h3>
                {sinDatos ? (
                  <p className="text-sm-muted">
                    Al no haber datos asociados, se elimina por completo. Esta acción no se puede deshacer.
                  </p>
                ) : (
                  <>
                    <div className="mon-radio-list">
                      <label className={`mon-radio-item${accion === 'desactivar' ? ' selected' : ''}`}>
                        <input type="radio" name="accion-elim" checked={accion === 'desactivar'} onChange={() => setAccion('desactivar')} />
                        <div className="mon-radio-info">
                          <strong>Desactivar (recomendado)</strong>
                          <span>Deja de aparecer al crear documentos nuevos. Los {uso!.total} ya existentes se conservan intactos.</span>
                        </div>
                      </label>

                      <label className={`mon-radio-item${accion === 'fusionar' ? ' selected' : ''}${otras.length === 0 ? ' is-disabled' : ''}`}>
                        <input
                          type="radio"
                          name="accion-elim"
                          checked={accion === 'fusionar'}
                          disabled={otras.length === 0}
                          onChange={() => setAccion('fusionar')}
                        />
                        <div className="mon-radio-info">
                          <strong>Fusionar con otra moneda</strong>
                          <span>Reasigna esos registros a la moneda elegida y elimina {moneda.codigo}. No convierte importes: úsalo solo si {moneda.codigo} es un duplicado.</span>
                        </div>
                      </label>
                    </div>

                    {accion === 'fusionar' && otras.length > 0 && (
                      <div className="input-group mt-3">
                        <label>Reasignar a</label>
                        <select className="input" value={destino} onChange={e => setDestino(e.target.value)}>
                          {otras.map(m => (
                            <option key={m.codigo} value={m.codigo}>{m.codigo} — {m.nombre}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                )}
              </div>

            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancelar</button>
          {sinDatos ? (
            <button type="button" className="btn btn-danger" onClick={eliminarLimpio} disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" />Eliminando…</> : 'Eliminar moneda'}
            </button>
          ) : !cargando && (
            <button
              type="button"
              className={accion === 'fusionar' ? 'btn btn-danger' : 'btn btn-primary'}
              onClick={aplicarConDatos}
              disabled={isPending || (accion === 'fusionar' && !destino)}
            >
              {isPending
                ? <><span className="spinner spinner-sm" />Aplicando…</>
                : accion === 'desactivar' ? 'Desactivar' : 'Fusionar y eliminar'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

type ModalKind = 'none' | 'moneda' | 'par' | 'consolidacion' | 'eliminar'

interface Props {
  monedas: Moneda[]
  pares:   Par[]
  esAdmin: boolean
}

export default function MonedasView({ monedas: initMonedas, pares: initPares, esAdmin }: Props) {
  const router = useRouter()

  const [modalKind,     setModalKind]     = useState<ModalKind>('none')
  const [monedaEdit,    setMonedaEdit]    = useState<Moneda | null>(null)
  const [monedaEliminar, setMonedaEliminar] = useState<Moneda | null>(null)
  const [parEdit,       setParEdit]       = useState<Par | null>(null)

  // Tasas locales — se actualizan optimistamente tras guardar un par
  const [localPares, setLocalPares] = useState<Par[]>(initPares)
  useEffect(() => { setLocalPares(initPares) }, [initPares])

  const [autoMsg,     setAutoMsg]    = useState('')
  const [autoPending, startAutoTrans] = useTransition()

  const monedaConsolidacion = initMonedas.find(m => m.es_consolidacion)

  function cerrar() { setModalKind('none'); setMonedaEdit(null); setParEdit(null); setMonedaEliminar(null) }
  function onSavedMoneda() { cerrar(); router.refresh() }
  function onEliminada() { cerrar(); router.refresh() }
  function onSavedConsolidacion() { cerrar(); router.refresh() }

  function onSavedPar(tasa?: number, fecha?: string) {
    // Actualizar localmente sin esperar al refresh
    if (parEdit && tasa != null) {
      setLocalPares(prev => prev.map(p =>
        p.par_id === parEdit.par_id
          ? { ...p, fuente: parEdit.fuente, tasa, fecha }
          : p
      ))
    }
    cerrar()
    router.refresh()
  }

  function handleActualizarAuto() {
    setAutoMsg('')
    startAutoTrans(async () => {
      const result = await actualizarTasasAuto()
      const msg = result.actualizadas > 0
        ? `${result.actualizadas} tasa${result.actualizadas !== 1 ? 's' : ''} actualizadas.`
        : 'Sin nuevas tasas.'
      setAutoMsg(result.errores.length > 0 ? `${msg} · ${result.errores.join(' · ')}` : msg)
      router.refresh()
    })
  }

  return (
    <div className="view-container">

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Monedas y tasas</h1>
          <p className="page-subtitle">Configura las monedas y los tipos de cambio entre ellas.</p>
        </div>
        <div className="btn-group-wrap">
          <button className="btn btn-secondary" onClick={handleActualizarAuto} disabled={autoPending}>
            {autoPending ? <><span className="spinner spinner-sm" /> Actualizando…</> : <><RefreshCw size={15} strokeWidth={2} /> Actualizar automáticas</>}
          </button>
          {esAdmin && (
            <button className="btn btn-primary" onClick={() => { setMonedaEdit(null); setModalKind('moneda') }}>
              <Plus size={16} strokeWidth={2} /> Nueva moneda
            </button>
          )}
        </div>
      </div>

      {autoMsg && (
        <div className="alert alert-warning mb-5">{autoMsg}</div>
      )}

      <div className="mon-layout">

        {/* ── Columna izquierda: monedas ── */}
        <div className="card card-table">
          <div className="mon-card-header">
            <h2 className="mon-section-title">Monedas activas</h2>
            {esAdmin && initMonedas.some(m => m.activa) && (
              <button className="btn btn-secondary btn-sm" onClick={() => setModalKind('consolidacion')}>
                <Star size={13} strokeWidth={2} /> Consolidación
              </button>
            )}
          </div>

          {initMonedas.length === 0 ? (
            <div className="mon-empty">
              <Info size={36} strokeWidth={1} />
              <p>No hay monedas. Añade la primera.</p>
            </div>
          ) : (
            <ul className="mon-list">
              {initMonedas.map(m => (
                <li key={m.codigo} className="mon-item">
                  <div className="mon-avatar">{m.simbolo || m.codigo.charAt(0)}</div>
                  <div className="mon-info">
                    <div className="mon-info-top">
                      <strong className="mon-codigo">{m.codigo}</strong>
                      {m.es_consolidacion && <span className="mon-badge mon-badge-info">Consolidación</span>}
                      {!m.activa && <span className="mon-badge mon-badge-neutral">Inactiva</span>}
                    </div>
                    <div className="mon-nombre">{m.nombre}</div>
                  </div>
                  {esAdmin && (
                    <button
                      className="btn btn-secondary btn-xs"
                      onClick={() => { setMonedaEdit(m); setModalKind('moneda') }}
                      title="Editar"
                      aria-label={`Editar ${m.codigo}`}
                    >
                      <Pencil size={13} strokeWidth={2} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Columna derecha: pares de cambio ── */}
        <div className="card card-table">
          <div className="mon-card-header">
            <h2 className="mon-section-title">Pares de cambio</h2>
            <span className="text-xs-muted">
              Se generan al añadir monedas
            </span>
          </div>

          {localPares.length === 0 ? (
            <div className="mon-empty">
              <p>Añade al menos dos monedas para ver los pares.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Par</th>
                    <th className="col-num">Tasa</th>
                    <th>Fuente</th>
                    <th>Actualizada</th>
                    {esAdmin && <th className="col-actions" />}
                  </tr>
                </thead>
                <tbody>
                  {localPares.map(p => (
                    <tr key={p.par_id}>
                      <td data-label="Par">
                        <span className="mon-par">
                          <strong>{p.origen}</strong>
                          <ArrowRight size={12} strokeWidth={2} className="text-muted flex-shrink-0" />
                          <strong>{p.destino}</strong>
                        </span>
                      </td>
                      <td data-label="Tasa" className="col-num mon-tasa-val">
                        {fmtTasa(p.tasa)}
                      </td>
                      <td data-label="Fuente">
                        <span className="mon-fuente-dot" style={{ '--dot-color': FUENTE_COLOR[p.fuente] } as React.CSSProperties} />
                        <span className="text-xs">{FUENTE_LABEL[p.fuente]}</span>
                      </td>
                      <td data-label="Actualizada" className="text-xs-muted">
                        {p.fecha ?? '—'}
                      </td>
                      {esAdmin && (
                        <td className="col-actions">
                          <button
                            className="btn btn-secondary btn-xs"
                            title="Configurar par"
                            onClick={() => {
                              setParEdit(p)
                              setModalKind('par')
                            }}
                          >
                            <Pencil size={13} strokeWidth={2} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>

      {/* Modales */}
      {modalKind === 'moneda' && (
        <MonedaModal
          moneda={monedaEdit}
          onClose={cerrar}
          onSaved={onSavedMoneda}
          onPedirEliminar={() => { if (monedaEdit) { setMonedaEliminar(monedaEdit); setModalKind('eliminar') } }}
        />
      )}
      {modalKind === 'par' && parEdit && (
        <ParModal par={parEdit} onClose={cerrar} onSaved={onSavedPar} />
      )}
      {modalKind === 'consolidacion' && (
        <ConsolidacionModal
          monedas={initMonedas}
          actual={monedaConsolidacion?.codigo ?? ''}
          onClose={cerrar}
          onSaved={onSavedConsolidacion}
        />
      )}
      {modalKind === 'eliminar' && monedaEliminar && (
        <EliminarMonedaModal
          moneda={monedaEliminar}
          monedas={initMonedas}
          onClose={cerrar}
          onDone={onEliminada}
        />
      )}
    </div>
  )
}
