'use client'

import { useState, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useToast } from '@/app/contexts/ToastContext'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'
import {
  actualizarEstadoMensaje, guardarFaq, eliminarFaq,
  type MensajeSoporte, type FaqAdmin,
} from '@/app/actions/soporte'
import { Mail, Plus, Pencil, Trash2, X } from 'lucide-react'
import { RowActions } from '@/components/portal/RowActions'

type Estado = 'NUEVO' | 'LEIDO' | 'RESUELTO'

const ESTADO_BADGE: Record<Estado, string> = {
  NUEVO: 'badge-warning', LEIDO: 'badge-neutral', RESUELTO: 'badge-success',
}
const ESTADO_LABEL: Record<Estado, string> = {
  NUEVO: 'Nuevo', LEIDO: 'Leído', RESUELTO: 'Resuelto',
}

type Props = {
  mensajes: MensajeSoporte[]
  faqs:     FaqAdmin[]
  catalogo: { clave: string; nombre: string }[]
}

function fmtFecha(s: string): string {
  return new Date(s).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function SoporteAdminView({ mensajes, faqs, catalogo }: Props) {
  const router = useRouter()
  const { success: toastOk, error: toastErr } = useToast()
  const mounted = useMounted()
  const [tab, setTab] = useState<'mensajes' | 'faq'>('mensajes')

  const modLabel = useMemo(() => {
    const m = new Map<string, string>([['general', 'General']])
    for (const c of catalogo) m.set(c.clave, c.nombre)
    return m
  }, [catalogo])

  // ── Mensajes ──
  const [filtro, setFiltro] = useState<'TODOS' | Estado>('TODOS')
  const [verMsg, setVerMsg] = useState<MensajeSoporte | null>(null)
  const nuevos = mensajes.filter(m => m.estado === 'NUEVO').length
  const msgFiltrados = filtro === 'TODOS' ? mensajes : mensajes.filter(m => m.estado === filtro)

  async function cambiarEstado(id: number, estado: Estado) {
    const res = await actualizarEstadoMensaje(id, estado)
    if (!res.ok) { toastErr('No se pudo actualizar el estado.'); return }
    setVerMsg(v => (v && v.id === id ? { ...v, estado } : v))
    router.refresh()
  }

  function abrirMsg(m: MensajeSoporte) {
    setVerMsg(m)
    if (m.estado === 'NUEVO') cambiarEstado(m.id, 'LEIDO')
  }

  // ── FAQ ──
  const [faqModal,   setFaqModal]   = useState<FaqAdmin | 'nuevo' | null>(null)
  const [saving,     setSaving]     = useState(false)
  const [confirmDel, setConfirmDel] = useState<FaqAdmin | null>(null)

  const cerrarModales = useCallback(() => { setVerMsg(null); setFaqModal(null); setConfirmDel(null) }, [])
  useModalKeyboard(!!verMsg || !!faqModal || !!confirmDel, cerrarModales)

  async function handleGuardarFaq(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    const res = await guardarFaq(new FormData(e.currentTarget))
    setSaving(false)
    if (!res.ok) { toastErr(res.error ?? 'Error al guardar.'); return }
    toastOk('Pregunta guardada')
    setFaqModal(null)
    router.refresh()
  }

  async function handleEliminarFaq() {
    if (!confirmDel) return
    const res = await eliminarFaq(confirmDel.id)
    if (!res.ok) { toastErr('No se pudo eliminar.'); return }
    toastOk('Pregunta eliminada')
    setConfirmDel(null)
    router.refresh()
  }

  const faqEdit = faqModal === 'nuevo' ? null : faqModal

  // ── Modales ──
  const modalMensaje = verMsg && (
    <div className="modal-backdrop">
      <div className="modal modal-540">
        <div className="modal-header">
          <h2 className="modal-title">Mensaje de {verMsg.nombre_empresa}</h2>
          <button onClick={() => setVerMsg(null)} className="modal-close" aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="detail-info-grid">
            <div className="detail-field">
              <span className="detail-field-label">Cliente</span>
              <span className="detail-field-value">{verMsg.nombre_empresa} · {verMsg.client_id}</span>
            </div>
            <div className="detail-field">
              <span className="detail-field-label">Remitente</span>
              <span className="detail-field-value">{verMsg.email ?? '—'}</span>
            </div>
            <div className="detail-field">
              <span className="detail-field-label">Fecha</span>
              <span className="detail-field-value">{fmtFecha(verMsg.created_at)}</span>
            </div>
            <div className="detail-field">
              <span className="detail-field-label">Estado</span>
              <span className="detail-field-value">
                <span className={`badge ${ESTADO_BADGE[verMsg.estado]}`}>{ESTADO_LABEL[verMsg.estado]}</span>
              </span>
            </div>
          </div>
          <div className="input-group mt-2">
            <label>Asunto</label>
            <div className="input input-display">{verMsg.asunto}</div>
          </div>
          <div className="input-group">
            <label>Mensaje</label>
            <p className="soporte-mensaje-texto">{verMsg.mensaje}</p>
          </div>
        </div>
        <div className="modal-footer">
          {verMsg.estado !== 'RESUELTO'
            ? <button className="btn btn-primary" onClick={() => cambiarEstado(verMsg.id, 'RESUELTO')}>Marcar como resuelto</button>
            : <button className="btn btn-secondary" onClick={() => cambiarEstado(verMsg.id, 'LEIDO')}>Reabrir</button>}
          <button className="btn btn-secondary" onClick={() => setVerMsg(null)}>Cerrar</button>
        </div>
      </div>
    </div>
  )

  const modalFaq = faqModal && (
    <div className="modal-backdrop">
      <div className="modal modal-540">
        <div className="modal-header">
          <h2 className="modal-title">{faqEdit ? 'Editar pregunta' : 'Nueva pregunta'}</h2>
          <button onClick={() => setFaqModal(null)} className="modal-close" aria-label="Cerrar"><X size={18} /></button>
        </div>
        <form onSubmit={handleGuardarFaq}>
          <div className="modal-body">
            {faqEdit && <input type="hidden" name="id" value={faqEdit.id} />}
            <div className="grid-cols-2">
              <div className="input-group">
                <label>Módulo</label>
                <select name="modulo_clave" className="input" defaultValue={faqEdit?.modulo_clave ?? 'general'}>
                  <option value="general">General</option>
                  {catalogo.map(c => <option key={c.clave} value={c.clave}>{c.nombre}</option>)}
                </select>
                <span className="input-hint">El cliente solo verá esta pregunta si tiene el módulo contratado.</span>
              </div>
              <div className="input-group">
                <label>Orden</label>
                <input name="orden" type="number" className="input" defaultValue={faqEdit?.orden ?? 0} />
              </div>
            </div>
            <div className="input-group">
              <label>Pregunta <span className="required">*</span></label>
              <input name="pregunta" className="input" required defaultValue={faqEdit?.pregunta ?? ''} placeholder="¿Cómo…?" />
            </div>
            <div className="input-group">
              <label>Respuesta <span className="required">*</span></label>
              <textarea name="respuesta" className="input" rows={5} required defaultValue={faqEdit?.respuesta ?? ''} />
            </div>
            <label className="checkbox-group">
              <input type="checkbox" name="activo" value="true" defaultChecked={faqEdit ? faqEdit.activo : true} />
              <span className="checkbox-label">Visible para los clientes</span>
            </label>
            <input type="hidden" name="activo" value="false" />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={() => setFaqModal(null)}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><span className="spinner spinner-sm" /> Guardando…</> : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  const modalDel = confirmDel && (
    <div className="modal-backdrop">
      <div className="modal modal-420">
        <div className="modal-header">
          <h2 className="modal-title">Eliminar pregunta</h2>
          <button onClick={() => setConfirmDel(null)} className="modal-close" aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="text-sm-muted">¿Eliminar «{confirmDel.pregunta}»? Esta acción no se puede deshacer.</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={() => setConfirmDel(null)}>Cancelar</button>
          <button className="btn btn-danger" onClick={handleEliminarFaq}>Eliminar</button>
        </div>
      </div>
    </div>
  )

  const activeModal = modalMensaje || modalFaq || modalDel

  return (
    <>
      {/* Tabs */}
      <div className="usr-tabs">
        <button className={`usr-tab${tab === 'mensajes' ? ' active' : ''}`} onClick={() => setTab('mensajes')}>
          Mensajes {nuevos > 0 && <span className="badge badge-warning">{nuevos}</span>}
        </button>
        <button className={`usr-tab${tab === 'faq' ? ' active' : ''}`} onClick={() => setTab('faq')}>
          Preguntas frecuentes ({faqs.length})
        </button>
      </div>

      {/* ── Tab Mensajes ── */}
      {tab === 'mensajes' && (
        <>
          <div className="soporte-filtros">
            {(['TODOS', 'NUEVO', 'LEIDO', 'RESUELTO'] as const).map(f => (
              <button
                key={f}
                className={`btn btn-sm ${filtro === f ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFiltro(f)}
              >
                {f === 'TODOS' ? 'Todos' : ESTADO_LABEL[f]}
              </button>
            ))}
          </div>

          <div className="card card-table">
            {msgFiltrados.length === 0 ? (
              <div className="table-empty table-empty-sm">
                <Mail size={36} strokeWidth={1.5} />
                <p>No hay mensajes {filtro !== 'TODOS' ? 'con este estado' : 'todavía'}.</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Asunto</th>
                      <th>Estado</th>
                      <th>Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {msgFiltrados.map(m => (
                      <tr key={m.id} className="table-row-clickable" onClick={() => abrirMsg(m)}>
                        <td data-label="Cliente">
                          <div className="text-sm-bold">{m.nombre_empresa}</div>
                          <div className="text-xs-muted">{m.email ?? m.client_id}</div>
                        </td>
                        <td data-label="Asunto" className="cell-truncate">{m.asunto}</td>
                        <td data-label="Estado"><span className={`badge ${ESTADO_BADGE[m.estado]}`}>{ESTADO_LABEL[m.estado]}</span></td>
                        <td data-label="Fecha" className="table-muted">{fmtFecha(m.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Tab FAQ ── */}
      {tab === 'faq' && (
        <>
          <div className="soporte-filtros soporte-filtros-end">
            <button className="btn btn-primary btn-sm" onClick={() => setFaqModal('nuevo')}>
              <Plus size={14} /> Nueva pregunta
            </button>
          </div>

          <div className="card card-table">
            {faqs.length === 0 ? (
              <div className="table-empty table-empty-sm">
                <p>Aún no hay preguntas. Crea la primera.</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Módulo</th>
                      <th>Pregunta</th>
                      <th>Estado</th>
                      <th className="col-actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {faqs.map(f => (
                      <tr key={f.id} className={f.activo ? '' : 'row-inactive'}>
                        <td data-label="Módulo"><span className="badge badge-neutral">{modLabel.get(f.modulo_clave) ?? f.modulo_clave}</span></td>
                        <td data-label="Pregunta" className="cell-truncate">{f.pregunta}</td>
                        <td data-label="Estado">
                          <span className={`badge ${f.activo ? 'badge-success' : 'badge-neutral'}`}>
                            {f.activo ? 'Visible' : 'Oculta'}
                          </span>
                        </td>
                        <td className="col-actions">
                          <RowActions>
                            <button className="row-actions-item" onClick={() => setFaqModal(f)}>
                              <Pencil size={15} strokeWidth={2} /> Editar
                            </button>
                            <button className="row-actions-item row-actions-item-danger" onClick={() => setConfirmDel(f)}>
                              <Trash2 size={14} strokeWidth={2} /> Eliminar
                            </button>
                          </RowActions>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {mounted && activeModal && createPortal(activeModal, document.body)}
    </>
  )
}
