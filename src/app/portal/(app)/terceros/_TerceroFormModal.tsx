'use client'

import { toastError, toastLoading } from '@/app/contexts/ToastContext'
import { useId, useState, useTransition } from 'react'
import { ArrowRightLeft, FileText, X } from 'lucide-react'
import {
  guardarTercero,
  type Tercero,
  type ViaPago,
} from '@/app/actions/portal/terceros'
import type { MonedaOpcion } from '@/app/actions/portal/monedas'
import { VIAS_TIPOS, VIA_BADGE } from './_vias-pago'
import { opcionesCon }          from '@/components/portal/form-helpers'

// ── Selector de moneda ────────────────────────────────────────────────────────

// Monedas del cliente (Monedas y Tasas). `actual` se ofrece aunque ya no esté
// configurada, para que editar una ficha no la borre en silencio.
function MonedaSelect({ name, monedas, actual, id }: {
  name:     string
  monedas:  MonedaOpcion[]
  actual?:  string | null
  id?:      string
}) {
  const codigos  = opcionesCon(monedas.map(m => m.codigo), actual)
  const nombreDe = (cod: string) => monedas.find(m => m.codigo === cod)?.nombre
  return (
    <select className="input" id={id} name={name} defaultValue={actual ?? ''}>
      <option value="">— Sin especificar —</option>
      {codigos.map(c => (
        <option key={c} value={c}>{nombreDe(c) ? `${c} — ${nombreDe(c)}` : c}</option>
      ))}
    </select>
  )
}

// ── ViaFields ─────────────────────────────────────────────────────────────────

