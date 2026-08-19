'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileSignature, FileCheck2, FileClock } from 'lucide-react'
import type { EstadoDocumentos, DocumentoEstado } from '@/app/actions/portal/documentos'
import FirmaDocumentoModal from './FirmaDocumentoModal'

const TITULO: Record<string, string> = {
  nda:         'Acuerdo de confidencialidad (NDA)',
  contrato:    'Contrato de prestación de servicio',
  presupuesto: 'Presupuesto (Anexo I)',
}

function fmtFecha(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })
}

export default function DocumentosFirmaCard({ estado }: { estado: EstadoDocumentos }) {
  const router = useRouter()
  const [abierto, setAbierto] = useState<DocumentoEstado | null>(null)

  return (
    <div className="card mb-5">
      <div className="prf-card-header">
        <h2 className="prf-section-title">Documentos y firmas</h2>
        {estado.pendientes > 0
          ? <span className="prf-badge prf-badge-trial">{estado.pendientes} por firmar</span>
          : <span className="prf-badge prf-badge-activo">Todo firmado</span>}
      </div>

      <p className="doc-firma-intro">
        Durante el período de prueba puedes revisar y firmar tus documentos. La firma es
        electrónica y queda registrada con fecha y hora.
      </p>

      <ul className="doc-firma-list">
        {estado.documentos.map(d => (
          <li key={d.tipo} className="doc-firma-item">
            <span className="doc-firma-item-icon" aria-hidden>
              {d.firmado ? <FileCheck2 size={20} /> : <FileClock size={20} />}
            </span>
            <div className="doc-firma-item-info">
              <span className="doc-firma-item-titulo">{TITULO[d.tipo] ?? d.tipo}</span>
              <span className="doc-firma-item-estado">
                {d.firmado && d.firma
                  ? `Firmado el ${fmtFecha(d.firma.firmado_at)} por ${d.firma.firmado_por_nombre}`
                  : 'Pendiente de firma'}
              </span>
            </div>
            <button
              type="button"
              className={`btn btn-sm ${d.firmado ? 'btn-secondary' : 'btn-primary'}`}
              onClick={() => setAbierto(d)}
            >
              <FileSignature size={14} />
              {d.firmado ? 'Ver documento' : 'Ver y firmar'}
            </button>
          </li>
        ))}
      </ul>

      {abierto && (
        <FirmaDocumentoModal
          doc={abierto}
          proveedor={estado.proveedor}
          puedeFirmar={estado.puedeFirmar}
          onClose={() => setAbierto(null)}
          onFirmado={() => router.refresh()}
        />
      )}
    </div>
  )
}
