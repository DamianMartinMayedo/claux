'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Settings, Power, PowerOff, Store, X } from 'lucide-react'
import { crearCaja, setActivaCaja, type Caja } from '@/app/actions/portal/caja'
import PrerequisitoAviso from '@/components/portal/PrerequisitoAviso'
import { RowActions } from '@/components/portal/RowActions'
import { usePagination, TablePagination } from '@/components/TablePagination'
import { toastError, toastLoading } from '@/app/contexts/ToastContext'

interface Props { cajas: Caja[]; empresas: { empresa_id: string; nombre: string }[] }

function fechaCorta(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
}

export default function CajaHubView({ cajas, empresas }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [modalOpen, setModalOpen] = useState(false)
  const { pageItems, ...pag } = usePagination(cajas)
  const multi = empresas.length > 1
  const empresaNombre = (id: string) => empresas.find(e => e.empresa_id === id)?.nombre ?? id

  function toggleActiva(c: Caja) {
    const ld = toastLoading('Actualizando…')
    startTransition(async () => {
      const r = await setActivaCaja(c.caja_id, !c.activa)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo actualizar el punto de venta.'); return }
      router.refresh()
    })
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Puntos de venta</h1>
          <p className="page-subtitle">Cobran sin conexión y sincronizan con Claux cuando vuelve la señal.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModalOpen(true)} disabled={empresas.length === 0}>
          <Plus size={14} strokeWidth={2.5} /> Nuevo punto de venta
        </button>
      </div>

      {empresas.length === 0 && (
        <PrerequisitoAviso acciones={[{ label: 'Crear empresa', href: '/portal/empresas' }]}>
          Para crear un punto de venta necesitas <strong>una empresa</strong>. El almacén es opcional: solo hace falta si quieres que las ventas descuenten stock.
        </PrerequisitoAviso>
      )}

      <div className="card card-table">
        {cajas.length === 0 ? (
          <div className="mon-empty">
            <Store size={36} strokeWidth={1} opacity={0.25} />
            <p>Aún no tienes puntos de venta. Crea el primero y obtén su enlace de instalación.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  {multi && <th>Empresa</th>}
                  <th>Última sincronización</th>
                  <th>Estado</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(c => (
                  <tr key={c.caja_id} className="table-row-clickable"
                    onClick={() => router.push(`/portal/caja/${c.caja_id}`)}>
                    <td data-label="Nombre">
                      <Link href={`/portal/caja/${c.caja_id}`} className="link-inherit"
                        onClick={e => e.stopPropagation()}>{c.nombre}</Link>
                    </td>
                    {multi && <td data-label="Empresa">{empresaNombre(c.empresa_id)}</td>}
                    <td data-label="Última sincronización">{fechaCorta(c.last_sync_at)}</td>
                    <td data-label="Estado">
                      <span className={`badge ${c.activa ? 'badge-success' : ''}`}>
                        {c.activa ? 'Activa' : 'Desactivada'}
                      </span>
                    </td>
                    <td className="col-actions">
                      <RowActions>
                        <Link href={`/portal/caja/${c.caja_id}`} className="row-actions-item">
                          <Settings size={15} strokeWidth={2} /> Configurar
                        </Link>
                        <button className="row-actions-item" onClick={() => toggleActiva(c)} disabled={isPending}>
                          {c.activa
                            ? <><PowerOff size={15} strokeWidth={2} /> Desactivar</>
                            : <><Power size={15} strokeWidth={2} /> Activar</>}
                        </button>
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <TablePagination {...pag} label="punto de venta" />
      </div>

      {modalOpen && (
        <NuevoPuntoVentaModal
          empresas={empresas}
          onClose={() => setModalOpen(false)}
          onCreated={(id) => router.push(`/portal/caja/${id}`)}
        />
      )}
    </div>
  )
}

// ── Modal: nuevo punto de venta ─────────────────────────────────────────────────────────

function NuevoPuntoVentaModal({ empresas, onClose, onCreated }: {
  empresas: { empresa_id: string; nombre: string }[]
  onClose:  () => void
  onCreated: (cajaId: string) => void
}) {
  const [nombre, setNombre]       = useState('')
  const [empresaId, setEmpresaId] = useState(empresas[0]?.empresa_id ?? '')
  const [isPending, startTransition] = useTransition()
  const multi = empresas.length > 1

  function submit(e: FormEvent) {
    e.preventDefault()
    const ld = toastLoading('Creando…')
    startTransition(async () => {
      const r = await crearCaja(nombre, empresaId)
      await ld.dismiss()
      if (!r.ok || !r.caja_id) { toastError(r.error ?? 'No se pudo crear el punto de venta.'); return }
      onCreated(r.caja_id)
    })
  }

  return (
    <div className="modal-backdrop open">
      <form className="modal modal-440" role="dialog" aria-modal onSubmit={submit}>
        <div className="modal-header">
          <h2 className="modal-title">Nuevo punto de venta</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} strokeWidth={2} /></button>
        </div>
        <div className="modal-body">
          <div className="input-group">
            <label htmlFor="caja-nombre">Nombre <span className="required">*</span></label>
            <input id="caja-nombre" className="input" value={nombre} onChange={e => setNombre(e.target.value)}
              placeholder="Ej: Mostrador" autoFocus />
          </div>
          {multi && (
            <div className="input-group">
              <label htmlFor="caja-empresa">Empresa <span className="required">*</span></label>
              <select id="caja-empresa" className="input" value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
                {empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={isPending || !nombre.trim()}>
            {isPending ? <><span className="spinner spinner-sm" /> Creando…</> : 'Crear punto de venta'}
          </button>
        </div>
      </form>
    </div>
  )
}
