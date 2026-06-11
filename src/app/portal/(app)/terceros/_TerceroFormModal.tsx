'use client'

import { useState, useTransition } from 'react'
import {
  guardarTercero,
  type Tercero,
  type ViaPago,
} from '@/app/actions/portal/terceros'

// ── Constantes ────────────────────────────────────────────────────────────────

export const MONEDAS_LISTA = [
  'USD', 'VES', 'EUR', 'COP', 'BRL', 'PEN',
  'ARS', 'MXN', 'GBP', 'CAD', 'CHF', 'CLP',
]

export const VIAS_TIPOS = [
  'Transferencia (VES)',
  'Transferencia (USD)',
  'Transferencia Internacional',
  'Pago Móvil',
  'Zelle',
  'TropiPay',
  'Efectivo (VES)',
  'Efectivo (USD)',
] as const

export const VIA_BADGE: Record<string, { label: string; cls: string }> = {
  'Transferencia (VES)':         { label: 'TB-VES',  cls: 'via-badge-ves'      },
  'Transferencia (USD)':         { label: 'TB-USD',  cls: 'via-badge-usd'      },
  'Transferencia Internacional': { label: 'TBI',     cls: 'via-badge-intl'     },
  'Pago Móvil':                  { label: 'PM',      cls: 'via-badge-pm'       },
  'Zelle':                       { label: 'ZELLE',   cls: 'via-badge-zelle'    },
  'TropiPay':                    { label: 'TPPAY',   cls: 'via-badge-tropipay' },
  'Efectivo (VES)':              { label: 'EF-VES',  cls: 'via-badge-ef'       },
  'Efectivo (USD)':              { label: 'EF-USD',  cls: 'via-badge-ef'       },
}

// ── ViaFields ─────────────────────────────────────────────────────────────────

