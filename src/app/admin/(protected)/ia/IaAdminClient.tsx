'use client'

import { useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Trash2, Activity, Loader2, X } from 'lucide-react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { ConfirmDialog } from '@/components/portal/Dialog'
import { RowActions } from '@/components/portal/RowActions'
import FormHelp from '@/components/portal/FormHelp'
import { guardarConfigIaGlobal, toggleModeloIa, eliminarModeloIa } from '@/app/actions/ia-admin'
import { PRUEBA_LENTA_MS, type EstadoPrueba, type PruebaModeloUI, type PruebaModeloResp } from '@/lib/ia/prueba-tipos'
import NuevoModeloIaModal from './NuevoModeloIaModal'
import EditarModeloIaModal from './EditarModeloIaModal'
import { usePagination, TablePagination } from '@/components/TablePagination'
import DocumentoIaModal from './DocumentoIaModal'

export interface ModeloIa {
  id: string; nombre: string; gratis: boolean; activo: boolean
  api_base: string | null; api_key_env: string | null; key_hint: string | null; orden: number
}
export interface ConsumoCliente {
  client_id: string; nombre: string; conversaciones: number; tokens: number
  cupo: number; cupoPropio: boolean; modeloActual: string
}
export interface DocumentoUi {
  key: string; label: string; descripcion: string; valor: string; esPersonalidad: boolean
}

interface Props {
  modelos: ModeloIa[]
  principal: string
  fallbackGratis: string
  cupoGlobal: number
  nombreAgente: string
  tono: string
  documentos: DocumentoUi[]
  periodo: string
  consumo: ConsumoCliente[]
}

// Resultado del health-check en la fila. «Lento» es su propio estado a propósito: un
// modelo que responde en 40 s sirve, pero no para producción — pintarlo verde miente
// y pintarlo rojo también.
const TONO_PRUEBA: Record<EstadoPrueba, string> = {
  vivo: 'badge-success', lento: 'badge-warning', mudo: 'badge-warning', caido: 'badge-error',
}

function rotuloPrueba(pr: PruebaModeloUI): string {
  if (pr.estado === 'vivo')  return `✓ ${pr.ms} ms`
  if (pr.estado === 'lento') return `Demasiado lento`
  if (pr.estado === 'mudo')  return 'Vivo, sin texto'
  return '✗ Caído'
}

function tituloPrueba(pr: PruebaModeloUI): string | undefined {
  if (pr.estado === 'lento') {
    return `No contestó en ${PRUEBA_LENTA_MS / 1000} s. Puede que acabe respondiendo, `
         + `pero el cliente no va a esperar: con este modelo de principal se tira del respaldo.`
  }
  if (pr.estado === 'mudo') return 'Respondió 200 pero sin texto'
  return pr.detalle
}

