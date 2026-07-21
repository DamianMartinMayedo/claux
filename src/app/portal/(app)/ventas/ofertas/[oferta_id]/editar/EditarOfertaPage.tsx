'use client'

import { toastError } from '@/app/contexts/ToastContext'
import { useState, useTransition } from 'react'
import Link                                  from 'next/link'
import { useRouter }                         from 'next/navigation'
import { guardarOferta }                     from '@/app/actions/portal/ventas'
import type { VentasResumenData, OfertaDetalleData } from '@/app/actions/portal/ventas'
import { DocumentoLineasEditor }             from '../../../_DocumentoLineasEditor'
import { MonedaDocumento }                   from '../../../_MonedaDocumento'
import {
  CONDICION_PAGO_OPTIONS,
  tieneImportes,
  type AjusteInput,
  type LineaInput,
} from '../../../_ventas-helpers'

interface Props {
  data:         OfertaDetalleData
  resumen:      VentasResumenData
}

export default function EditarOfertaPage({ data, resumen }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

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
    // Solo sin importes escritos: ver la nota en NuevaOfertaPage. Aquí importa aún
    // más — un documento ya guardado siempre llega con líneas.
    if (c?.moneda_defecto && resumen.monedas.includes(c.moneda_defecto)
        && !tieneImportes(lineas, ajustes)) {
      setMoneda(c.moneda_defecto)
    }
  }


  // ── Submit ────────────────────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (lineas.length === 0)                      { toastError('Añade al menos una línea.'); return }
    if (lineas.some(l => !l.descripcion.trim()))  { toastError('Toda línea debe tener una descripción.'); return }
    if (ajustes.some(a => !a.nombre.trim()))      { toastError('Todo ajuste debe tener un nombre.'); return }

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
      if (!res.ok) { toastError(res.error ?? 'Error inesperado.'); return }
      router.push(`/portal/ventas/ofertas/${oferta.oferta_id}`)
    })
  }

  return (
    <div className="view-container">

      <div className="ven-nueva-header">
        <div>
          <Link href={`/portal/ventas/ofertas/${oferta.oferta_id}`} className="ven-breadcrumb-link">
            ← Volver a {oferta.numero}
          </Link>
          <h1 className="ven-nueva-title mt-1">Editar oferta</h1>
        </div>
        <div className="ven-nueva-actions">
          <Link href={`/portal/ventas/ofertas/${oferta.oferta_id}`} className="btn btn-secondary">Cancelar</Link>
          <button type="submit" form="form-editar-oferta" className="btn btn-primary" disabled={isPending}>
            {isPending
              ? <><span className="spinner spinner-sm" /> Guardando…</>
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
              <div className="input input-static">
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

            <MonedaDocumento
              moneda={moneda}
              monedas={resumen.monedas}
              tasas={resumen.tasas}
              productos={resumen.productos}
              lineas={lineas}
              ajustes={ajustes}
              onChange={(m, l, a) => { setMoneda(m); setLineas(l); setAjustes(a) }}
            />

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

      </form>
    </div>
  )
}

