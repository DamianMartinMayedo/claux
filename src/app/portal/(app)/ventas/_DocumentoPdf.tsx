'use client'

import { useEffect, useState } from 'react'
import {
  AJUSTE_TIPO_LABEL,
  CONDICION_PAGO_LABEL,
  formatearMoneda,
} from './_ventas-helpers'
import { empresaColorVar } from '@/components/portal/EmpresaTag'
import type {
  DocumentoLinea,
  DocumentoAjuste,
} from '@/app/actions/portal/ventas'

interface EmpresaInfo {
  nombre:            string
  nombre_fiscal:     string | null
  rif_nit:           string | null
  direccion:         string | null
  ciudad:            string | null
  pais:              string | null
  telefono:          string | null
  email:             string | null
  logo_url:          string | null
  mostrar_logo?:     boolean | null
  letra_facturacion: string | null
  color:             string
}

interface ClienteInfo {
  nombre:         string
  identificacion: string | null
  direccion:      string | null
  ciudad:         string | null
  pais:           string | null
  email:          string | null
  telefono:       string | null
}

interface Props {
  titulo:           'OFERTA COMERCIAL' | 'FACTURA'
  numero:           string
  fechaEmision:     string
  fechaSecundaria?: { label: string; valor: string }
  condicionPago?:   string
  empresa:          EmpresaInfo
  cliente:          ClienteInfo
  moneda:           string
  lineas:           DocumentoLinea[]
  ajustes:          DocumentoAjuste[]
  subtotal:         number
  total:            number
  notas:            string | null
  autoPrint?:       boolean
  autoDownload?:    boolean
  downloadFilename?: string
}

