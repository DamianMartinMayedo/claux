'use client'

import { useState, useTransition } from 'react'
import { Plus, Pencil, Trash2, Users } from 'lucide-react'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { RowActions } from '@/components/portal/RowActions'
import { ConfirmDialog } from '@/components/portal/Dialog'
import type { Asesor } from '@/app/actions/portal/asesores'
import { guardarAsesor, eliminarAsesor } from '@/app/actions/portal/asesores'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Página de gestión del directorio de asesores (ruta /portal/asesores, gateada por
// el módulo `base`/Contabilidad). El otro punto de gestión es el alta rápida dentro
// del modal "Enviar al asesor" de Reportes. Cada asesor tiene un ámbito: una empresa
// concreta o "todas".
export default function AsesoresView({
  asesores, empresas,
}: {
  asesores: Asesor[]
  empresas: { empresa_id: string; nombre: string }[]
}) {
  const [lista, setLista] = useState<Asesor[]>(asesores)
  // null = formulario cerrado; 'new' = alta; Asesor = edición.
  const [form, setForm] = useState<'new' | Asesor | null>(null)
  const [nombre,  setNombre]  = useState('')
  const [email,   setEmail]   = useState('')
  const [empresa, setEmpresa] = useState('')
  const [confirmarBorrado, setConfirmarBorrado] = useState<Asesor | null>(null)
  const [isPending, startTransition] = useTransition()

  const empresaNombre = (id: string | null) =>
    id ? (empresas.find(e => e.empresa_id === id)?.nombre ?? id) : 'Todas las empresas'

  function abrirAlta() { setForm('new'); setNombre(''); setEmail(''); setEmpresa('') }
  function abrirEdicion(a: Asesor) {
    setForm(a); setNombre(a.nombre); setEmail(a.email); setEmpresa(a.empresa_id ?? '')
  }
  function cerrar() { setForm(null) }

  function guardar() {
    const n = nombre.trim(), e = email.trim()
    if (!n) { toastError('El nombre es obligatorio.'); return }
    if (!EMAIL_RE.test(e)) { toastError('El correo no parece válido.'); return }
    const editando = form !== 'new' && form !== null ? form : null
    const ld = toastLoading(editando ? 'Guardando…' : 'Creando…')
    startTransition(async () => {
      const r = await guardarAsesor({
        asesor_id: editando?.asesor_id, nombre: n, email: e, empresa_id: empresa || null,
      })
      await ld.dismiss()
      if (!r.ok || !r.asesor) { toastError(r.error ?? 'No se pudo guardar.'); return }
      setLista(prev => editando
        ? prev.map(x => x.asesor_id === r.asesor!.asesor_id ? r.asesor! : x)
        : [...prev, r.asesor!])
      toastSuccess('Asesor guardado.')
      cerrar()
    })
  }

  // Confirmación in-app (ConfirmDialog, patrón de la plataforma), centralizada
  // en el padre para no anidar el modal dentro del menú de acciones de la fila.
  function doBorrar(a: Asesor) {
    setConfirmarBorrado(null)
    const ld = toastLoading('Eliminando…')
    startTransition(async () => {
      const r = await eliminarAsesor(a.asesor_id)
      await ld.dismiss()
      if (!r.ok) { toastError(r.error ?? 'No se pudo eliminar.'); return }
      setLista(prev => prev.filter(x => x.asesor_id !== a.asesor_id))
      toastSuccess('Asesor eliminado.')
    })
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Asesores</h1>
          <p className="page-subtitle">Contactos a los que envías tus reportes financieros por correo.</p>
        </div>
        {!form && (
          <button type="button" className="btn btn-primary" onClick={abrirAlta}>
            <Plus size={14} strokeWidth={2.5} /> Añadir asesor
          </button>
        )}
      </div>

      {form && (
        <div className="card env-asesor-add mb-4">
          <div className="input-group">
            <label htmlFor="asr-nombre">Nombre</label>
            <input id="asr-nombre" className="input" value={nombre}
              onChange={e => setNombre(e.target.value)} maxLength={120} placeholder="Gestoría López" />
          </div>
          <div className="input-group">
            <label htmlFor="asr-email">Correo</label>
            <input id="asr-email" className="input" type="email" value={email}
              onChange={e => setEmail(e.target.value)} maxLength={160} placeholder="asesor@correo.com"
              spellCheck={false} autoComplete="off" />
          </div>
          <div className="input-group">
            <label htmlFor="asr-empresa">Para</label>
            <select id="asr-empresa" className="input" value={empresa} onChange={e => setEmpresa(e.target.value)}>
              <option value="">Todas las empresas</option>
              {empresas.map(e => <option key={e.empresa_id} value={e.empresa_id}>{e.nombre}</option>)}
            </select>
            <span className="input-hint">Un asesor «para todas» aparece en el envío de cualquier empresa.</span>
          </div>
          <div className="env-asesor-add-acciones">
            <button type="button" className="btn btn-secondary btn-sm" onClick={cerrar} disabled={isPending}>Cancelar</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={guardar} disabled={isPending}>
              {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : 'Guardar'}
            </button>
          </div>
        </div>
      )}

      {lista.length === 0 && !form ? (
        <div className="card card-table">
          <div className="mon-empty">
            <Users size={36} strokeWidth={1} />
            <p>Aún no tienes asesores. Añade uno para poder enviarle tus reportes.</p>
          </div>
        </div>
      ) : lista.length > 0 && (
        <div className="card card-table">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Correo</th>
                  <th>Para</th>
                  <th className="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {lista.map(a => (
                  <tr key={a.asesor_id}>
                    <td data-label="Nombre"><span className="table-empresa">{a.nombre}</span></td>
                    <td data-label="Correo" className="cell-truncate">{a.email}</td>
                    <td data-label="Para">
                      <span className="badge badge-neutral">{empresaNombre(a.empresa_id)}</span>
                    </td>
                    <td className="col-actions">
                      <RowActions>
                        <button className="row-actions-item" onClick={() => abrirEdicion(a)}>
                          <Pencil size={15} strokeWidth={2} /> Editar
                        </button>
                        <button className="row-actions-item row-actions-item-danger" onClick={() => setConfirmarBorrado(a)}>
                          <Trash2 size={14} strokeWidth={2} /> Eliminar
                        </button>
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirmarBorrado && (
        <ConfirmDialog
          title={`¿Eliminar a "${confirmarBorrado.nombre}"?`}
          body="Dejará de estar disponible al enviar reportes. Esta acción no se puede deshacer."
          confirmLabel="Eliminar" danger
          onCancel={() => setConfirmarBorrado(null)}
          onConfirm={() => doBorrar(confirmarBorrado)}
        />
      )}
    </div>
  )
}
