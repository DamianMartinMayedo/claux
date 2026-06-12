'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CATALOGO_MONEDAS } from '@/lib/monedas-catalogo'
import {
  guardarMoneda,
  guardarPar,
  cambiarMonedaConsolidacion,
  actualizarTasasAuto,
  type Moneda,
  type Par,
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
}: {
  moneda:  Moneda | null
  onClose: () => void
  onSaved: () => void
}) {
  const catalogoArr = [...CATALOGO_MONEDAS]
  const [isPending, startTransition] = useTransition()
  const [error,     setError]        = useState('')
  const [catalogo,  setCatalogo]     = useState<string>(() => {
    if (!moneda) return 'USD'
    const hit = catalogoArr.find(c => c.codigo === moneda.codigo)
    return hit ? hit.codigo : 'OTRA'
  })
  const [nombre,  setNombre]  = useState(moneda?.nombre  ?? catalogoArr[0].nombre)
  const [simbolo, setSimbol]  = useState(moneda?.simbolo ?? catalogoArr[0].simbolo)
  const [codigo,  setCodigo]  = useState(moneda?.codigo  ?? '')

  const esEdicion = !!moneda

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
    setError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await guardarMoneda(fd)
      if (!result.ok) { setError(result.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal" style={{ maxWidth: 440 }} role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">{esEdicion ? 'Editar moneda' : 'Añadir moneda'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><IconX /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ padding: 'var(--space-5) var(--space-6)' }}>
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
                    className="input"
                    name="codigo"
                    value={codigo}
                    onChange={e => setCodigo(e.target.value.toUpperCase())}
                    placeholder="Ej: CUPB"
                    maxLength={10}
                    style={{ textTransform: 'uppercase' }}
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
                  <select className="input" name="activa" defaultValue={moneda.activa ? 'true' : 'false'}>
                    <option value="true">Activa</option>
                    <option value="false">Inactiva</option>
                  </select>
                </div>
              )}

            </div>

            {error && <div className="alert alert-error" style={{ marginTop: 'var(--space-4)' }}>{error}</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" style={{ borderTopColor: '#fff' }} />{esEdicion ? 'Guardando…' : 'Añadir'}</>
                : esEdicion ? 'Guardar cambios' : 'Añadir moneda'}
            </button>
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
  const [error,  setError]   = useState('')
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
    setError('')
    const fd = new FormData()
    fd.set('par_id', par.par_id.toString())
    fd.set('fuente', fuente)
    if (fuente === 'MANUAL') fd.set('tasa', tasa)

    startTransition(async () => {
      const result = await guardarPar(fd)
      if (!result.ok) { setError(result.error ?? 'Error inesperado.'); return }
      onSaved(result.tasa, result.fecha)
    })
  }

  const esAuto = fuente !== 'MANUAL'

  return (
    <div className="modal-backdrop open">
      <div className="modal" style={{ maxWidth: 380 }} role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Configurar par</h2>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><IconX /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

            {/* Identificación del par */}
            <div className="par-modal-id">
              <span className="par-cod">{par.origen}</span>
              <IconArrow />
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
                <IconInfo />
                <span>
                  Al guardar se consultará <strong>{FUENTE_LABEL[fuente]}</strong> y se actualizará la tasa.
                  {par.tasa != null && (
                    <> Tasa actual: <strong>{fmtTasa(par.tasa)}</strong> ({par.fecha})</>
                  )}
                </span>
              </div>
            )}

            {error && <div className="alert alert-error">{error}</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" style={{ borderTopColor: '#fff' }} />{esAuto ? 'Obteniendo…' : 'Guardando…'}</>
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
  const [error,     setError]        = useState('')
  const [sel,       setSel]          = useState(actual)

  function handleConfirm() {
    if (sel === actual) { onClose(); return }
    setError('')
    startTransition(async () => {
      const result = await cambiarMonedaConsolidacion(sel)
      if (!result.ok) { setError(result.error ?? 'Error.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal" style={{ maxWidth: 380 }} role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Moneda de consolidación</h2>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><IconX /></button>
        </div>
        <div className="modal-body" style={{ padding: 'var(--space-5) var(--space-6)' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
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
          {error && <div className="alert alert-error" style={{ marginTop: 'var(--space-4)' }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={handleConfirm} disabled={isPending || sel === actual}>
            {isPending ? <><span className="spinner spinner-sm" style={{ borderTopColor: '#fff' }} />Cambiando…</> : 'Establecer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Vista principal ───────────────────────────────────────────────────────────

type ModalKind = 'none' | 'moneda' | 'par' | 'consolidacion'

interface Props {
  monedas: Moneda[]
  pares:   Par[]
  esAdmin: boolean
}

export default function MonedasView({ monedas: initMonedas, pares: initPares, esAdmin }: Props) {
  const router = useRouter()

  const [modalKind,  setModalKind]  = useState<ModalKind>('none')
  const [monedaEdit, setMonedaEdit] = useState<Moneda | null>(null)
  const [parEdit,    setParEdit]    = useState<Par | null>(null)

  // Tasas locales — se actualizan optimistamente tras guardar un par
  const [localPares, setLocalPares] = useState<Par[]>(initPares)
  useEffect(() => { setLocalPares(initPares) }, [initPares])

  const [autoMsg,     setAutoMsg]    = useState('')
  const [autoPending, startAutoTrans] = useTransition()

  const monedaConsolidacion = initMonedas.find(m => m.es_consolidacion)

  function cerrar() { setModalKind('none'); setMonedaEdit(null); setParEdit(null) }
  function onSavedMoneda() { cerrar(); router.refresh() }
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
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={handleActualizarAuto} disabled={autoPending}>
            {autoPending ? <><span className="spinner spinner-sm" /> Actualizando…</> : <><IconRefresh /> Actualizar automáticas</>}
          </button>
          {esAdmin && (
            <button className="btn btn-primary" onClick={() => { setMonedaEdit(null); setModalKind('moneda') }}>
              <IconPlus /> Nueva moneda
            </button>
          )}
        </div>
      </div>

      {autoMsg && (
        <div className="alert alert-warning" style={{ marginBottom: 'var(--space-5)' }}>{autoMsg}</div>
      )}

      <div className="mon-layout">

        {/* ── Columna izquierda: monedas ── */}
        <div className="card card-table">
          <div className="mon-card-header">
            <h2 className="mon-section-title">Monedas activas</h2>
            {esAdmin && monedaConsolidacion && (
              <button className="btn btn-secondary btn-sm" onClick={() => setModalKind('consolidacion')}>
                <IconStar /> Consolidación
              </button>
            )}
          </div>

          {initMonedas.length === 0 ? (
            <div className="mon-empty">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
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
                    >
                      <IconEdit />
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
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
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
                    <th className="text-right">Tasa</th>
                    <th>Fuente</th>
                    <th>Actualizada</th>
                    {esAdmin && <th style={{ width: 40 }} />}
                  </tr>
                </thead>
                <tbody>
                  {localPares.map(p => (
                    <tr key={p.par_id}>
                      <td>
                        <span className="mon-par">
                          <strong>{p.origen}</strong>
                          <IconArrowSm />
                          <strong>{p.destino}</strong>
                        </span>
                      </td>
                      <td className="text-right mon-tasa-val">
                        {fmtTasa(p.tasa)}
                      </td>
                      <td>
                        <span className="mon-fuente-dot" style={{ '--dot-color': FUENTE_COLOR[p.fuente] } as React.CSSProperties} />
                        <span style={{ fontSize: 'var(--text-xs)' }}>{FUENTE_LABEL[p.fuente]}</span>
                      </td>
                      <td style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                        {p.fecha ?? '—'}
                      </td>
                      {esAdmin && (
                        <td>
                          <button
                            className="btn btn-secondary btn-xs"
                            title="Configurar par"
                            onClick={() => {
                              setParEdit(p)
                              setModalKind('par')
                            }}
                          >
                            <IconEdit />
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
        <MonedaModal moneda={monedaEdit} onClose={cerrar} onSaved={onSavedMoneda} />
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
    </div>
  )
}

// ── Iconos ────────────────────────────────────────────────────────────────────
function IconX()       { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> }
function IconPlus()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> }
function IconEdit()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> }
function IconRefresh() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg> }
function IconStar()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> }
function IconArrow()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg> }
function IconArrowSm() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg> }
function IconInfo()    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" style={{ flexShrink: 0, color: 'var(--color-primary)' }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> }
