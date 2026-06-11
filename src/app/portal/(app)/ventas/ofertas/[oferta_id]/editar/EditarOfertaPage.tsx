'use client'

import { useState, useTransition, useMemo } from 'react'
import Link                                  from 'next/link'
import { useRouter }                         from 'next/navigation'
import { guardarOferta }                     from '@/app/actions/portal/ventas'
import type { VentasResumenData, OfertaDetalleData } from '@/app/actions/portal/ventas'
import type { Empresa }                      from '@/app/actions/portal/empresas'
import { DocumentoLineasEditor }             from '../../../_DocumentoLineasEditor'
import { DocumentoPdf }                      from '../../../_DocumentoPdf'
import {
  CONDICION_PAGO_OPTIONS,
  calcularTotales,
  type AjusteInput,
  type LineaInput,
} from '../../../_ventas-helpers'

interface Props {
  data:         OfertaDetalleData
  resumen:      VentasResumenData
  empresasFull: Empresa[]
}

export default function EditarOfertaPage({ data, resumen, empresasFull }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const { oferta, lineas: lineasInit, ajustes: ajustesInit } = data

  // Pre-fill all state from existing oferta
  const empresa_id = oferta.empresa_id
  const [cliente_id,    setClienteId]    = useState(oferta.cliente_id)
  const [moneda,        setMoneda]       = useState(oferta.moneda)
  const [fecha_emision, setFechaEmision] = useState(oferta.fecha_emision)
  const [fecha_validez, setFechaValidez] = useState(oferta.fecha_validez ?? '')
  const [condicion_pago, setCondicionPago] = useState(oferta.condicion_pago ?? 'CONTADO')
  const [notas,          setNotas]         = useState(oferta.notas ?? '')
  const [notas_internas, setNotasInternas] = useState(oferta.notas_internas ?? '')
  const [previewOpen,    setPreviewOpen]   = useState(false)

  // Convert existing lineas/ajustes to LineaInput/AjusteInput format
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
      documento_tipo:    'OFERTA' as const,
      documento_id:      oferta.oferta_id,
      orden:             i,
      producto_id:       l.producto_id,
      descripcion:       l.descripcion,
      cantidad:          l.cantidad,
      precio_unitario:   l.precio_unitario,
      descuento_pct:     l.descuento_pct,
      descuento_importe: totales.lineas_descuentos[i] ?? 0,
      total:             totales.lineas_totales[i] ?? 0,
    })), [lineas, totales, oferta.oferta_id])

  const ajustesPreview = useMemo(() =>
    ajustes.map((a, i) => ({
      ajuste_id:       i,
      documento_tipo:  'OFERTA' as const,
      documento_id:    oferta.oferta_id,
      orden:           i,
      tipo:            a.tipo,
      nombre:          a.nombre,
      modo:            a.modo,
      valor:           a.valor,
      monto_calculado: totales.ajustes_calculados[i] ?? 0,
    })), [ajustes, totales, oferta.oferta_id])

  const canPreview = !!empresaInfo && !!clienteInfo && lineas.length > 0

  // ── Submit ────────────────────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')

    if (lineas.length === 0)                      { setError('Añade al menos una línea.'); return }
    if (lineas.some(l => !l.descripcion.trim()))  { setError('Toda línea debe tener una descripción.'); return }
    if (ajustes.some(a => !a.nombre.trim()))      { setError('Todo ajuste debe tener un nombre.'); return }

    const fd = new FormData()
    fd.set('oferta_id',     oferta.oferta_id)   // triggers edit mode in guardarOferta
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
      if (!res.ok) { setError(res.error ?? 'Error inesperado.'); return }
      router.push(`/portal/ventas/ofertas/${oferta.oferta_id}`)
    })
  }

  return (
    <div className="view-container">

      <div className="ven-nueva-header">
        <div>
          <Link href={`/portal/ventas/ofertas/${oferta.oferta_id}`}
            style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textDecoration: 'none' }}>
            ← Volver a {oferta.numero}
          </Link>
          <h1 className="ven-nueva-title" style={{ marginTop: 4 }}>Editar oferta</h1>
        </div>
        <div className="ven-nueva-actions">
          {canPreview && (
            <button type="button" className="btn btn-secondary" onClick={() => setPreviewOpen(true)}>
              <IconEye /> Vista previa
            </button>
          )}
          <Link href={`/portal/ventas/ofertas/${oferta.oferta_id}`} className="btn btn-secondary">Cancelar</Link>
          <button type="submit" form="form-editar-oferta" className="btn btn-primary" disabled={isPending}>
            {isPending
              ? <><span className="spinner spinner-sm" style={{ borderTopColor: '#fff' }} /> Guardando…</>
              : 'Guardar cambios'}
          </button>
        </div>
      </div>

      <form id="form-editar-oferta" onSubmit={handleSubmit}>
        <div className="ven-form-section">
          <span className="ven-form-section-title">Datos del documento</span>
          <div className="ven-form-grid">
            {/* Empresa es fija en edición */}
            <div className="input-group">
              <label>Empresa</label>
              <div className="input" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-muted)', cursor: 'default' }}>
                {data.empresa.letra_facturacion} · {data.empresa.nombre}
              </div>
              <span className="input-hint">La empresa no se puede cambiar una vez creada la oferta.</span>
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
              <input className="input" type="date" value={fecha_emision} onChange={e => setFechaEmision(e.target.value)} required />
            </div>

            <div className="input-group">
              <label>Válida hasta</label>
              <input className="input" type="date" value={fecha_validez} onChange={e => setFechaValidez(e.target.value)} />
              <span className="input-hint">Opcional.</span>
            </div>

            <div className="input-group">
              <label>Condición de pago</label>
              <select className="input" value={condicion_pago} onChange={e => setCondicionPago(e.target.value)}>
                {CONDICION_PAGO_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
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

        {error && <div className="alert alert-error" style={{ marginTop: 16 }}>{error}</div>}
      </form>

      {/* ── Modal: vista previa ── */}
      {previewOpen && canPreview && (
        <div className="modal-backdrop open" onClick={e => { if (e.target === e.currentTarget) setPreviewOpen(false) }}>
          <div className="ven-preview-modal" role="dialog" aria-modal>
            <div className="ven-preview-modal-header">
              <span className="ven-preview-modal-title"><IconEye /> Vista previa</span>
              <button className="modal-close" onClick={() => setPreviewOpen(false)} aria-label="Cerrar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div className="ven-preview-modal-body">
              <div className="ven-preview-scale">
                <DocumentoPdf
                  titulo="OFERTA COMERCIAL"
                  numero={oferta.numero}
                  fechaEmision={fecha_emision}
                  fechaSecundaria={fecha_validez ? { label: 'Válida hasta', valor: fecha_validez } : undefined}
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

function IconEye() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
}