export function DocumentoPdf({
  titulo, numero, fechaEmision, fechaSecundaria, condicionPago,
  empresa, cliente, moneda, lineas, ajustes, subtotal, total, notas,
  autoPrint = false, autoDownload = false, downloadFilename,
}: Props) {
  const tieneDescuentosLinea = lineas.some(l => Number(l.descuento_pct) > 0)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (autoPrint) {
      const t = setTimeout(() => window.print(), 400)
      return () => clearTimeout(t)
    }
  }, [autoPrint])

  useEffect(() => {
    if (autoDownload) {
      const t = setTimeout(() => handleDownload(), 600)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDownload])

  async function handleDownload() {
    if (downloading) return
    setDownloading(true)
    try {
      const { crearDoc, sellarPie }     = await import('@/lib/pdf/documento')
      const { construirDocumentoVenta } = await import('@/lib/pdf/venta')
      const doc = await crearDoc()
      await construirDocumentoVenta(doc, {
        titulo, numero, fechaEmision, fechaSecundaria, condicionPago,
        empresa, cliente, moneda, lineas, ajustes, subtotal, total, notas,
      })
      sellarPie(doc)
      doc.save(downloadFilename ?? `${numero}.pdf`)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="pdf-page">

      {/* Barra de herramientas (no se imprime) */}
      <div className="pdf-toolbar no-print">
        <span className="pdf-toolbar-brand">CLAUX · Vista previa</span>
        <div className="pdf-toolbar-actions">
          <button
            onClick={handleDownload}
            className="btn btn-primary"
            disabled={downloading}
          >
            {downloading ? 'Generando…' : '↓ Descargar PDF'}
          </button>
          <button onClick={() => window.print()} className="btn btn-secondary">
            Imprimir
          </button>
          <button onClick={() => window.history.back()} className="btn btn-secondary">
            ← Volver
          </button>
        </div>
      </div>

      {/* ── Cabecera ── */}
      <header className="pdf-header">
        <div className="pdf-empresa">
          {empresa.logo_url && empresa.mostrar_logo !== false ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={empresa.logo_url} alt={empresa.nombre} className="pdf-logo" />
          ) : (
            <div className="pdf-logo-fallback" style={empresaColorVar(empresa.color)}>
              {empresa.letra_facturacion ?? empresa.nombre.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="pdf-empresa-info">
            <div className="pdf-empresa-nombre">{empresa.nombre_fiscal ?? empresa.nombre}</div>
            {empresa.rif_nit && <div className="pdf-empresa-line">NIF/NIT: {empresa.rif_nit}</div>}
            {(empresa.direccion || empresa.ciudad || empresa.pais) && (
              <div className="pdf-empresa-line">
                {[empresa.direccion, empresa.ciudad, empresa.pais].filter(Boolean).join(', ')}
              </div>
            )}
            {(empresa.telefono || empresa.email) && (
              <div className="pdf-empresa-line">
                {[empresa.telefono, empresa.email].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
        </div>
        <div className="pdf-doc-block">
          <div className="pdf-doc-titulo">{titulo}</div>
          <div className="pdf-doc-numero">{numero}</div>
          <div className="pdf-doc-meta">
            <div><span>Fecha:</span> {fmtFecha(fechaEmision)}</div>
            {fechaSecundaria && (
              <div><span>{fechaSecundaria.label}:</span> {fmtFecha(fechaSecundaria.valor)}</div>
            )}
            {condicionPago && condicionPago !== 'CONTADO' && (
              <div><span>Pago:</span> {CONDICION_PAGO_LABEL[condicionPago] ?? condicionPago}</div>
            )}
          </div>
        </div>
      </header>

      {/* ── Cliente ── */}
      <section className="pdf-cliente">
        <div className="pdf-section-label">Cliente</div>
        <div className="pdf-cliente-nombre">{cliente.nombre}</div>
        {cliente.identificacion && <div className="pdf-line">ID: {cliente.identificacion}</div>}
        {(cliente.direccion || cliente.ciudad || cliente.pais) && (
          <div className="pdf-line">
            {[cliente.direccion, cliente.ciudad, cliente.pais].filter(Boolean).join(', ')}
          </div>
        )}
        {(cliente.email || cliente.telefono) && (
          <div className="pdf-line">
            {[cliente.email, cliente.telefono].filter(Boolean).join(' · ')}
          </div>
        )}
      </section>

      {/* ── Líneas ── */}
      <table className="pdf-table">
        <thead>
          <tr>
            <th className="pdf-col-desc">Descripción</th>
            <th className="pdf-col-qty">Cantidad</th>
            <th className="pdf-col-price">Precio unit.</th>
            {tieneDescuentosLinea && <th className="pdf-col-dto">Dto.%</th>}
            <th className="pdf-col-price">Total</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map(l => (
            <tr key={l.linea_id}>
              <td>{l.descripcion}</td>
              <td className="text-right">{Number(l.cantidad)}</td>
              <td className="text-right">{formatearMoneda(Number(l.precio_unitario), moneda)}</td>
              {tieneDescuentosLinea && (
                <td className="text-right">
                  {Number(l.descuento_pct) > 0 ? `${Number(l.descuento_pct)}%` : ''}
                </td>
              )}
              <td className="pdf-td-amt">{formatearMoneda(Number(l.total), moneda)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Totales ── */}
      <div className="pdf-totales">
        <div className="pdf-total-row">
          <span>Subtotal</span>
          <span>{formatearMoneda(subtotal, moneda)}</span>
        </div>
        {ajustes.map(a => (
          <div key={a.ajuste_id} className="pdf-total-row">
            <span>
              {a.tipo === 'DESCUENTO' ? '− ' : '+ '}
              {a.nombre || AJUSTE_TIPO_LABEL[a.tipo]}
            </span>
            <span>
              {a.tipo === 'DESCUENTO' ? '−' : '+'} {formatearMoneda(Number(a.monto_calculado), moneda)}
            </span>
          </div>
        ))}
        <div className="pdf-total-row pdf-total-final">
          <span>Total</span>
          <span>{formatearMoneda(total, moneda)}</span>
        </div>
      </div>

      {/* ── Notas ── */}
      {notas && (
        <section className="pdf-notas">
          <div className="pdf-section-label">Notas</div>
          <p>{notas}</p>
        </section>
      )}

      {/* ── Pie (sello de marca) ── */}
      <footer className="pdf-footer">
        Documento generado con <strong>CLAUX</strong>
      </footer>
    </div>
  )
}

function fmtFecha(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })
}
