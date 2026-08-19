'use client'

import { useState, useTransition } from 'react'
import { X, ShieldCheck, Download } from 'lucide-react'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { firmarDocumento, subirPdfFirma, type DocumentoEstado } from '@/app/actions/portal/documentos'
import type { DatosProveedor, DocumentoResuelto, Elemento } from '@/lib/documentos/render'
import {
  descargarDocumentoFirmado, blobDocumentoFirmado, type SelloFirma,
} from '@/lib/pdf/documento-firmado'

// ── Render del cuerpo del documento (mismo contenido que se hashea y que va al PDF) ──
function CuerpoDocumento({ cuerpo }: { cuerpo: Elemento[] }) {
  return (
    <div className="doc-firma-cuerpo">
      {cuerpo.map((el, i) => {
        if (el.tipo === 'seccion') {
          return (
            <section key={i} className="doc-firma-seccion">
              {el.titulo && <h4 className="doc-firma-seccion-titulo">{el.titulo}</h4>}
              {el.parrafos.map((p, j) => <p key={j} className="doc-firma-parrafo">{p}</p>)}
            </section>
          )
        }
        if (el.tipo === 'lista') {
          return (
            <section key={i} className="doc-firma-seccion">
              {el.titulo && <h4 className="doc-firma-seccion-titulo">{el.titulo}</h4>}
              <ul className="doc-firma-lista">
                {el.items.map((it, j) => <li key={j}>{it}</li>)}
              </ul>
            </section>
          )
        }
        // tabla
        return (
          <section key={i} className="doc-firma-seccion">
            {el.titulo && <h4 className="doc-firma-seccion-titulo">{el.titulo}</h4>}
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>{el.columnas.map((c, j) => (
                    <th key={j} className={j === el.columnas.length - 1 ? 'col-num' : undefined}>{c}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {el.filas.map((fila, r) => (
                    <tr key={r}>{fila.map((celda, k) => (
                      <td
                        key={k}
                        data-label={el.columnas[k]}
                        className={k === fila.length - 1 ? 'col-num' : undefined}
                      >{celda}</td>
                    ))}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            {el.nota && <p className="doc-firma-nota">{el.nota}</p>}
          </section>
        )
      })}
    </div>
  )
}

export default function FirmaDocumentoModal({
  doc, proveedor, puedeFirmar, onClose, onFirmado,
}: {
  doc: DocumentoEstado
  proveedor: DatosProveedor
  puedeFirmar: boolean
  onClose: () => void
  onFirmado: () => void
}) {
  const [acepto, setAcepto] = useState(false)
  const [nombre, setNombre] = useState('')
  const [isPending, startTransition] = useTransition()
  const contenido: DocumentoResuelto = doc.contenido

  // Genera y descarga el PDF firmado (regenerado desde el mismo contenido). Si
  // `firmaId` viene, además lo sube al bucket privado (tras firmar).
  async function generarPdf(sello: SelloFirma, firmaId?: number) {
    try {
      await descargarDocumentoFirmado(contenido, proveedor, sello)
      if (firmaId) {
        const blob = await blobDocumentoFirmado(contenido, proveedor, sello)
        const fd = new FormData()
        fd.append('firmaId', String(firmaId))
        fd.append('pdf', new File([blob], `${contenido.tipo}-${firmaId}.pdf`, { type: 'application/pdf' }))
        await subirPdfFirma(fd)
      }
    } catch {
      toastError('No se pudo generar el PDF, pero tu firma quedó registrada.')
    }
  }

  function handleFirmar() {
    if (!acepto)              { toastError('Marca la casilla para aceptar el documento.'); return }
    if (nombre.trim().length < 3) { toastError('Escribe tu nombre completo.'); return }

    const ld = toastLoading('Registrando firma…')
    startTransition(async () => {
      const fd = new FormData()
      fd.append('tipo', contenido.tipo)
      fd.append('nombre', nombre.trim())
      fd.append('acepto', 'true')
      const res = await firmarDocumento(fd)
      await ld.dismiss()
      if (!res.ok || !res.firma) { toastError(res.error ?? 'No se pudo firmar.'); return }
      toastSuccess('Documento firmado')
      await generarPdf({
        firmadoPorNombre: res.firma.firmadoPorNombre,
        firmadoPorEmail:  res.firma.firmadoPorEmail,
        firmadoAt:        res.firma.firmadoAt,
        docHash:          res.firma.docHash,
      }, res.firma.id)
      onFirmado()
      onClose()
    })
  }

  function handleDescargarFirmado() {
    if (!doc.firma) return
    generarPdf({
      firmadoPorNombre: doc.firma.firmado_por_nombre,
      firmadoPorEmail:  doc.firma.firmado_por_email,
      firmadoAt:        doc.firma.firmado_at,
      docHash:          doc.firma.doc_hash,
    })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-xl modal-fixed-actions"
        role="dialog"
        aria-modal="true"
        aria-label={contenido.titulo}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">{contenido.titulo}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          {contenido.subtitulo && <p className="doc-firma-subtitulo">{contenido.subtitulo}</p>}
          <CuerpoDocumento cuerpo={contenido.cuerpo} />

          {doc.firmado ? (
            <div className="doc-firma-sello">
              <ShieldCheck size={18} className="doc-firma-sello-icon" />
              <div>
                <p className="doc-firma-sello-txt">
                  Firmado por {doc.firma?.firmado_por_nombre} el{' '}
                  {doc.firma ? new Date(doc.firma.firmado_at).toLocaleString('es-ES', {
                    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
                  }) : ''}
                </p>
                <p className="doc-firma-sello-hash">Huella SHA-256: {doc.firma?.doc_hash}</p>
              </div>
            </div>
          ) : puedeFirmar ? (
            <div className="doc-firma-form">
              <label className="doc-firma-check">
                <input type="checkbox" checked={acepto} onChange={e => setAcepto(e.target.checked)} />
                <span>He leído y acepto este documento en nombre de la empresa.</span>
              </label>
              <div className="input-group">
                <label>Nombre y apellidos del firmante <span className="required">*</span></label>
                <input
                  className="input"
                  value={nombre}
                  onChange={e => setNombre(e.target.value)}
                  placeholder="Tu nombre completo"
                  autoComplete="name"
                />
              </div>
              <p className="doc-firma-legal">
                Al firmar, se registra la fecha, tu IP y la versión del documento como firma
                electrónica válida (eIDAS / Ley 6/2020).
              </p>
            </div>
          ) : (
            <p className="doc-firma-legal">
              Solo el administrador de la empresa puede firmar los documentos.
            </p>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {doc.firmado ? 'Cerrar' : 'Cancelar'}
          </button>
          {doc.firmado ? (
            <button type="button" className="btn btn-primary" onClick={handleDescargarFirmado}>
              <Download size={16} /> Descargar PDF
            </button>
          ) : puedeFirmar ? (
            <button type="button" className="btn btn-primary" disabled={isPending} onClick={handleFirmar}>
              {isPending ? <><span className="spinner spinner-sm" /> Firmando…</> : 'Firmar y descargar'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
