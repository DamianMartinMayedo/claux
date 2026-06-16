'use client'

import { toastError } from '@/app/contexts/ToastContext'
import { useState, useTransition, useMemo } from 'react'
import Link                                  from 'next/link'
import { useRouter }                         from 'next/navigation'
import { guardarFactura }                    from '@/app/actions/portal/ventas'
import type { VentasResumenData, FacturaDetalleData } from '@/app/actions/portal/ventas'
import type { Empresa }                      from '@/app/actions/portal/empresas'
import { DocumentoLineasEditor }             from '../../../_DocumentoLineasEditor'
import { DocumentoPdf }                      from '../../../_DocumentoPdf'
import { Eye, X } from 'lucide-react'
import {
  CONDICION_PAGO_OPTIONS,
  calcularFechaVencimiento,
  calcularTotales,
  type AjusteInput,
  type LineaInput,
} from '../../../_ventas-helpers'

interface Props {
  data:         FacturaDetalleData
  resumen:      VentasResumenData
  empresasFull: Empresa[]
}

export default function EditarFacturaPage({ data, resumen, empresasFull }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const { factura, lineas: lineasInit, ajustes: ajustesInit } = data

  const empresa_id = factura.empresa_id
  const [cliente_id,       setClienteId]       = useState(factura.cliente_id)
  const [moneda,           setMoneda]          = useState(factura.moneda)
  const [fecha_emision,    setFechaEmision]    = useState(factura.fecha_emision)
  const [fecha_vencimiento, setFechaVencimiento] = useState(factura.fecha_vencimiento ?? '')
  const [condicion_pago,   setCondicionPago]   = useState(factura.condicion_pago ?? 'CONTADO')
  const [notas,            setNotas]           = useState(factura.notas ?? '')
  const [notas_internas,   setNotasInternas]   = useState(factura.notas_internas ?? '')
  const [previewOpen,      setPreviewOpen]     = useState(false)

  const [lineas, setLineas] = useState<LineaInput[]>(() =>
    lineasInit.map(l => ({
      producto_id:     l.producto_id,
      descripcion:     l.descripcion,
      cantidad:        Number(l.cantidad),
      precio_unitario: Number(l.precio_unitario),
      descuento_pct:   Number(l.descuento_pct),
    }))
  )
  const [ajustes, setAjustes] = useState<AjusteInput[]>(() =>
    ajustesInit.map(a => ({
      tipo:   a.tipo as AjusteInput['tipo'],
      nombre: a.nombre,
      modo:   a.modo as AjusteInput['modo'],
      valor:  Number(a.valor),
    }))
  )

  const clientesDeEmpresa = resumen.clientes.filter(c => c.empresa_id === empresa_id)

  function onClienteChange(id: string) {
    setClienteId(id)
    const c = resumen.clientes.find(c => c.tercero_id === id)
    if (c?.moneda_defecto && resumen.monedas.includes(c.moneda_defecto)) {
      setMoneda(c.moneda_defecto)
    }
  }

  function handleCondicionChange(nueva: string) {
    setCondicionPago(nueva)
    setFechaVencimiento(calcularFechaVencimiento(nueva, fecha_emision))
  }

  // ── Preview ──────────────────────────────────────────────────────────────

  const empresaFull = useMemo(() => empresasFull.find(e => e.empresa_id === empresa_id) ?? null, [empresa_id, empresasFull])
  const clienteFull = useMemo(() => resumen.clientes.find(c => c.tercero_id === cliente_id) ?? null, [cliente_id, resumen.clientes])
  const totales     = useMemo(() => calcularTotales(lineas, ajustes), [lineas, ajustes])

  const empresaInfo = empresaFull ? {
    nombre:            empresaFull.nombre,
    nombre_fiscal:     empresaFull.nombre_fiscal,
    rif_nit:           empresaFull.rif_nit,
    direccion:         empresaFull.direccion,
    ciudad:            empresaFull.ciudad,
    pais:              empresaFull.pais,
    telefono:          empresaFull.telefono,
    email:             empresaFull.email,
    logo_url:          empresaFull.logo_url,
    mostrar_logo:      empresaFull.mostrar_logo,
    letra_facturacion: empresaFull.letra_facturacion,
    color:             empresaFull.color,
  } : null

  const clienteInfo = clienteFull ? {
    nombre:         clienteFull.nombre,
    identificacion: clienteFull.identificacion,
    direccion:      clienteFull.direccion,
    ciudad:         clienteFull.ciudad,
    pais:           clienteFull.pais,
    email:          clienteFull.email,
    telefono:       clienteFull.telefono,
  } : null

  const lineasPreview = useMemo(() =>
    lineas.map((l, i) => ({
      linea_id:          i,
      documento_tipo:    'FACTURA' as const,
      documento_id:      factura.factura_id,
      orden:             i,
      producto_id:       l.producto_id,
      descripcion:       l.descripcion,
      cantidad:          l.cantidad,
      precio_unitario:   l.precio_unitario,
      descuento_pct:     l.descuento_pct,
      descuento_importe: totales.lineas_descuentos[i] ?? 0,
      total:             totales.lineas_totales[i] ?? 0,
    })), [lineas, totales, factura.factura_id])

  const ajustesPreview = useMemo(() =>
    ajustes.map((a, i) => ({
      ajuste_id:       i,
      documento_tipo:  'FACTURA' as const,
      documento_id:    factura.factura_id,
      orden:           i,
      tipo:            a.tipo,
      nombre:          a.nombre,
      modo:            a.modo,
      valor:           a.valor,
      monto_calculado: totales.ajustes_calculados[i] ?? 0,
    })), [ajustes, totales, factura.factura_id])

  const canPreview = !!empresaInfo && !!clienteInfo && lineas.length > 0

  // ── Submit ────────────────────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (lineas.length === 0)                      { toastError('Añade al menos una línea.'); return }
    if (lineas.some(l => !l.descripcion.trim()))  { toastError('Toda línea debe tener una descripción.'); return }
    if (ajustes.some(a => !a.nombre.trim()))      { toastError('Todo ajuste debe tener un nombre.'); return }

    const fd = new FormData()
    fd.set('factura_id',      factura.factura_id) // triggers edit mode
    fd.set('empresa_id',      empresa_id)
    fd.set('cliente_id',      cliente_id)
    fd.set('moneda',          moneda)
    fd.set('fecha_emision',     fecha_emision)
    fd.set('fecha_vencimiento', fecha_vencimiento)
    fd.set('condicion_pago',    condicion_pago)
    fd.set('notas',             notas)
    fd.set('notas_internas',    notas_internas)
    fd.set('lineas',  JSON.stringify(lineas))
    fd.set('ajustes', JSON.stringify(ajustes))

    startTransition(async () => {
      const res = await guardarFactura(fd)
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      router.push(`/portal/ventas/facturas/${factura.factura_id}`)
    })
  }

  return (
    <div className="view-container">

      <div className="ven-nueva-header">
        <div>
          <Link href={`/portal/ventas/facturas/${factura.factura_id}`} className="ven-breadcrumb-link">
            ← Volver a {factura.numero}
          </Link>
          <h1 className="ven-nueva-title mt-1">Editar factura</h1>
        </div>
        <div className="ven-nueva-actions">
          {canPreview && (
            <button type="button" className="btn btn-secondary" onClick={() => setPreviewOpen(true)}>
              <Eye size={13} strokeWidth={2} /> Vista previa
            </button>
          )}
          <Link href={`/portal/ventas/facturas/${factura.factura_id}`} className="btn btn-secondary">Cancelar</Link>
          <button type="submit" form="form-editar-factura" className="btn btn-primary" disabled={isPending}>
            {isPending
              ? <><span className="spinner spinner-sm" /> Guardando…</>
              : 'Guardar cambios'}
          </button>
        </div>
      </div>

      <form id="form-editar-factura" onSubmit={handleSubmit}>
        <div className="ven-form-section">
          <span className="ven-form-section-title">Datos del documento</span>
          <div className="ven-form-grid">
            <div className="input-group">
              <label>Empresa</label>
              <div className="input input-static">
                {data.empresa.letra_facturacion} · {data.empresa.nombre}
              </div>
              <span className="input-hint">La empresa no se puede cambiar.</span>
            </div>

            <div className="input-group">
              <label>Cliente <span className="required">*</span></label>
              <select className="input" value={cliente_id} onChange={e => onClienteChange(e.target.value)} required>
                {clientesDeEmpresa.map(c => (
                  <option key={c.tercero_id} value={c.tercero_id}>{c.nombre}</option>
                ))}
              </select>
            </div>

            <div className="input-group">
              <label>Moneda <span className="required">*</span></label>
              <select className="input" value={moneda} onChange={e => setMoneda(e.target.value)} required>
                {resumen.monedas.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            <div className="input-group">
              <label>Fecha emisión <span className="required">*</span></label>
              <input className="input" type="date" value={fecha_emision}
                onChange={e => setFechaEmision(e.target.value)} required />
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
              <span className="input-hint">Se calcula desde la condición de pago.</span>
            </div>
          </div>
        </div>

        <DocumentoLineasEditor
          lineas={lineas}
          ajustes={ajustes}
          moneda={moneda}
          productos={resumen.productos}
          notas={notas}
          notasInternas={notas_internas}
          onLineasChange={setLineas}
          onAjustesChange={setAjustes}
          onNotasChange={setNotas}
          onNotasInternasChange={setNotasInternas}
        />

      </form>

      {previewOpen && canPreview && (
        <div className="modal-backdrop open">
          <div className="ven-preview-modal" role="dialog" aria-modal>
            <div className="ven-preview-modal-header">
              <span className="ven-preview-modal-title"><Eye size={13} strokeWidth={2} /> Vista previa</span>
              <button className="modal-close" onClick={() => setPreviewOpen(false)} aria-label="Cerrar">
                <X size={18} />
              </button>
            </div>
            <div className="ven-preview-modal-body">
              <div className="ven-preview-scale">
                <DocumentoPdf
                  titulo="FACTURA"
                  numero={factura.numero}
                  fechaEmision={fecha_emision}
                  fechaSecundaria={fecha_vencimiento ? { label: 'Vencimiento', valor: fecha_vencimiento } : undefined}
                  condicionPago={condicion_pago}
                  empresa={empresaInfo!}
                  cliente={clienteInfo!}
                  moneda={moneda}
                  lineas={lineasPreview}
                  ajustes={ajustesPreview}
                  subtotal={totales.subtotal}
                  total={totales.total}
                  notas={notas || null}
                  autoPrint={false}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

