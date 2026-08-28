// ── Documentos legales del cliente (NDA, contrato, presupuesto) ──
//
// Estado de firma de cada documento, con descarga del PDF firmado (URL firmada
// del bucket privado) y un recordatorio al cliente que aún no firmó. Los
// documentos se generan y firman desde el portal del cliente; aquí solo se ven.

import { FileSignature } from 'lucide-react'
import type { FirmaClienteRow } from '@/app/actions/documentos-admin'
import RecordatorioDocumentosBtn from './RecordatorioDocumentosBtn'
import DescargarFirmaBtn from './DescargarFirmaBtn'
import ReabrirFirmasBtn from './ReabrirFirmasBtn'

/** Los tres papeles del alta. Exportado porque la ficha cuenta con ellos los que
 *  faltan por firmar para el aviso de la pestaña: el número y esta lista tienen
 *  que salir del mismo sitio o el día que se añada un cuarto documento el aviso
 *  se queda corto sin que nadie lo note. */
export const DOCS: { tipo: string; label: string }[] = [
  { tipo: 'nda',         label: 'Acuerdo de confidencialidad (NDA)' },
  { tipo: 'contrato',    label: 'Contrato de prestación de servicio' },
  { tipo: 'presupuesto', label: 'Presupuesto (Anexo I)' },
]

function fmtFecha(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function DocumentosClienteCard(
  /** Las firmas llegan leídas de la página: allí ya hacen falta para contar los
   *  documentos pendientes de la solapa, y pedirlas otra vez aquí sería la misma
   *  consulta dos veces en el mismo render. */
  { clientId, firmas }: { clientId: string; firmas: FirmaClienteRow[] },
) {
  // La más reciente por tipo (vienen ordenadas por fecha desc).
  const ultima = new Map<string, typeof firmas[number]>()
  for (const f of firmas) if (!ultima.has(f.tipo)) ultima.set(f.tipo, f)

  const pendientes = DOCS.filter(d => !ultima.has(d.tipo)).length
  const hayFirmas = ultima.size > 0

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Documentos legales</h2>
        <div className="doc-cli-acciones">
          {pendientes > 0 && <RecordatorioDocumentosBtn clientId={clientId} />}
          {hayFirmas && <ReabrirFirmasBtn clientId={clientId} />}
        </div>
      </div>

      <div className="table-wrapper table-wrapper-flush">
        <table className="table">
          <thead>
            <tr>
              <th>Documento</th>
              <th>Estado</th>
              <th>Firmado por</th>
              <th className="col-actions" />
            </tr>
          </thead>
          <tbody>
            {DOCS.map(d => {
              const f = ultima.get(d.tipo)
              return (
                <tr key={d.tipo}>
                  <td data-label="Documento">
                    <span className="doc-cli-nombre"><FileSignature size={15} /> {d.label}</span>
                  </td>
                  <td data-label="Estado">
                    {f
                      ? <span className="badge badge-success">Firmado el {fmtFecha(f.firmado_at)}</span>
                      : <span className="badge badge-warning">Pendiente de firma</span>}
                  </td>
                  <td data-label="Firmado por" className="table-muted">
                    {f ? f.firmado_por_nombre : '—'}
                  </td>
                  <td className="col-actions">
                    {f && f.tiene_pdf && (
                      <DescargarFirmaBtn clientId={clientId} firmaId={f.id} />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