export default function IaAdminClient({ modelos, principal, fallbackGratis, cupoGlobal, nombreAgente, tono, documentos, periodo, consumo }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Config global
  const [nombre, setNombre] = useState(nombreAgente)
  const [ton, setTon]       = useState(tono)
  const [prin, setPrin]   = useState(principal)
  const [fb, setFb]       = useState(fallbackGratis)
  const [cupo, setCupo]   = useState(String(cupoGlobal))
  const [confirmarBorrado, setConfirmarBorrado] = useState<ModeloIa | null>(null)
  const [editando, setEditando] = useState<ModeloIa | null>(null)
  const [pruebas, setPruebas] = useState<Record<string, PruebaModeloUI | 'cargando'>>({})
  const [segundos, setSegundos] = useState<Record<string, number>>({})
  const abortarPrueba = useRef<Record<string, AbortController>>({})

  // Health-check de un modelo: llamada mínima real al proveedor.
  //
  // Va por `fetch` a un ROUTE HANDLER, no por server action. Next despacha las server
  // actions de una en una por cliente, así que probar un modelo lento dejaba en cola
  // el activar/desactivar y el guardar de esta misma pantalla: parecía que se colgaba
  // el admin entero. Por route handler sí se prueban varios a la vez de verdad.
  //
  // Un modelo recién salido puede tardar de forma legítima más de 20 s, así que no se
  // corta a la brava: se enseña el tiempo que lleva y se puede cancelar (regla UX de
  // no dejar nunca una pantalla congelada sin salida).
  async function probar(id: string) {
    const ctrl = new AbortController()
    abortarPrueba.current[id] = ctrl
    setPruebas(p => ({ ...p, [id]: 'cargando' }))
    setSegundos(s => ({ ...s, [id]: 0 }))
    const tic = setInterval(() => setSegundos(s => ({ ...s, [id]: (s[id] ?? 0) + 1 })), 1000)
    try {
      const res = await fetch(`/api/admin/ia/probar?id=${encodeURIComponent(id)}`, { signal: ctrl.signal })
      const r = await res.json() as PruebaModeloResp
      if (!r.ok) { toastError(r.error); olvidarPrueba(id); return }
      setPruebas(p => ({ ...p, [id]: r.prueba }))
    } catch (e) {
      // Cancelar es una decisión del usuario, no un error: la fila vuelve a su sitio.
      if ((e as Error).name !== 'AbortError') toastError('No se pudo probar el modelo.')
      olvidarPrueba(id)
    } finally {
      clearInterval(tic)
      delete abortarPrueba.current[id]
    }
  }

  function olvidarPrueba(id: string) {
    setPruebas(p => { const n = { ...p }; delete n[id]; return n })
    setSegundos(s => { const n = { ...s }; delete n[id]; return n })
  }

  function cancelarPrueba(id: string) { abortarPrueba.current[id]?.abort() }

  const activos = modelos.filter(m => m.activo)
  const activosGratis = activos.filter(m => m.gratis)
  const totalConv = consumo.reduce((s, c) => s + c.conversaciones, 0)
  const totalTok  = consumo.reduce((s, c) => s + c.tokens, 0)
  const { pageItems: consumoItems, ...consumoPag } = usePagination(consumo)

  function guardarGlobal(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const r = await guardarConfigIaGlobal({ nombre, tono: ton, principal: prin, fallbackGratis: fb, cupo: parseInt(cupo, 10) || 0 })
      if (!r.ok) { toastError(r.error); return }
      toastSuccess('Configuración de IA guardada')
      router.refresh()
    })
  }

  function toggle(id: string, activo: boolean) {
    startTransition(async () => {
      const r = await toggleModeloIa(id, activo)
      if (!r.ok) { toastError(r.error); return }
      router.refresh()
    })
  }

  // Confirmación in-app (ConfirmDialog, patrón de la plataforma) antes de un
  // borrado que no se puede deshacer.
  function doEliminar(m: ModeloIa) {
    setConfirmarBorrado(null)
    startTransition(async () => {
      const r = await eliminarModeloIa(m.id)
      if (!r.ok) { toastError(r.error); return }
      toastSuccess('Modelo eliminado')
      router.refresh()
    })
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Asistente IA</h1>
          <p className="page-subtitle">Controla los modelos que usan los clientes, los límites y el consumo.</p>
        </div>
      </div>

      {/* ── Configuración global ── */}
      <div className="card mb-5">
        <div className="card-header">
          <h2 className="card-title">Configuración global</h2>
        </div>
        <form onSubmit={guardarGlobal} className="config-form">
          <div className="grid-cols-2">
            <div className="input-group">
              <div className="form-label-with-help">
                <label htmlFor="ia-nombre">Nombre del agente</label>
                <FormHelp text="Lo ven todos los clientes. El cliente no puede cambiarlo." label="Quién ve el nombre del agente" />
              </div>
              <input id="ia-nombre" className="input" value={nombre} onChange={e => setNombre(e.target.value)}
                     placeholder="Claux" maxLength={40} />
            </div>
            <div className="input-group">
              <div className="form-label-with-help">
                <label htmlFor="ia-tono">Tono</label>
                <FormHelp text="Cómo se comunica el agente en las respuestas." label="Qué es el tono" />
              </div>
              <input id="ia-tono" className="input" value={ton} onChange={e => setTon(e.target.value)}
                     placeholder="cercano y directo, como un asesor de confianza" maxLength={80} />
            </div>
          </div>
          <div className="grid-cols-2">
            <div className="input-group">
              <div className="form-label-with-help">
                <label htmlFor="ia-prin">Modelo principal</label>
                <FormHelp text="El que usan los clientes por defecto." label="Qué es el modelo principal" />
              </div>
              <select id="ia-prin" className="input" value={prin} onChange={e => setPrin(e.target.value)}>
                {activos.map(m => <option key={m.id} value={m.id}>{m.nombre}{m.gratis ? '' : ' · pago'}</option>)}
              </select>
            </div>
            <div className="input-group">
              <div className="form-label-with-help">
                <label htmlFor="ia-fb">Respaldo gratis (al superar el cupo)</label>
                <FormHelp text="Si el principal es de pago, los clientes que superen su cupo del mes pasan a este." label="Cuándo se usa el respaldo" />
              </div>
              <select id="ia-fb" className="input" value={fb} onChange={e => setFb(e.target.value)}>
                {activosGratis.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </div>
          </div>
          <div className="input-group">
            <div className="form-label-with-help">
              <label htmlFor="ia-cupo">Cupo de reserva (conversaciones/mes)</label>
              <FormHelp text="El cupo de cada cliente lo fija su nivel (Ajustes → Niveles), y se puede subir cliente a cliente en su ficha. Este número solo entra si un nivel se quedara sin cupo definido." label="Cuándo se usa este cupo" />
            </div>
            <input id="ia-cupo" type="number" min="1" step="1" className="input"
                   value={cupo} onChange={e => setCupo(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={isPending}>
            {isPending ? <><span className="spinner" /> Guardando...</> : 'Guardar configuración'}
          </button>
        </form>
      </div>

      {/* ── Documentos de Claux (personalidad + prompts por sección) ── */}
      <div className="card mb-5">
        <div className="card-header">
          <h2 className="card-title">Documentos de {nombre || 'Claux'}</h2>
          <span className="badge badge-neutral">{documentos.length}</span>
        </div>
        <p className="config-field-hint mb-4">Textos que gobiernan cómo responde el asistente: su personalidad general y qué analiza en cada sección. Se editan en su propia ventana.</p>
        <div className="ia-doc-list">
          {documentos.map(d => (
            <div key={d.key} className="ia-doc-row">
              <div className="ia-doc-info">
                <span className="ia-doc-label">{d.label}</span>
                <span className="ia-doc-desc">{d.descripcion}</span>
              </div>
              <DocumentoIaModal docKey={d.key} label={d.label} descripcion={d.descripcion}
                                valor={d.valor} esPersonalidad={d.esPersonalidad} />
            </div>
          ))}
        </div>
      </div>

      {/* ── Catálogo de modelos ── */}
      <div className="card mb-5">
        <div className="card-header">
          <h2 className="card-title">Modelos disponibles</h2>
          <div className="ia-cell-badges">
            <span className="badge badge-neutral">{activos.length} activos</span>
            <NuevoModeloIaModal />
          </div>
        </div>

        <div className="table-wrapper table-wrapper-flush">
          <table className="table">
            <thead>
              <tr><th>Modelo</th><th className="ia-col-id">ID</th><th>Tipo</th><th className="col-center">Activo</th><th>Estado</th><th className="col-actions" /></tr>
            </thead>
            <tbody>
              {modelos.map(m => { const pr = pruebas[m.id]; return (
                <tr key={m.id}>
                  <td data-label="Modelo"><span className="ia-cell-badges">{m.nombre}{m.id === principal && <span className="badge badge-info">principal</span>}</span></td>
                  <td data-label="ID" className="table-muted ia-col-id">{m.id}</td>
                  <td data-label="Tipo"><span className={`badge ${m.gratis ? 'badge-success' : 'badge-warning'}`}>{m.gratis ? 'Gratis' : 'Pago'}</span></td>
                  <td data-label="Activo" className="col-center">
                    <span className="switch">
                      <input type="checkbox" checked={m.activo} onChange={() => toggle(m.id, !m.activo)}
                             aria-label={`Activar ${m.nombre}`} disabled={isPending} />
                      <span className="switch-track" aria-hidden="true" />
                    </span>
                  </td>
                  <td data-label="Estado">
                    <span className="ia-cell-badges">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => probar(m.id)} disabled={pr === 'cargando'}>
                        {pr === 'cargando'
                          ? <Loader2 size={13} strokeWidth={2} className="img-upload-spin" />
                          : <Activity size={13} strokeWidth={2} />}
                        Probar
                      </button>
                      {pr === 'cargando' && (
                        <>
                          <span className="table-muted">
                            {(segundos[m.id] ?? 0) >= 15
                              ? `Tarda más de lo normal · ${segundos[m.id] ?? 0} s`
                              : `${segundos[m.id] ?? 0} s`}
                          </span>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => cancelarPrueba(m.id)}>
                            <X size={13} strokeWidth={2} />
                            Cancelar
                          </button>
                        </>
                      )}
                      {pr && pr !== 'cargando' && (
                        <span className={`badge ${TONO_PRUEBA[pr.estado]}`} title={tituloPrueba(pr)}>
                          {rotuloPrueba(pr)}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="col-actions">
                    <RowActions label={`Acciones de ${m.nombre}`}>
                      <button type="button" className="row-actions-item" onClick={() => setEditando(m)}>
                        <Pencil size={15} strokeWidth={2} /> Editar
                      </button>
                      {m.id !== principal && m.id !== fallbackGratis && (
                        <button type="button" className="row-actions-item row-actions-item-danger"
                                onClick={() => setConfirmarBorrado(m)} disabled={isPending}>
                          <Trash2 size={14} strokeWidth={2} /> Eliminar
                        </button>
                      )}
                    </RowActions>
                  </td>
                </tr>
              ) })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Consumo del mes ── */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Consumo del mes ({periodo})</h2>
          <span className="badge badge-neutral">{consumo.length} clientes con IA</span>
        </div>

        {consumo.length === 0 ? (
          <div className="table-empty table-empty-sm"><p>Ningún cliente con IA tiene consumo este mes.</p></div>
        ) : (
          <div className="table-wrapper table-wrapper-flush">
            <table className="table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th className="col-num">Conversaciones</th>
                  <th className="col-num">Tokens</th>
                  <th>Modelo en uso</th>
                </tr>
              </thead>
              <tbody>
                {consumoItems.map(c => {
                  const pct = c.cupo > 0 ? Math.round((c.conversaciones / c.cupo) * 100) : 0
                  return (
                    <tr key={c.client_id}>
                      <td data-label="Cliente"><span className="cell-clamp">{c.nombre}</span></td>
                      <td data-label="Conversaciones" className="col-num">
                        <span className="ia-cell-badges">
                          <span>{c.conversaciones.toLocaleString('es-ES')} / {c.cupo.toLocaleString('es-ES')}</span>
                          <span className={`badge ${pct >= 100 ? 'badge-error' : pct >= 90 ? 'badge-warning' : 'badge-neutral'}`}>{pct}%</span>
                          {c.cupoPropio && <span className="badge badge-info">cupo propio</span>}
                        </span>
                      </td>
                      <td data-label="Tokens" className="col-num">{c.tokens.toLocaleString('es-ES')}</td>
                      <td data-label="Modelo en uso" className="table-muted">{c.modeloActual}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="col-num">{totalConv.toLocaleString('es-ES')}</td>
                  <td className="col-num">{totalTok.toLocaleString('es-ES')}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <TablePagination {...consumoPag} label="cliente" />
      </div>

      {editando && (
        <EditarModeloIaModal modelo={editando} onClose={() => setEditando(null)} />
      )}

      {confirmarBorrado && (
        <ConfirmDialog
          title={`¿Eliminar "${confirmarBorrado.nombre}"?`}
          body="Dejará de estar disponible para los clientes. Esta acción no se puede deshacer."
          confirmLabel="Eliminar" danger
          onCancel={() => setConfirmarBorrado(null)}
          onConfirm={() => doEliminar(confirmarBorrado)}
        />
      )}
    </div>
  )
}