export function ViaFields({ tipo, value, onChange, monedas }: {
  tipo:     string
  value:    ViaPago
  onChange: (v: ViaPago) => void
  monedas:  MonedaOpcion[]
}) {
  const uid = useId()
  const set = (field: keyof ViaPago, val: string) =>
    onChange({ ...value, [field]: val || undefined })
  const get = (field: keyof ViaPago): string =>
    ((value as unknown) as Record<string, string>)[field] ?? ''

  const inp = (field: keyof ViaPago, label: string, ph = '', span = 3, type = 'text') => (
    <div className={`input-group ter-col-span-${span}`} key={String(field)}>
      <label>{label}</label>
      <input className="input" type={type} value={get(field)}
        onChange={e => set(field, e.target.value)} placeholder={ph} />
    </div>
  )

  // La moneda de la vía sale de las del cliente; `via.moneda` se conserva aunque
  // ya no esté configurada (mismo criterio que el resto de selectores). El id se
  // deriva de useId porque hay dos editores de vía (primaria y secundaria) en el
  // mismo formulario y el label necesita apuntar al select correcto.
  const monedaSel = (span = 2) => {
    const codigos = opcionesCon(monedas.map(m => m.codigo), get('moneda') || null)
    return (
      <div className={`input-group ter-col-span-${span}`} key="moneda">
        <label htmlFor={`${uid}-moneda`}>Moneda</label>
        <select className="input" id={`${uid}-moneda`} value={get('moneda')}
          onChange={e => set('moneda', e.target.value)}>
          <option value="">— Sin especificar —</option>
          {codigos.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
    )
  }

  if (tipo === 'Transferencia bancaria') {
    return (
      <div className="via-pago-fields">
        {inp('titular', 'Titular',            'Ej: Yusniel Pérez Gómez',   3)}
        {inp('cuenta',  'Cuenta o tarjeta',   'Ej: 9227 0699 1234 5678',   3)}
        {inp('banco',   'Banco',              'Ej: BANDEC, BPA, Metropolitano', 4)}
        {monedaSel()}
      </div>
    )
  }
  if (tipo === 'Transfermóvil' || tipo === 'EnZona') {
    return (
      <div className="via-pago-fields">
        {inp('titular',  'Titular',          'Ej: Yusniel Pérez Gómez', 4)}
        {inp('telefono', 'Teléfono',         'Ej: +53 5 123 4567',      3, 'tel')}
        {inp('cuenta',   'Tarjeta asociada', 'Ej: 9227 0699 1234 5678', 3)}
        {monedaSel()}
      </div>
    )
  }
  if (tipo === 'Efectivo') {
    return (
      <div className="via-pago-fields">
        {monedaSel(2)}
        <div className="input-group ter-col-span-4">
          <label>Referencia <span className="label-hint">(opcional)</span></label>
          <input className="input" value={get('referencia')}
            onChange={e => set('referencia', e.target.value)}
            placeholder="Ej: Pago en caja principal" />
        </div>
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
        {inp('nombre',     'Nombre / Empresa', 'Ej: Cafetería El Sol',  2)}
        {inp('email_link', 'Email o link',     'Ej: pagos@empresa.com', 4)}
        {monedaSel()}
      </div>
    )
  }
  if (tipo === 'Transferencia internacional') {
    return (
      <div className="via-pago-fields">
        {inp('titular',    'Titular',              'Ej: John Doe LLC',          3)}
        {inp('cuenta',     'No. de cuenta / IBAN', 'Ej: 00123456789',           3)}
        {monedaSel()}
        {inp('swift',      'SWIFT / BIC',          'Ej: ABCDUS33XXX',           2)}
        {inp('routing',    'Routing / ABA',        'Ej: 021000021',             2)}
        {inp('banco',      'Banco',                'Ej: First Example Bank',    3)}
        <div className="input-group ter-col-span-3">
          <label>Tipo de cuenta</label>
          <select className="input" value={get('tipo_cuenta')} onChange={e => set('tipo_cuenta', e.target.value)}>
            <option value="">— Seleccionar —</option>
            <option value="Checking">Checking</option>
            <option value="Savings">Savings</option>
          </select>
        </div>
        {inp('id_titular', 'ID / Pasaporte / EIN', 'Ej: 12-3456789',            3)}
        {inp('telefono',   'Teléfono titular',     'Ej: +1 555 123 4567',       3, 'tel')}
        <div className="input-group ter-col-full">
          <label>Dirección <span className="label-hint-xs">(CP, ciudad, estado, país)</span></label>
          <textarea className="input input-textarea" rows={2} value={get('direccion')}
            onChange={e => set('direccion', e.target.value)}
            placeholder="Ej: 123 Main St, Springfield, FL 12345, USA" />
        </div>
      </div>
    )
  }
  return null
}

// ── ViasPagoEditor ────────────────────────────────────────────────────────────

export function ViasPagoEditor({ value, onChange, label, monedas, optional = false }: {
  value:    ViaPago | null
  onChange: (v: ViaPago | null) => void
  label:    string
  monedas:  MonedaOpcion[]
  optional?: boolean
}) {
  const tipo = value?.tipo ?? ''
  // Al cambiar de tipo se conserva la moneda: es lo único que significa lo mismo
  // en todas las vías (el resto de campos son propios de cada una).
  function handleTipoChange(newTipo: string) {
    onChange(newTipo ? { tipo: newTipo, moneda: value?.moneda } : null)
  }
  return (
    <div className="via-pago-card">
      <div className="via-pago-header">
        <span className="via-pago-label">
          {label}
          {optional && <span className="via-pago-optional"> — opcional</span>}
        </span>
        {value?.tipo && <ViaBadge via={value} />}
      </div>
      <div className="via-pago-body">
        <div className="input-group input-group-narrow">
          <label>Tipo de pago</label>
          <select className="input" value={tipo} onChange={e => handleTipoChange(e.target.value)}>
            <option value="">{optional ? '— Ninguna —' : '— Seleccionar —'}</option>
            {opcionesCon(VIAS_TIPOS, tipo || null).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {value && tipo && <ViaFields tipo={tipo} value={value} onChange={onChange} monedas={monedas} />}
      </div>
    </div>
  )
}

// ── ViaBadge ──────────────────────────────────────────────────────────────────

// Etiqueta de una vía: tipo + moneda ("TB · CUP"). La moneda va aquí porque ya
// no forma parte del tipo. Una vía de una ficha vieja sin equivalente en el
// catálogo se pinta con su texto crudo, no se oculta.
export function ViaBadge({ via }: { via: ViaPago | null }) {
  if (!via?.tipo) return null
  const info = VIA_BADGE[via.tipo]
  return (
    <span className={`via-badge ${info?.cls ?? ''}`} title={[via.tipo, via.moneda].filter(Boolean).join(' · ')}>
      {info?.label ?? via.tipo}
      {via.moneda && <span className="via-badge-moneda">{via.moneda}</span>}
    </span>
  )
}

// ── Iconos locales ────────────────────────────────────────────────────────────

// ── TerceroFormModal ──────────────────────────────────────────────────────────

export function TerceroFormModal({ tercero, empresas, monedas, defaultTipo, onClose, onSaved }: {
  tercero:      Tercero | null
  empresas:     { empresa_id: string; nombre: string; moneda_funcional?: string | null }[]
  monedas:      MonedaOpcion[]
  defaultTipo?: 'CLIENTE' | 'PROVEEDOR' | 'AMBOS'
  onClose:      () => void
  onSaved:      (terceroId?: string) => void
}) {
  const [isPending, startTransition] = useTransition()
  const [viaP,      setViaP]         = useState<ViaPago | null>(tercero?.via_primaria   ?? null)
  const [viaS,      setViaS]         = useState<ViaPago | null>(tercero?.via_secundaria ?? null)

  const isEdit = !!tercero

  function handleSwap() { setViaP(viaS); setViaS(viaP) }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    if (viaP) fd.set('via_primaria',   JSON.stringify(viaP))
    if (viaS) fd.set('via_secundaria', JSON.stringify(viaS))
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const res = await guardarTercero(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved(res.tercero_id)
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-xl" role="dialog" aria-modal>

        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Editar' : 'Nuevo cliente o proveedor'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
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
                  <select className="input" name="tipo" defaultValue={tercero?.tipo ?? defaultTipo ?? 'CLIENTE'} required>
                    <option value="CLIENTE">Cliente</option>
                    <option value="PROVEEDOR">Proveedor</option>
                    <option value="AMBOS">Ambos</option>
                  </select>
                </div>
                <div className="input-group ter-col-span-4">
                  <label>NIT / Carné de identidad</label>
                  <input className="input" name="identificacion"
                    defaultValue={tercero?.identificacion ?? ''} placeholder="Ej: 85042012345" />
                </div>
                <div className="input-group ter-col-span-2">
                  <label>Empresa <span className="required">*</span></label>
                  {empresas.length === 1 ? (
                    <>
                      <input className="input input-static" readOnly value={empresas[0].nombre} />
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
                    placeholder="Ej: Cafetería El Sol S.R.L." required />
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
                    placeholder="Ej: Calle 23 #456 e/ 10 y 12, Vedado" />
                </div>
                <div className="input-group ter-col-span-3">
                  <label>Ciudad</label>
                  <input className="input" name="ciudad" defaultValue={tercero?.ciudad ?? ''} placeholder="La Habana" />
                </div>
                <div className="input-group ter-col-span-3">
                  <label>País</label>
                  <input className="input" name="pais" defaultValue={tercero?.pais ?? ''} placeholder="Cuba" />
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
                    placeholder="+53 5 123 4567" />
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
                  <label htmlFor="ter-moneda">Moneda predeterminada</label>
                  <MonedaSelect id="ter-moneda" name="moneda_defecto"
                    monedas={monedas} actual={tercero?.moneda_defecto} />
                  <span className="input-hint">
                    {monedas.length === 0
                      ? 'Aún no tienes monedas: créalas en Monedas y Tasas.'
                      : 'Tus monedas configuradas en Monedas y Tasas.'}
                  </span>
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
                  <label>Límite de crédito</label>
                  <input className="input" type="number" name="limite_credito"
                    defaultValue={tercero?.limite_credito ?? ''} placeholder="0.00" min="0" step="any" />
                  <span className="input-hint">Deuda máx. permitida, en su moneda predeterminada.</span>
                </div>
              </div>
            </div>

            {/* ── VÍAS DE PAGO ── */}
            <div className="ter-form-section">
              <span className="ter-form-section-title">Vías de pago</span>
              <ViasPagoEditor label="Vía principal"   value={viaP} onChange={setViaP} monedas={monedas} />
              <div className="via-pago-swap">
                <div className="via-pago-swap-line" />
                <button type="button" className="via-pago-swap-btn" onClick={handleSwap}
                  title="Intercambiar vía principal y secundaria">
                  <ArrowRightLeft size={13} strokeWidth={2} /> Intercambiar
                </button>
                <div className="via-pago-swap-line" />
              </div>
              <ViasPagoEditor label="Vía secundaria" value={viaS} onChange={setViaS} monedas={monedas} optional />
            </div>

            {/* ── CONTRATO ── */}
            <div className="ter-form-section">
              <span className="ter-form-section-title">Contrato</span>
              <div className="ter-form-grid">
                <div className="input-group ter-col-span-2">
                  <label>No. de contrato</label>
                  <input className="input" name="num_contrato"
                    defaultValue={tercero?.num_contrato ?? ''} placeholder="Ej: CONT-2026-001" />
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
                            <FileText size={15} strokeWidth={2} /> Ver contrato actual
                          </a>
                        </>
                      : 'PDF del contrato (opcional)'}
                  </label>
                  <input className="input input-file" type="file" name="contrato"
                    accept=".pdf,.jpg,.jpeg,.png" />
                  <span className="input-hint">Formatos: PDF, JPG, PNG. Máx. 10 MB.</span>
                </div>
              </div>
            </div>

            {/* ── NOTAS ── */}
            <div className="ter-form-section mb-0">
              <span className="ter-form-section-title">Notas internas</span>
              <div className="input-group">
                <textarea className="input input-textarea" name="notas" rows={2}
                  defaultValue={tercero?.notas ?? ''}
                  placeholder="Observaciones, condiciones especiales…" />
              </div>
            </div>

          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending}>
              {isPending
                ? <><span className="spinner spinner-sm" /> Guardando…</>
                : isEdit ? 'Guardar cambios' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
