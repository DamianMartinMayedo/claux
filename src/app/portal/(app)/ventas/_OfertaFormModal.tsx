'use client'

import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { useState, useTransition } from 'react'
import { useToast } from '@/app/contexts/ToastContext'
import { guardarOferta }            from '@/app/actions/portal/ventas'
import { DocumentoLineasEditor }    from './_DocumentoLineasEditor'
import {
  CONDICION_PAGO_OPTIONS,
  type AjusteInput,
  type LineaInput,
} from './_ventas-helpers'
import type { Oferta, DocumentoLinea, DocumentoAjuste } from '@/app/actions/portal/ventas'
import { X } from 'lucide-react'

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
  oferta?:    Oferta | null
  lineasInit?: DocumentoLinea[]
  ajustesInit?: DocumentoAjuste[]
  empresas:    EmpresaOption[]
  clientes:    ClienteOption[]
  productos:   React.ComponentProps<typeof DocumentoLineasEditor>['productos']
  monedas:     string[]
  onClose:     () => void
  onSaved:     (oferta_id: string) => void
}

export function OfertaFormModal({
  oferta, lineasInit, ajustesInit,
  empresas, clientes, productos, monedas,
  onClose, onSaved,
}: Props) {
  const [isPending, startTransition] = useTransition()

  const isEdit = !!oferta

  // Validar empresas con letra
  const empresasConLetra = empresas.filter(e => !!e.letra_facturacion)
  const sinLetra         = empresas.length > 0 && empresasConLetra.length === 0

  const [empresa_id, setEmpresaId] = useState(
    oferta?.empresa_id ?? empresasConLetra[0]?.empresa_id ?? '',
  )
  const [cliente_id, setClienteId] = useState(oferta?.cliente_id ?? '')
  const [moneda,     setMoneda]    = useState(
    oferta?.moneda ?? monedas[0] ?? '',
  )
  const [fecha_emision, setFechaEmision] = useState(
    oferta?.fecha_emision ?? new Date().toISOString().substring(0, 10),
  )
  const [fecha_validez,   setFechaValidez]   = useState(oferta?.fecha_validez ?? '')
  const [condicion_pago,  setCondicionPago]  = useState(oferta?.condicion_pago ?? 'CONTADO')
  const [notas,           setNotas]          = useState(oferta?.notas ?? '')
  const [notas_internas,  setNotasInternas]  = useState(oferta?.notas_internas ?? '')

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

  // Clientes filtrados por empresa seleccionada
  const clientesDeEmpresa = clientes.filter(c => c.empresa_id === empresa_id)

  // Cambio de cliente: heredar moneda_defecto si está vacía
  function onClienteChange(id: string) {
    setClienteId(id)
    const c = clientes.find(c => c.tercero_id === id)
    if (c?.moneda_defecto && monedas.includes(c.moneda_defecto)) {
      setMoneda(c.moneda_defecto)
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (lineas.length === 0) {
      toastError('Añade al menos una línea.')
      return
    }
    if (lineas.some(l => !l.descripcion.trim())) {
      toastError('Toda línea debe tener una descripción.')
      return
    }
    if (ajustes.some(a => !a.nombre.trim())) {
      toastError('Todo ajuste debe tener un nombre.')
      return
    }

    const fd = new FormData()
    if (oferta) fd.set('oferta_id', oferta.oferta_id)
    fd.set('empresa_id',    empresa_id)
    fd.set('cliente_id',    cliente_id)
    fd.set('moneda',        moneda)
    fd.set('fecha_emision',  fecha_emision)
    fd.set('fecha_validez',  fecha_validez)
    fd.set('condicion_pago', condicion_pago)
    fd.set('notas',          notas)
    fd.set('notas_internas', notas_internas)
    fd.set('lineas',  JSON.stringify(lineas))
    fd.set('ajustes', JSON.stringify(ajustes))

    startTransition(async () => {
      const res = await guardarOferta(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      onSaved(res.oferta_id!)
    })
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-1000" role="dialog" aria-modal>

        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? `Editar oferta ${oferta.numero}` : 'Nueva oferta comercial'}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">

            {sinLetra && (
              <div className="alert alert-warning mb-4">
                Ninguna de tus empresas tiene letra de facturación asignada. Ve a <strong>Mis Empresas</strong> y asígnala antes de crear ofertas.
              </div>
            )}

            {/* ── Datos generales ── */}
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
                  {empresa_id && clientesDeEmpresa.length === 0 && (
                    <span className="input-hint">
                      Esta empresa no tiene clientes. Crea uno en Terceros.
                    </span>
                  )}
                </div>

                <div className="input-group">
                  <label>Moneda <span className="required">*</span></label>
                  <select className="input" value={moneda} onChange={e => setMoneda(e.target.value)} required>
                    {monedas.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>

                <div className="input-group">
                  <label>Fecha emisión <span className="required">*</span></label>
                  <input className="input" type="date" value={fecha_emision} onChange={e => setFechaEmision(e.target.value)} required />
                </div>

                <div className="input-group">
                  <label>Válida hasta</label>
                  <input className="input" type="date" value={fecha_validez} onChange={e => setFechaValidez(e.target.value)} />
                  <span className="input-hint">Opcional. Tras esta fecha podrás marcarla como caducada.</span>
                </div>

                <div className="input-group">
                  <label>Condición de pago</label>
                  <select className="input" value={condicion_pago} onChange={e => setCondicionPago(e.target.value)}>
                    {CONDICION_PAGO_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div className="input-group ven-col-full">
                  <label>Notas <span className="input-hint-inline">(visibles en el PDF)</span></label>
                  <textarea className="input input-textarea" rows={2} value={notas} onChange={e => setNotas(e.target.value)}
                    placeholder="Condiciones, garantías, plazos de entrega…" />
                </div>

                <div className="input-group ven-col-full">
                  <label>Notas internas <span className="input-hint-inline">(no se imprimen)</span></label>
                  <textarea className="input input-textarea" rows={2} value={notas_internas} onChange={e => setNotasInternas(e.target.value)}
                    placeholder="Observaciones para uso interno del equipo…" />
                </div>
              </div>
            </div>

            {/* ── Líneas y ajustes ── */}
            <DocumentoLineasEditor
              lineas={lineas}
              ajustes={ajustes}
              moneda={moneda}
              productos={productos}
              onLineasChange={setLineas}
              onAjustesChange={setAjustes}
            />

          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={isPending || sinLetra}>
              {isPending
                ? <><span className="spinner spinner-sm" /> Guardando…</>
                : isEdit ? 'Guardar cambios' : 'Crear oferta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

