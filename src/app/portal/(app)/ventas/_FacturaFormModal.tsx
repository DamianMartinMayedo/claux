'use client'

import { useState, useTransition } from 'react'
import { guardarFactura }           from '@/app/actions/portal/ventas'
import { DocumentoLineasEditor }    from './_DocumentoLineasEditor'
import {
  CONDICION_PAGO_OPTIONS,
  calcularFechaVencimiento,
  type AjusteInput,
  type LineaInput,
} from './_ventas-helpers'
import type { Factura, DocumentoLinea, DocumentoAjuste } from '@/app/actions/portal/ventas'

interface ClienteOption {
  tercero_id:     string
  nombre:         string
  empresa_id:     string
  moneda_defecto: string | null
}

interface EmpresaOption {
  empresa_id:        string
  nombre:            string
  letra_facturacion: string | null
}

interface Props {
  factura?:     Factura | null
  lineasInit?:  DocumentoLinea[]
  ajustesInit?: DocumentoAjuste[]
  empresas:     EmpresaOption[]
  clientes:     ClienteOption[]
  productos:    React.ComponentProps<typeof DocumentoLineasEditor>['productos']
  monedas:      string[]
  onClose:      () => void
  onSaved:      (factura_id: string) => void
}

export function FacturaFormModal({
  factura, lineasInit, ajustesInit,
  empresas, clientes, productos, monedas,
  onClose, onSaved,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [error,    setError]    = useState('')

  const isEdit = !!factura

  const empresasConLetra = empresas.filter(e => !!e.letra_facturacion)
  const sinLetra         = empresas.length > 0 && empresasConLetra.length === 0

  const [empresa_id, setEmpresaId] = useState(
    factura?.empresa_id ?? empresasConLetra[0]?.empresa_id ?? '',
  )
  const [cliente_id,        setClienteId]        = useState(factura?.cliente_id ?? '')
  const [moneda,            setMoneda]           = useState(factura?.moneda ?? monedas[0] ?? '')
  const [fecha_emision,     setFechaEmision]     = useState(
    factura?.fecha_emision ?? new Date().toISOString().substring(0, 10),
  )
  const [fecha_vencimiento, setFechaVencimiento] = useState(factura?.fecha_vencimiento ?? '')
  const [condicion_pago,    setCondicionPago]    = useState(factura?.condicion_pago ?? 'CONTADO')
  const [notas,             setNotas]            = useState(factura?.notas ?? '')
  const [notas_internas,    setNotasInternas]    = useState(factura?.notas_internas ?? '')

  function handleCondicionChange(nueva: string) {
    setCondicionPago(nueva)
    // Auto-calcular vencimiento si cambia condicion_pago y hay fecha de emisión
    const venc = calcularFechaVencimiento(nueva, fecha_emision)
    setFechaVencimiento(venc)
  }

  function handleFechaEmisionChange(fecha: string) {
    setFechaEmision(fecha)
    // Recalcular vencimiento con la nueva fecha base
    const venc = calcularFechaVencimiento(condicion_pago, fecha)
    setFechaVencimiento(venc)
  }

  const [lineas, setLineas] = useState<LineaInput[]>(
    lineasInit?.map(l => ({
      producto_id:     l.producto_id,
      descripcion:     l.descripcion,
      cantidad:        Number(l.cantidad),
      precio_unitario: Number(l.precio_unitario),
      descuento_pct:   Number(l.descuento_pct) || 0,
    })) ?? [],
  )
  const [ajustes, setAjustes] = useState<AjusteInput[]>(
    ajustesInit?.map(a => ({
      tipo:   a.tipo,
      nombre: a.nombre,
      modo:   a.modo,
      valor:  Number(a.valor),
    })) ?? [],
  )

  const clientesDeEmpresa = clientes.filter(c => c.empresa_id === empresa_id)

  function onClienteChange(id: string) {
    setClienteId(id)
    const c = clientes.find(c => c.tercero_id === id)
    if (c?.moneda_defecto && monedas.includes(c.moneda_defecto)) {
      setMoneda(c.moneda_defecto)
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')

    if (lineas.length === 0)                      { setError('Añade al menos una línea.'); return }
    if (lineas.some(l => !l.descripcion.trim()))  { setError('Toda línea debe tener una descripción.'); return }
    if (ajustes.some(a => !a.nombre.trim()))      { setError('Todo ajuste debe tener un nombre.'); return }

    const fd = new FormData()
    if (factura) fd.set('factura_id', factura.factura_id)
    fd.set('empresa_id',        empresa_id)
    fd.set('cliente_id',        cliente_id)
    fd.set('moneda',            moneda)
    fd.set('fecha_emision',     fecha_emision)
    fd.set('fecha_vencimiento', fecha_vencimiento)
    fd.set('condicion_pago',    condicion_pago)
    fd.set('notas',             notas)
    fd.set('notas_internas',    notas_internas)
    fd.set('lineas',  JSON.stringify(lineas))
    fd.set('ajustes', JSON.stringify(ajustes))

    startTransition(async () => {
      const res = await guardarFactura(fd)
      if (!res.ok) { setError(res.error ?? 'Error inesperado.'); return }
      onSaved(res.factura_id!)
    })
  }

  return (
    <div className="modal-backdrop open" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal-lg" role="dialog" aria-modal style={{ maxWidth: 1000 }}>

        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? `Editar factura ${factura.numero}` : 'Nueva factura'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><IconX /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">

            {sinLetra && (
              <div className="alert alert-warning" style={{ marginBottom: 16 }}>
                Ninguna de tus empresas tiene letra de facturación asignada. Ve a <strong>Mis Empresas</strong> y asígnala antes de crear facturas.
              </div>
            )}

            <div className="ven-form-section">
              <span className="ven-form-section-title">Datos del documento</span>
              <div className="ven-form-grid">
                <div className="input-group">
                  <label>Empresa <span className="required">*</span></label>
                  <select className="input" value={empresa_id} onChange={e => setEmpresaId(e.target.value)} required disabled={isEdit}>
                    <option value="">Selecciona…</option>
                    {empresasConLetra.map(e => (
                      <option key={e.empresa_id} value={e.empresa_id}>
                        {e.letra_facturacion} · {e.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="input-group">
                  <label>Cliente <span className="required">*</span></label>
                  <select className="input" value={cliente_id} onChange={e => onClienteChange(e.target.value)} required>
                    <option value="">Selecciona…</option>
                    {clientesDeEmpresa.map(c => (
                      <option key={c.tercero_id} value={c.tercero_id}>{c.nombre}</option>
                    ))}
                  </select>
                </div>

                <div className="input-group">
                  <label>Moneda <span className="required">*</span></label>
                  <select className="input" value={moneda} onChange={e => setMoneda(e.target.value)} required>
                    {monedas.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>

                <div className="input-group">
                  <label>Fecha emisión <span className="required">*</span></label>
                  <input className="input" type="date" value={fecha_emision}
                    onChange={e => handleFechaEmisionChange(e.target.value)} required />
                </div>

                <div className="input-group">
                  <label>Condición de pago</label>
                  <select className="input" value={condicion_pago} onChange={e => handleCondicionChange(e.target.value)}>
                    {CONDICION_PAGO_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div className="input-group">
                  <label>Vencimiento</label>
                  <input className="input" type="date" value={fecha_vencimiento}
                    onChange={e => setFechaVencimiento(e.target.value)} />
                  <span className="input-hint">Se calcula automáticamente desde la condición de pago.</span>
                </div>

                <div className="input-group ven-col-full">
                  <label>Notas <span className="input-hint-inline">(visibles en el PDF)</span></label>
                  <textarea className="input input-textarea" rows={2} value={notas} onChange={e => setNotas(e.target.value)}
                    placeholder="Condiciones de pago, referencias…" />
                </div>

                <div className="input-group ven-col-full">
                  <label>Notas internas <span className="input-hint-inline">(no se imprimen)</span></label>
                  <textarea className="input input-textarea" rows={2} value={notas_internas} onChange={e => setNotasInternas(e.target.value)}
                    placeholder="Observaciones para uso interno del equipo…" />
                </div>
              </div>
            </div>

            <DocumentoLineasEditor
              lineas={lineas}
              ajustes={ajustes}
              moneda={moneda}
              productos={productos}
              onLineasChange={setLineas}
              onAjustesChange={setAjustes}
            />

            {error && <div className="alert alert-error" style={{ marginTop: 16 }}>{error}</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending || sinLetra}>
              {isPending
                ? <><span className="spinner spinner-sm" style={{ borderTopColor: '#fff' }} /> Guardando…</>
                : isEdit ? 'Guardar cambios' : 'Crear factura'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function IconX() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
}
