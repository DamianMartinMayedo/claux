'use client'

import { useMemo, useState, useTransition } from 'react'
import { X, Plus, Send } from 'lucide-react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import type { ReportesData } from '@/app/actions/portal/reportes'
import { enviarReportesAsesor } from '@/app/actions/portal/reportes'
import type { Asesor } from '@/app/actions/portal/asesores'
import { guardarAsesor } from '@/app/actions/portal/asesores'

function fmt(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Modal "Enviar al asesor". Se preconfigura con lo que hay en pantalla (empresa,
// período, y el consolidado si está visible) y deja modificarlo TODO antes de
// enviar: a qué asesor, qué archivos (PDF/CSV), si incluye el consolidado, y una
// nota. Muestra un resumen de lo que se envía — el usuario siempre sabe qué manda.
export default function EnviarAsesorModal({
  data, desde, hasta, empresaId, empresaNombre, nombreArchivo,
  asesores, empresas, construirPdfBase64, onClose, onEnviado,
}: {
  data:            ReportesData
  desde:           string
  hasta:           string
  empresaId:       string   // '' = todas
  empresaNombre:   string
  nombreArchivo:   string
  asesores:        Asesor[]
  empresas:        { empresa_id: string; nombre: string }[]
  // Genera EL MISMO PDF que se descarga, con/sin consolidado, y lo devuelve en base64.
  construirPdfBase64: (incluirConsolidado: boolean) => Promise<string>
  onClose:         () => void
  onEnviado:       () => void
}) {
  // Asesores válidos para el alcance: los de "todas" (empresa_id null) más, si hay
  // una empresa concreta seleccionada, los de esa empresa.
  const asesoresFiltrados = useMemo(() => asesores.filter(
    a => !a.empresa_id || (empresaId ? a.empresa_id === empresaId : true),
  ), [asesores, empresaId])

  const [lista,    setLista]    = useState<Asesor[]>(asesoresFiltrados)
  const [asesorId, setAsesorId] = useState(asesoresFiltrados[0]?.asesor_id ?? '')

  const hayConsolidado = !!data.consolidado
  const [incluirConsolidado, setIncluirConsolidado] = useState(hayConsolidado)
  const [incluirPDF, setIncluirPDF] = useState(true)
  const [incluirCSV, setIncluirCSV] = useState(true)
  const [nota, setNota] = useState('')
  const [isPending, startTransition] = useTransition()

  // Alta rápida de asesor (el otro sitio de gestión es Perfil).
  const [addOpen,    setAddOpen]    = useState(lista.length === 0)
  const [addNombre,  setAddNombre]  = useState('')
  const [addEmail,   setAddEmail]   = useState('')
  const [addEmpresa, setAddEmpresa] = useState(empresaId)
  const [addPending, startAdd]      = useTransition()

  function guardarNuevoAsesor() {
    const nombre = addNombre.trim()
    const email  = addEmail.trim()
    if (!nombre) { toastError('El nombre es obligatorio.'); return }
    if (!EMAIL_RE.test(email)) { toastError('El correo no parece válido.'); return }
    startAdd(async () => {
      const r = await guardarAsesor({ nombre, email, empresa_id: addEmpresa || null })
      if (!r.ok || !r.asesor) { toastError(r.error ?? 'No se pudo guardar.'); return }
      setLista(prev => [...prev, r.asesor!])
      setAsesorId(r.asesor.asesor_id)
      setAddNombre(''); setAddEmail(''); setAddOpen(false)
      toastSuccess('Asesor guardado.')
    })
  }

  function enviar() {
    if (!asesorId) { toastError('Elige un asesor.'); return }
    if (!incluirPDF && !incluirCSV) { toastError('Elige al menos un archivo.'); return }
    startTransition(async () => {
      let pdfBase64: string | undefined
      if (incluirPDF) {
        try { pdfBase64 = await construirPdfBase64(incluirConsolidado) }
        catch { toastError('No se pudo generar el PDF.'); return }
      }
      const r = await enviarReportesAsesor({
        asesor_id: asesorId, desde, hasta, empresa_id: empresaId,
        incluirConsolidado, incluirPDF, incluirCSV,
        nota: nota.trim() || undefined,
        pdfBase64, pdfNombre: `${nombreArchivo}.pdf`, csvNombre: `${nombreArchivo}.csv`,
      })
      if (!r.ok) { toastError(r.error ?? 'No se pudo enviar.'); return }
      toastSuccess(`Enviado a ${r.email}`)
      onEnviado()
    })
  }

  const adjuntos = [incluirPDF && 'PDF', incluirCSV && 'CSV (Excel)'].filter(Boolean).join(' · ') || 'ninguno'

  return (
    <div className="modal-backdrop open">
      <div className="modal modal-520" role="dialog" aria-modal>
        <div className="modal-header">
          <h2 className="modal-title">Enviar al asesor</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>

        <div className="modal-body">
          {/* Destinatario */}
          <div className="input-group">
            <label htmlFor="env-asesor">Asesor</label>
            {lista.length > 0 && (
              <select id="env-asesor" className="input" value={asesorId} onChange={e => setAsesorId(e.target.value)}>
                {lista.map(a => (
                  <option key={a.asesor_id} value={a.asesor_id}>
                    {a.nombre} · {a.email}{a.empresa_id ? '' : ' · todas'}
                  </option>
                ))}
              </select>
            )}
            {!addOpen && (
              <button type="button" className="btn btn-ghost btn-sm env-asesor-add-btn" onClick={() => setAddOpen(true)}>
                <Plus size={14} strokeWidth={2.5} /> Añadir asesor
              </button>
            )}
          </div>

          {/* Alta rápida */}
          {addOpen && (
            <div className="env-asesor-add">
              <div className="input-group">
                <label htmlFor="env-add-nombre">Nombre del asesor</label>
                <input id="env-add-nombre" className="input" value={addNombre}
                  onChange={e => setAddNombre(e.target.value)} maxLength={120} placeholder="Gestoría López" />
              </div>
              <div className="input-group">
                <label htmlFor="env-add-email">Correo</label>
                <input id="env-add-email" className="input" type="email" value={addEmail}
                  onChange={e => setAddEmail(e.target.value)} maxLength={160} placeholder="asesor@correo.com"
                  spellCheck={false} autoComplete="off" />
              </div>
              <div className="input-group">
                <label htmlFor="env-add-empresa">Para</label>
                <select id="env-add-empresa" className="input" value={addEmpresa} onChange={e => setAddEmpresa(e.target.value)}>
                  <option value="">Todas las empresas</option>
                  {empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
                </select>
              </div>
              <div className="env-asesor-add-acciones">
                {lista.length > 0 && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAddOpen(false)} disabled={addPending}>Cancelar</button>
                )}
                <button type="button" className="btn btn-primary btn-sm" onClick={guardarNuevoAsesor} disabled={addPending}>
                  {addPending ? <><span className="spinner spinner-sm" /> Guardando…</> : 'Guardar asesor'}
                </button>
              </div>
            </div>
          )}

          {/* Qué se envía */}
          <div className="input-group">
            <span className="modal-section-label">Qué enviar</span>
            <label className="env-asesor-check">
              <input type="checkbox" checked={incluirPDF} onChange={e => setIncluirPDF(e.target.checked)} />
              <span>PDF con marca <em className="env-asesor-check-hint">— para leer</em></span>
            </label>
            <label className="env-asesor-check">
              <input type="checkbox" checked={incluirCSV} onChange={e => setIncluirCSV(e.target.checked)} />
              <span>CSV para Excel <em className="env-asesor-check-hint">— columnas para trabajar los números</em></span>
            </label>
            {hayConsolidado && (
              <label className="env-asesor-check">
                <input type="checkbox" checked={incluirConsolidado} onChange={e => setIncluirConsolidado(e.target.checked)} />
                <span>Incluir consolidado <em className="env-asesor-check-hint">en {data.consolidado!.moneda}</em></span>
              </label>
            )}
          </div>

          {/* Nota opcional */}
          <div className="input-group">
            <label htmlFor="env-nota">Nota para el asesor <span className="env-asesor-opt">(opcional)</span></label>
            <textarea id="env-nota" className="input env-asesor-nota" value={nota}
              onChange={e => setNota(e.target.value)} maxLength={800} rows={2}
              placeholder="Aquí van los números de este mes, cualquier duda me dices." />
          </div>

          {/* Resumen: lo que se envía */}
          <div className="env-asesor-resumen">
            <div className="env-asesor-resumen-head">Lo que vas a enviar</div>
            <div className="rep-line"><span>Alcance</span><span>{empresaNombre}</span></div>
            <div className="rep-line"><span>Período</span><span>{desde} — {hasta}</span></div>
            {data.resultado.map(r => (
              <div key={`r-${r.moneda}`} className="rep-line"><span>Resultado neto ({r.moneda})</span><strong>{fmt(r.neto)}</strong></div>
            ))}
            {data.flujo.map(f => (
              <div key={`f-${f.moneda}`} className="rep-line"><span>Flujo neto ({f.moneda})</span><strong>{fmt(f.neto)}</strong></div>
            ))}
            {incluirConsolidado && data.consolidado?.resultado && (
              <div className="rep-line"><span>Neto consolidado ({data.consolidado.moneda})</span><strong>{fmt(data.consolidado.resultado.neto)}</strong></div>
            )}
            <div className="rep-line"><span>Adjuntos</span><span>{adjuntos}</span></div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={enviar} disabled={isPending || !asesorId || (!incluirPDF && !incluirCSV)}>
            {isPending ? <><span className="spinner spinner-sm" /> Enviando…</> : <><Send size={14} strokeWidth={2.5} /> Enviar</>}
          </button>
        </div>
      </div>
    </div>
  )
}
