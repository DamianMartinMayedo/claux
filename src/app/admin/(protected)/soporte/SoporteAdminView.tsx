'use client'

import { useState, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useToast } from '@/app/contexts/ToastContext'
import {
  actualizarEstadoMensaje, guardarFaq, eliminarFaq, responderMensajeSoporte, borradorRespuestaIa,
  type MensajeSoporte, type FaqAdmin,
} from '@/app/actions/soporte'
import { Eye, Mail, Plus, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { RowActions } from '@/components/portal/RowActions'
import ModalShell from '@/components/portal/ModalShell'
import { ConfirmDialog } from '@/components/portal/Dialog'
import FormHelp from '@/components/portal/FormHelp'
import Tabs from '@/components/Tabs'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { useOrden, ThOrden, type ColumnasOrden } from '@/components/TableSort'
import ExportarMenu from '@/components/portal/ExportarMenu'
import Filtros from '@/components/portal/Filtros'
import { filtroExport, resumenDe, type Filtro } from '@/lib/filtros'
import type { FiltroAdmin } from '@/lib/exportar/tablas-admin'

type Estado = 'NUEVO' | 'LEIDO' | 'RESUELTO'

const ESTADO_BADGE: Record<Estado, string> = {
  NUEVO: 'badge-warning', LEIDO: 'badge-neutral', RESUELTO: 'badge-success',
}
const ESTADO_LABEL: Record<Estado, string> = {
  NUEVO: 'Nuevo', LEIDO: 'Leído', RESUELTO: 'Resuelto',
}
/**
 * Lo que queda por atender, primero. Es el orden por defecto de la tabla y también
 * el que aplica la columna «Estado» al pulsarla: ordenar los estados por su nombre
 * pondría «Leído» antes que «Nuevo», que no es el orden en que se trabajan.
 */
const ESTADO_PRIORIDAD: Record<Estado, number> = { NUEVO: 0, LEIDO: 1, RESUELTO: 2 }

const OPCIONES_ESTADO = (['NUEVO', 'LEIDO', 'RESUELTO'] as const)
  .map(e => ({ valor: e, label: ESTADO_LABEL[e] }))

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

const COLUMNAS_MSG: ColumnasOrden<MensajeSoporte> = {
  cliente: { label: 'Cliente', valor: m => m.nombre_empresa },
  asunto:  { label: 'Asunto',  valor: m => m.asunto },
  estado:  { label: 'Estado',  valor: m => ESTADO_PRIORIDAD[m.estado] },
  fecha:   { label: 'Fecha',   valor: m => m.created_at },
}

export default function SoporteAdminView({ mensajes, faqs, catalogo }: Props) {
  const router = useRouter()
  const { success: toastOk, error: toastErr } = useToast()
  const [tab, setTab] = useState<'mensajes' | 'faq'>('mensajes')

  const modLabel = useMemo(() => {
    const m = new Map<string, string>([['general', 'General']])
    for (const c of catalogo) m.set(c.clave, c.nombre)
    return m
  }, [catalogo])

  // ── Mensajes ──
  /**
   * El estado y la búsqueda viven en la URL. Abrir un mensaje, responderlo y volver dejaba
   * la bandeja EN «todos»: había que volver a marcar «Nuevo» cada vez, que en una bandeja
   * es la única forma de trabajarla.
   */
  const params   = useSearchParams()
  const filtro   = params.get('estado') ?? ''
  const busqueda = params.get('q') ?? ''

  const [verMsg, setVerMsg] = useState<MensajeSoporte | null>(null)
  const [respuestaTexto, setRespuestaTexto] = useState('')
  const [respondiendo, setRespondiendo]     = useState(false)
  const [iaPensando, setIaPensando]         = useState(false)
  const nuevos = mensajes.filter(m => m.estado === 'NUEVO').length

  /**
   * LA DECLARACIÓN. `cliente`: la bandeja se trae entera, sin techo, así que filtrar en el
   * navegador da el mismo resultado que la consulta.
   */
  const declaracion: Filtro[] = useMemo(() => [
    {
      clave: 'estado', label: 'Todos', rotulo: 'Estado',
      valor: filtro, widget: 'pastillas', donde: 'cliente',
      opciones: OPCIONES_ESTADO,
    },
  ], [filtro])

  /**
   * Buscar en la bandeja. No había ninguna forma: con la lista paginada, encontrar lo que
   * escribió un cliente concreto era pasar páginas. Busca por lo mismo que se lee en la
   * tabla —empresa y asunto— más el cuerpo y el correo, que es donde está el detalle; la
   * descarga busca en los mismos cuatro campos.
   */
  const msgFiltrados = useMemo(() => {
    const t = busqueda.trim().toLowerCase()
    return mensajes.filter(m => {
      if (filtro && m.estado !== filtro) return false
      if (!t) return true
      return m.nombre_empresa.toLowerCase().includes(t)
          || m.asunto.toLowerCase().includes(t)
          || m.mensaje.toLowerCase().includes(t)
          || (m.email ?? '').toLowerCase().includes(t)
    })
  }, [mensajes, filtro, busqueda])

  // Lo pendiente arriba y, dentro de cada estado, lo más reciente primero: el
  // `sort` es estable y las filas llegan del servidor por fecha descendente.
  const ordenMsg = useOrden(msgFiltrados, COLUMNAS_MSG, { clave: 'estado', dir: 'asc' })
  const { pageItems: msgItems, ...msgPag } = usePagination(ordenMsg.filas)

  // ── FAQ ──
  const [faqModal,   setFaqModal]   = useState<FaqAdmin | 'nuevo' | null>(null)
  const [saving,     setSaving]     = useState(false)
  const [confirmDel, setConfirmDel] = useState<FaqAdmin | null>(null)
  const [borrando,   setBorrando]   = useState(false)

  // El módulo se ordena por su NOMBRE, que es lo que se ve, y no por la clave.
  const columnasFaq: ColumnasOrden<FaqAdmin> = useMemo(() => ({
    modulo:   { label: 'Módulo',   valor: f => modLabel.get(f.modulo_clave) ?? f.modulo_clave },
    pregunta: { label: 'Pregunta', valor: f => f.pregunta },
    estado:   { label: 'Estado',   valor: f => (f.activo ? 0 : 1) },
  }), [modLabel])

  // Sin orden inicial: el de origen es el `orden` que fija el admin en cada ficha,
  // que es el que ven los clientes. Reordenar aquí es para mirar, no para cambiarlo.
  const ordenFaq = useOrden(faqs, columnasFaq)
  const { pageItems: faqItems, ...faqPag } = usePagination(ordenFaq.filas)

  async function cambiarEstado(id: number, estado: Estado) {
    const res = await actualizarEstadoMensaje(id, estado)
    if (!res.ok) { toastErr('No se pudo actualizar el estado.'); return }
    setVerMsg(v => (v && v.id === id ? { ...v, estado } : v))
    router.refresh()
  }

  function abrirMsg(m: MensajeSoporte) {
    setVerMsg(m)
    setRespuestaTexto('')
    if (m.estado === 'NUEVO') cambiarEstado(m.id, 'LEIDO')
  }

  async function handleResponder() {
    if (!verMsg || !respuestaTexto.trim()) return
    setRespondiendo(true)
    const res = await responderMensajeSoporte(verMsg.id, respuestaTexto)
    setRespondiendo(false)
    if (!res.ok) { toastErr(res.error ?? 'No se pudo enviar la respuesta.'); return }
    toastOk('Respuesta enviada')
    setVerMsg(v => (v ? { ...v, estado: 'RESUELTO', respuesta: respuestaTexto.trim() } : v))
    setRespuestaTexto('')
    router.refresh()
  }

  /**
   * Pide a la IA interna un borrador y lo deja en el cuadro de texto. Nada más:
   * no guarda, no marca resuelto y no envía. Solo entra cuando el cuadro está
   * vacío —el botón se deshabilita si ya hay texto— para no pisar lo escrito.
   */
  async function handleBorradorIa() {
    if (!verMsg) return
    setIaPensando(true)
    const res = await borradorRespuestaIa(verMsg.id)
    setIaPensando(false)
    if (!res.ok || !res.texto) { toastErr(res.error ?? 'No se pudo redactar el borrador.'); return }
    setRespuestaTexto(res.texto)
    toastOk('Borrador listo. Revísalo antes de enviarlo.')
  }

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
    setBorrando(true)
    const res = await eliminarFaq(confirmDel.id)
    setBorrando(false)
    if (!res.ok) { toastErr('No se pudo eliminar.'); return }
    toastOk('Pregunta eliminada')
    setConfirmDel(null)
    router.refresh()
  }

  const faqEdit = faqModal === 'nuevo' ? null : faqModal

  return (
    <>
      {/* Tabs */}
      <Tabs
        ariaLabel="Secciones de soporte"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'mensajes', label: 'Mensajes', count: nuevos > 0 ? nuevos : undefined, countTone: 'warning' },
          { id: 'faq', label: 'Preguntas frecuentes', count: faqs.length },
        ]}
      />

      {/* ── Tab Mensajes ── */}
      {tab === 'mensajes' && (
        <>
          {/* La barra del sistema, no cuatro botones haciéndose pasar por filtro:
              `.soporte-filtros` era una barra de filtros con otro nombre. */}
          <Filtros
            filtros={declaracion}
            q={busqueda}
            placeholder="Buscar por empresa, asunto o texto…"
            acciones={
              <ExportarMenu
                ambito="admin"
                clave="soporte"
                filtro={filtroExport<FiltroAdmin>(declaracion, { q: busqueda })}
                resumen={resumenDe(declaracion)}
                pequeno
                sinPeriodo
              />
            }
          />

          <div className="card card-table">
            {msgFiltrados.length === 0 ? (
              <div className="table-empty table-empty-sm">
                <Mail size={36} strokeWidth={1.5} />
                <p>{filtro || busqueda ? 'No hay mensajes con los filtros aplicados.' : 'No hay mensajes todavía.'}</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <ThOrden orden={ordenMsg} clave="cliente">Cliente</ThOrden>
                      <ThOrden orden={ordenMsg} clave="asunto">Asunto</ThOrden>
                      <ThOrden orden={ordenMsg} clave="estado">Estado</ThOrden>
                      <ThOrden orden={ordenMsg} clave="fecha">Fecha</ThOrden>
                      <th className="col-actions"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {msgItems.map(m => (
                      <tr key={m.id} className="table-row-clickable" onClick={() => abrirMsg(m)}>
                        <td data-label="Cliente">
                          <div className="text-sm-bold cell-clamp">{m.nombre_empresa}</div>
                          <div className="text-xs-muted">{m.email ?? m.client_id}</div>
                        </td>
                        {/* La contratación se ve de un golpe: es venta, no una
                            incidencia, y no puede quedar sepultada entre dudas. */}
                        <td data-label="Asunto">
                          <div className="sop-asunto">
                            {m.modulo_clave && <span className="badge badge-success">Contratación</span>}
                            <span className="sop-asunto-texto">{m.asunto}</span>
                          </div>
                        </td>
                        <td data-label="Estado"><span className={`badge ${ESTADO_BADGE[m.estado]}`}>{ESTADO_LABEL[m.estado]}</span></td>
                        <td data-label="Fecha" className="table-muted">{fmtFecha(m.created_at)}</td>
                        {/* La fila abre el mensaje, así que el clic del menú se para
                            aquí: si no, «Acciones» lo abría además por debajo. */}
                        <td className="col-actions" onClick={e => e.stopPropagation()}>
                          <RowActions>
                            <button className="row-actions-item" onClick={() => abrirMsg(m)}><Eye size={15} strokeWidth={2} /> Ver detalles</button>
                          </RowActions>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <TablePagination {...msgPag} label="mensaje" />
          </div>
        </>
      )}

      {/* ── Tab FAQ ── */}
      {tab === 'faq' && (
        <>
          <div className="filters-bar filters-bar-end">
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
                      <ThOrden orden={ordenFaq} clave="modulo">Módulo</ThOrden>
                      <ThOrden orden={ordenFaq} clave="pregunta">Pregunta</ThOrden>
                      <ThOrden orden={ordenFaq} clave="estado">Estado</ThOrden>
                      <th className="col-actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {faqItems.map(f => (
                      <tr key={f.id} className={f.activo ? '' : 'row-inactive'}>
                        <td data-label="Módulo"><span className="badge badge-neutral">{modLabel.get(f.modulo_clave) ?? f.modulo_clave}</span></td>
                        <td data-label="Pregunta" className="cell-truncate" title={f.pregunta}>{f.pregunta}</td>
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
            <TablePagination {...faqPag} label="pregunta" />
          </div>
        </>
      )}

      {verMsg && (
        <ModalShell
          size="modal-540"
          title={`Mensaje de ${verMsg.nombre_empresa}`}
          subtitle={fmtFecha(verMsg.created_at)}
          onClose={() => setVerMsg(null)}
        >
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

            {verMsg.respuesta ? (
              <div className="input-group">
                <label>Tu respuesta{verMsg.respuesta_at ? ` · ${fmtFecha(verMsg.respuesta_at)}` : ''}</label>
                <p className="soporte-mensaje-texto soporte-respuesta-texto">{verMsg.respuesta}</p>
              </div>
            ) : verMsg.email && (
              <div className="input-group">
                <div className="input-group-head">
                  <label>Responder por email</label>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={iaPensando || !!respuestaTexto.trim()}
                    onClick={handleBorradorIa}
                  >
                    {iaPensando
                      ? <><span className="spinner spinner-sm" /> Redactando…</>
                      : <><Sparkles size={14} strokeWidth={2} /> Borrador con IA</>}
                  </button>
                </div>
                <textarea
                  className="input"
                  rows={4}
                  placeholder="Escribe tu respuesta…"
                  value={respuestaTexto}
                  onChange={e => setRespuestaTexto(e.target.value)}
                />
              </div>
            )}
          </div>
          <div className="modal-footer">
            {!verMsg.respuesta && verMsg.email && (
              <button
                className="btn btn-primary"
                disabled={respondiendo || !respuestaTexto.trim()}
                onClick={handleResponder}
              >
                {respondiendo ? <><span className="spinner spinner-sm" /> Enviando…</> : 'Enviar respuesta'}
              </button>
            )}
            {verMsg.estado !== 'RESUELTO'
              ? <button className="btn btn-secondary" onClick={() => cambiarEstado(verMsg.id, 'RESUELTO')}>Marcar como resuelto</button>
              : <button className="btn btn-secondary" onClick={() => cambiarEstado(verMsg.id, 'LEIDO')}>Reabrir</button>}
            <button className="btn btn-secondary" onClick={() => setVerMsg(null)}>Cerrar</button>
          </div>
        </ModalShell>
      )}

      {faqModal && (
        <ModalShell
          size="modal-540"
          title={faqEdit ? 'Editar pregunta' : 'Nueva pregunta'}
          onClose={() => setFaqModal(null)}
        >
          <form onSubmit={handleGuardarFaq}>
            <div className="modal-body">
              {faqEdit && <input type="hidden" name="id" value={faqEdit.id} />}
              <div className="grid-cols-2">
                <div className="input-group">
                  <div className="form-label-with-help">
                    <label>Módulo</label>
                    <FormHelp text="El cliente solo verá esta pregunta si tiene el módulo contratado." label="Quién ve la pregunta" />
                  </div>
                  <select name="modulo_clave" className="input" defaultValue={faqEdit?.modulo_clave ?? 'general'}>
                    <option value="general">General</option>
                    {catalogo.map(c => <option key={c.clave} value={c.clave}>{c.nombre}</option>)}
                  </select>
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
        </ModalShell>
      )}

      {confirmDel && (
        <ConfirmDialog
          title="Eliminar pregunta"
          body={<>¿Eliminar «{confirmDel.pregunta}»? No se puede deshacer.</>}
          confirmLabel="Eliminar"
          danger
          pending={borrando}
          pendingLabel="Eliminando…"
          onConfirm={handleEliminarFaq}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </>
  )
}
