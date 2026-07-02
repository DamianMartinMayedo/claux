'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { guardarConfigIaGlobal, toggleModeloIa, eliminarModeloIa } from '@/app/actions/ia-admin'
import NuevoModeloIaModal from './NuevoModeloIaModal'
import DocumentoIaModal from './DocumentoIaModal'

export interface ModeloIa {
  id: string; nombre: string; gratis: boolean; activo: boolean
  api_base: string | null; api_key_env: string | null; orden: number
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

export default function IaAdminClient({ modelos, principal, fallbackGratis, cupoGlobal, nombreAgente, tono, documentos, periodo, consumo }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Config global
  const [nombre, setNombre] = useState(nombreAgente)
  const [ton, setTon]       = useState(tono)
  const [prin, setPrin]   = useState(principal)
  const [fb, setFb]       = useState(fallbackGratis)
  const [cupo, setCupo]   = useState(String(cupoGlobal))

  const activos = modelos.filter(m => m.activo)
  const activosGratis = activos.filter(m => m.gratis)
  const totalConv = consumo.reduce((s, c) => s + c.conversaciones, 0)
  const totalTok  = consumo.reduce((s, c) => s + c.tokens, 0)

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

  function eliminar(id: string) {
    startTransition(async () => {
      const r = await eliminarModeloIa(id)
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
              <label htmlFor="ia-nombre">Nombre del agente</label>
              <input id="ia-nombre" className="input" value={nombre} onChange={e => setNombre(e.target.value)}
                     placeholder="Claux" maxLength={40} />
              <span className="input-hint">Lo ven todos los clientes. El cliente no puede cambiarlo.</span>
            </div>
            <div className="input-group">
              <label htmlFor="ia-tono">Tono</label>
              <input id="ia-tono" className="input" value={ton} onChange={e => setTon(e.target.value)}
                     placeholder="cercano y directo, como un asesor de confianza" maxLength={80} />
              <span className="input-hint">Cómo se comunica el agente en las respuestas.</span>
            </div>
          </div>
          <div className="grid-cols-2">
            <div className="input-group">
              <label htmlFor="ia-prin">Modelo principal</label>
              <select id="ia-prin" className="input" value={prin} onChange={e => setPrin(e.target.value)}>
                {activos.map(m => <option key={m.id} value={m.id}>{m.nombre}{m.gratis ? '' : ' · pago'}</option>)}
              </select>
              <span className="input-hint">El que usan los clientes por defecto.</span>
            </div>
            <div className="input-group">
              <label htmlFor="ia-fb">Respaldo gratis (al superar el cupo)</label>
              <select id="ia-fb" className="input" value={fb} onChange={e => setFb(e.target.value)}>
                {activosGratis.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
              <span className="input-hint">Si el principal es de pago, los clientes que superen su cupo del mes pasan a este.</span>
            </div>
          </div>
          <div className="input-group">
            <label htmlFor="ia-cupo">Cupo global (conversaciones/mes)</label>
            <input id="ia-cupo" type="number" min="1" step="1" className="input"
                   value={cupo} onChange={e => setCupo(e.target.value)} />
            <span className="input-hint">Límite por defecto para cada cliente. Se puede subir por cliente en su ficha.</span>
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
              <tr><th>Modelo</th><th>ID</th><th>Tipo</th><th className="col-center">Activo</th><th className="col-actions" /></tr>
            </thead>
            <tbody>
              {modelos.map(m => (
                <tr key={m.id}>
                  <td data-label="Modelo"><span className="ia-cell-badges">{m.nombre}{m.id === principal && <span className="badge badge-info">principal</span>}</span></td>
                  <td data-label="ID" className="table-muted">{m.id}</td>
                  <td data-label="Tipo"><span className={`badge ${m.gratis ? 'badge-success' : 'badge-warning'}`}>{m.gratis ? 'Gratis' : 'Pago'}</span></td>
                  <td data-label="Activo" className="col-center">
                    <span className="switch">
                      <input type="checkbox" checked={m.activo} onChange={() => toggle(m.id, !m.activo)}
                             aria-label={`Activar ${m.nombre}`} disabled={isPending} />
                      <span className="switch-track" aria-hidden="true" />
                    </span>
                  </td>
                  <td className="col-actions">
                    {m.id !== principal && m.id !== fallbackGratis && (
                      <button type="button" className="ia-icon-btn" onClick={() => eliminar(m.id)}
                              aria-label={`Eliminar ${m.nombre}`} disabled={isPending}>
                        <Trash2 size={15} strokeWidth={2} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
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
                {consumo.map(c => {
                  const pct = c.cupo > 0 ? Math.round((c.conversaciones / c.cupo) * 100) : 0
                  return (
                    <tr key={c.client_id}>
                      <td data-label="Cliente">{c.nombre}</td>
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
      </div>
    </div>
  )
}
