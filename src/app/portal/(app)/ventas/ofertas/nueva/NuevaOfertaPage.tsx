'use client'

import { toastError } from '@/app/contexts/ToastContext'
import { useState, useTransition } from 'react'
import Link                                  from 'next/link'
import { useRouter }                         from 'next/navigation'
import { guardarOferta }                     from '@/app/actions/portal/ventas'
import type { VentasResumenData }            from '@/app/actions/portal/ventas'
import { DocumentoLineasEditor }             from '../../_DocumentoLineasEditor'
import { MonedaDocumento }                   from '../../_MonedaDocumento'
import CrearTerceroInline                    from '@/components/portal/CrearTerceroInline'
import {
  CONDICION_PAGO_OPTIONS,
  tieneImportes,
  type AjusteInput,
  type LineaInput,
} from '../../_ventas-helpers'

interface Props {
  resumen:      VentasResumenData
}

export default function NuevaOfertaPage({ resumen }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const empresasConLetra = resumen.empresas.filter(e => !!e.letra_facturacion)
  const sinLetra         = resumen.empresas.length > 0 && empresasConLetra.length === 0

  const [empresa_id,    setEmpresaId]    = useState(empresasConLetra[0]?.empresa_id ?? '')
  const [cliente_id,    setClienteId]    = useState('')
  const [moneda,        setMoneda]       = useState(resumen.monedas[0] ?? '')
  const [fecha_emision, setFechaEmision] = useState(new Date().toISOString().substring(0, 10))
  const [fecha_validez, setFechaValidez] = useState('')
  const [condicion_pago, setCondicionPago] = useState('CONTADO')
  const [notas,          setNotas]         = useState('')
  const [notas_internas, setNotasInternas] = useState('')

  const [lineas,  setLineas]  = useState<LineaInput[]>([])
  const [ajustes, setAjustes] = useState<AjusteInput[]>([])

  const clientesDeEmpresa = resumen.clientes.filter(c => c.empresa_id === empresa_id)

  function onClienteChange(id: string) {
    setClienteId(id)
    const c = resumen.clientes.find(c => c.tercero_id === id)
    // La moneda del cliente se adopta solo si no hay importes escritos: cambiarla
    // con líneas puestas las reetiquetaría sin convertir (el mismo fallo que tenía
    // el selector de moneda). Con importes, se respeta la del documento y el dueño
    // la cambia a mano por el selector, que sí ofrece la conversión.
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
      router.push(`/portal/ventas/ofertas/${res.oferta_id}`)
    })
  }

  return (
    <div className="view-container">

      {/* ── Header ── */}
      <div className="ven-nueva-header">
        <div>
          <Link href="/portal/ventas?t=ofertas" className="ven-breadcrumb-link">
            ← Volver a Ventas
          </Link>
          <h1 className="ven-nueva-title mt-1">Nueva oferta comercial</h1>
        </div>
        <div className="ven-nueva-actions">
          <Link href="/portal/ventas?t=ofertas" className="btn btn-secondary">Cancelar</Link>
          <button type="submit" form="form-nueva-oferta" className="btn btn-primary" disabled={isPending || sinLetra}>
            {isPending
              ? <><span className="spinner spinner-sm" /> Guardando…</>
              : 'Guardar oferta'}
          </button>
        </div>
      </div>

      {sinLetra && (
        <div className="alert alert-warning mb-4">
          Ninguna de tus empresas tiene letra de facturación asignada. Ve a{' '}
          <Link href="/portal/empresas" className="link-primary">Mis Empresas</Link>{' '}
          y asígnala antes de crear ofertas.
        </div>
      )}

      {/* ── Form ── */}
      <form id="form-nueva-oferta" onSubmit={handleSubmit}>
        <div className="ven-form-section">
          <span className="ven-form-section-title">Datos del documento</span>
          <div className="ven-form-grid">
            <div className="input-group">
              <label>Empresa <span className="required">*</span></label>
              <select className="input" value={empresa_id} onChange={e => setEmpresaId(e.target.value)} required>
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
                <div className="crear-tercero-empty">
                  <span className="input-hint">Esta empresa no tiene clientes.</span>
                  <CrearTerceroInline
                    empresas={resumen.empresas.filter(e => e.empresa_id === empresa_id).map(e => ({ empresa_id: e.empresa_id, nombre: e.nombre }))}
                    monedas={resumen.monedas}
                    defaultTipo="CLIENTE"
                    label="Crear cliente"
                    onCreated={(id) => { if (id) onClienteChange(id) }}
                  />
                </div>
              )}
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