export function ViaFields({ tipo, value, onChange }: {
  tipo:     string
  value:    ViaPago
  onChange: (v: ViaPago) => void
}) {
  const set = (field: keyof ViaPago, val: string) =>
    onChange({ ...value, [field]: val || undefined })
  const get = (field: keyof ViaPago): string =>
    ((value as unknown) as Record<string, string>)[field] ?? ''

  const inp = (field: keyof ViaPago, label: string, ph = '', span = 3, type = 'text', req = false) => (
    <div className={`input-group ter-col-span-${span}`} key={String(field)}>
      <label>{label}{req && <span className="required"> *</span>}</label>
      <input className="input" type={type} value={get(field)}
        onChange={e => set(field, e.target.value)} placeholder={ph} />
    </div>
  )

  if (tipo === 'Transferencia (VES)' || tipo === 'Transferencia (USD)') {
    return (
      <div className="via-pago-fields">
        {inp('titular',    'Titular',       'Ej: Empresa ABC, C.A.',      3, 'text', true)}
        {inp('cuenta',     'No. de cuenta', 'Ej: 0102 0000 0000 0000',    3, 'text', true)}
        {inp('banco',      'Banco',         'Ej: Banco de Venezuela',      3)}
        <div className="input-group ter-col-span-3">
          <label>Tipo de cuenta</label>
          <select className="input" value={get('tipo_cuenta')} onChange={e => set('tipo_cuenta', e.target.value)}>
            <option value="">— Seleccionar —</option>
            <option value="Corriente">Corriente</option>
            <option value="Ahorro">Ahorro</option>
          </select>
        </div>
      </div>
    )
  }
  if (tipo === 'Transferencia Internacional') {
    return (
      <div className="via-pago-fields">
        {inp('titular',    'Titular',              'Ej: John Doe LLC',          3, 'text', true)}
        {inp('cuenta',     'No. de cuenta',        'Ej: 00123456789',           3, 'text', true)}
        <div className="input-group ter-col-span-2">
          <label>Moneda</label>
          <select className="input" value={get('moneda')} onChange={e => set('moneda', e.target.value)}>
            <option value="">— Seleccionar —</option>
            {['USD','EUR','GBP','CAD','CHF','MXN','BRL','COP'].map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        {inp('swift',      'SWIFT / BIC',          'Ej: ABCDUS33XXX',           2)}
        {inp('routing',    'Routing / ABA',         'Ej: 021000021',             2)}
        {inp('banco',      'Banco',                 'Ej: First Example Bank',    3)}
        <div className="input-group ter-col-span-3">
          <label>Tipo de cuenta</label>
          <select className="input" value={get('tipo_cuenta')} onChange={e => set('tipo_cuenta', e.target.value)}>
            <option value="">— Seleccionar —</option>
            <option value="Checking">Checking</option>
            <option value="Savings">Savings</option>
          </select>
        </div>
        {inp('id_titular', 'ID / Passport / EIN',  'Ej: 12-3456789',            3)}
        {inp('telefono',   'Teléfono titular',      'Ej: +1 555 123 4567',       3, 'tel')}
        <div className="input-group ter-col-full">
          <label>Dirección <span style={{ fontWeight: 400, fontSize: '0.8rem' }}>(CP, ciudad, estado, país)</span></label>
          <textarea className="input input-textarea" rows={2} value={get('direccion')}
            onChange={e => set('direccion', e.target.value)}
            placeholder="Ej: 123 Main St, Springfield, FL 12345, USA" />
        </div>
      </div>
    )
  }
  if (tipo === 'Pago Móvil') {
    return (
      <div className="via-pago-fields">
        {inp('banco',    'Banco',    'Ej: Mercantil',     2)}
        {inp('telefono', 'Teléfono', 'Ej: 0414 000 0000', 2, 'tel', true)}
        {inp('cedula',   'Cédula',   'Ej: V-12345678',    2)}
      </div>
    )
  }
  if (tipo === 'Zelle') {
    return (
      <div className="via-pago-fields">
        {inp('nombre',   'Nombre en Zelle',  'Ej: Juan García',      3)}
        {inp('contacto', 'Teléfono o email', 'Ej: +1 555 987 6543',  3)}
      </div>
    )
  }
  if (tipo === 'TropiPay') {
    return (
      <div className="via-pago-fields">
        {inp('nombre',     'Nombre / Empresa', 'Ej: Empresa ABC',       3)}
        {inp('email_link', 'Email o link',     'Ej: pagos@empresa.com', 3)}
      </div>
    )
  }
  if (tipo === 'Efectivo (VES)' || tipo === 'Efectivo (USD)') {
    return (
      <div className="via-pago-fields">
        <div className="input-group ter-col-full">
          <label>Referencia <span style={{ fontWeight: 400 }}>(opcional)</span></label>
          <input className="input" value={get('referencia')}
            onChange={e => set('referencia', e.target.value)}
            placeholder="Ej: Pago en caja principal" />
        </div>
      </div>
    )
  }
  return null
}

// ── ViasPagoEditor ────────────────────────────────────────────────────────────

export function ViasPagoEditor({ value, onChange, label, optional = false }: {
  value:    ViaPago | null
  onChange: (v: ViaPago | null) => void
  label:    string
  optional?: boolean
}) {
  const tipo = value?.tipo ?? ''
  function handleTipoChange(newTipo: string) {
    onChange(newTipo ? { tipo: newTipo } : null)
  }
  return (
    <div className="via-pago-card">
      <div className="via-pago-header">
        <span className="via-pago-label">
          {label}
          {optional && <span className="via-pago-optional"> — opcional</span>}
        </span>
        {value?.tipo && (
          <span className={`via-badge ${VIA_BADGE[value.tipo]?.cls ?? ''}`} style={{ fontSize: '10px' }}>
            {VIA_BADGE[value.tipo]?.label ?? value.tipo}
          </span>
        )}
      </div>
      <div className="via-pago-body">
        <div className="input-group" style={{ maxWidth: 300 }}>
          <label>Tipo de pago</label>
          <select className="input" value={tipo} onChange={e => handleTipoChange(e.target.value)}>
            <option value="">{optional ? '— Ninguna —' : '— Seleccionar —'}</option>
            {VIAS_TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {value && tipo && <ViaFields tipo={tipo} value={value} onChange={onChange} />}
      </div>
    </div>
  )
}

// ── Iconos locales ────────────────────────────────────────────────────────────

function IconX()        { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> }
function IconSwap()     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg> }
function IconFileLink() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg> }

// ── TerceroFormModal ──────────────────────────────────────────────────────────

export function TerceroFormModal({ tercero, empresas, onClose, onSaved }: {
  tercero:  Tercero | null
  empresas: { empresa_id: string; nombre: string }[]
  onClose:  () => void
  onSaved:  () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [error,     setError]        = useState('')
  const [viaP,      setViaP]         = useState<ViaPago | null>(tercero?.via_primaria   ?? null)
  const [viaS,      setViaS]         = useState<ViaPago | null>(tercero?.via_secundaria ?? null)

  const isEdit = !!tercero

  function handleSwap() { setViaP(viaS); setViaS(viaP) }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const fd = new FormData(e.currentTarget)
    if (viaP) fd.set('via_primaria',   JSON.stringify(viaP))
    if (viaS) fd.set('via_secundaria', JSON.stringify(viaS))
    startTransition(async () => {
      const res = await guardarTercero(fd)
      if (!res.ok) { setError(res.error ?? 'Error inesperado.'); return }
      onSaved()
    })
  }

  return (
    <div className="modal-backdrop open" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal-lg" role="dialog" aria-modal>

        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Editar tercero' : 'Nuevo tercero'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><IconX /></button>
        </div>

        <form onSubmit={handleSubmit}>
          {tercero && <input type="hidden" name="tercero_id"   value={tercero.tercero_id}  />}
          {tercero && <input type="hidden" name="contrato_url" value={tercero.contrato_url ?? ''} />}

          <div className="modal-body">

            {/* ── IDENTIFICACIÓN ── */}
            <div className="ter-form-section">
              <span className="ter-form-section-title">Identificación</span>
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-2">
                  <label>Tipo <span className="required">*</span></label>
                  <select className="input" name="tipo" defaultValue={tercero?.tipo ?? 'CLIENTE'} required>
                    <option value="CLIENTE">Cliente</option>
                    <option value="PROVEEDOR">Proveedor</option>
                    <option value="AMBOS">Ambos</option>
                  </select>
                </div>
                <div className="input-group ter-col-span-4">
                  <label>RIF / NIT / Cédula</label>
                  <input className="input" name="identificacion"
                    defaultValue={tercero?.identificacion ?? ''} placeholder="J-12345678-9" />
                </div>
                <div className="input-group ter-col-span-2">
                  <label>Empresa <span className="required">*</span></label>
                  {empresas.length === 1 ? (
                    <>
                      <input className="input" readOnly value={empresas[0].nombre}
                        style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-muted)' }} />
                      <input type="hidden" name="empresa_id" value={empresas[0].empresa_id} />
                    </>
                  ) : (
                    <select className="input" name="empresa_id"
                      defaultValue={tercero?.empresa_id ?? ''} required>
                      <option value="">Selecciona una empresa…</option>
                      {empresas.map(e => (
                        <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="input-group ter-col-span-4">
                  <label>Nombre / Razón social <span className="required">*</span></label>
                  <input className="input" name="nombre" defaultValue={tercero?.nombre ?? ''}
                    placeholder="Ej: Empresa ABC, C.A." required />
                </div>
              </div>
            </div>

            {/* ── CONTACTO ── */}
            <div className="ter-form-section">
              <span className="ter-form-section-title">Contacto</span>
              <div className="ter-form-grid">
                <div className="input-group ter-col-full">
                  <label>Dirección</label>
                  <input className="input" name="direccion" defaultValue={tercero?.direccion ?? ''}
                    placeholder="Av. Principal, Edificio…" />
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Ciudad</label>
                  <input className="input" name="ciudad" defaultValue={tercero?.ciudad ?? ''} placeholder="Caracas" />
                </div>
                <div className="input-group ter-col-span-3">
                  <label>País</label>
                  <input className="input" name="pais" defaultValue={tercero?.pais ?? ''} placeholder="Venezuela" />
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Representante</label>
                  <input className="input" name="representante" defaultValue={tercero?.representante ?? ''}
                    placeholder="Nombre del contacto" />
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Cargo / Posición</label>
                  <input className="input" name="cargo" defaultValue={tercero?.cargo ?? ''}
                    placeholder="Ej: Gerente comercial" />
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Teléfono</label>
                  <input className="input" type="tel" name="telefono" defaultValue={tercero?.telefono ?? ''}
                    placeholder="+58 212 000 0000" />
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Email</label>
                  <input className="input" type="email" name="email" defaultValue={tercero?.email ?? ''}
                    placeholder="contacto@empresa.com" />
                </div>
              </div>
            </div>

            {/* ── CONDICIONES COMERCIALES ── */}
            <div className="ter-form-section">
              <span className="ter-form-section-title">Condiciones comerciales</span>
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-2">
                  <label>Moneda predeterminada</label>
                  <select className="input" name="moneda_defecto" defaultValue={tercero?.moneda_defecto ?? ''}>
                    <option value="">— Sin especificar —</option>
                    {MONEDAS_LISTA.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="input-group ter-col-span-2">
                  <label>Condición de pago</label>
                  <select className="input" name="condicion_pago" defaultValue={tercero?.condicion_pago ?? 'CONTADO'}>
                    <option value="CONTADO">Contado</option>
                    <option value="15">15 días</option>
                    <option value="30">30 días</option>
                    <option value="60">60 días</option>
                    <option value="90">90 días</option>
                  </select>
                </div>
                <div className="input-group ter-col-span-2">
                  <label>Límite de crédito (USD)</label>
                  <input className="input" type="number" name="limite_credito"
                    defaultValue={tercero?.limite_credito ?? ''} placeholder="0.00" min="0" step="0.01" />
                  <span className="input-hint">Monto máx. de deuda permitida.</span>
                </div>
              </div>
            </div>

            {/* ── VÍAS DE PAGO ── */}
            <div className="ter-form-section">
              <span className="ter-form-section-title">Vías de pago</span>
              <ViasPagoEditor label="Vía principal"   value={viaP} onChange={setViaP} />
              <div className="via-pago-swap">
                <div className="via-pago-swap-line" />
                <button type="button" className="via-pago-swap-btn" onClick={handleSwap}
                  title="Intercambiar vía principal y secundaria">
                  <IconSwap /> Intercambiar
                </button>
                <div className="via-pago-swap-line" />
              </div>
              <ViasPagoEditor label="Vía secundaria" value={viaS} onChange={setViaS} optional />
            </div>

            {/* ── CONTRATO ── */}
            <div className="ter-form-section">
              <span className="ter-form-section-title">Contrato</span>
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-2">
                  <label>No. de contrato</label>
                  <input className="input" name="num_contrato"
                    defaultValue={tercero?.num_contrato ?? ''} placeholder="Ej: CONT-2024-001" />
                </div>
                <div className="input-group ter-col-span-2">
                  <label>Fecha inicio</label>
                  <input className="input" type="date" name="fecha_inicio_contrato"
                    defaultValue={tercero?.fecha_inicio_contrato ?? ''} />
                </div>
                <div className="input-group ter-col-span-2">
                  <label>Fecha fin</label>
                  <input className="input" type="date" name="fecha_fin_contrato"
                    defaultValue={tercero?.fecha_fin_contrato ?? ''} />
                </div>
                <div className="input-group ter-col-full">
                  <label>
                    {tercero?.contrato_url
                      ? <>PDF del contrato{' '}
                          <a href={tercero.contrato_url} target="_blank" rel="noopener noreferrer"
                            className="ter-contrato-link">
                            <IconFileLink /> Ver contrato actual
                          </a>
                        </>
                      : 'PDF del contrato (opcional)'}
                  </label>
                  <input className="input" type="file" name="contrato"
                    accept=".pdf,.jpg,.jpeg,.png" style={{ paddingTop: 6, paddingBottom: 6 }} />
                  <span className="input-hint">Formatos: PDF, JPG, PNG. Máx. 10 MB.</span>
                </div>
              </div>
            </div>

            {/* ── NOTAS ── */}
            <div className="ter-form-section" style={{ marginBottom: 0 }}>
              <span className="ter-form-section-title">Notas internas</span>
              <div className="input-group">
                <textarea className="input input-textarea" name="notas" rows={2}
                  defaultValue={tercero?.notas ?? ''}
                  placeholder="Observaciones, condiciones especiales…" />
              </div>
            </div>

            {error && <div className="alert alert-error">{error}</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" style={{ borderTopColor: '#fff' }} /> Guardando…</>
                : isEdit ? 'Guardar cambios' : 'Crear tercero'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
