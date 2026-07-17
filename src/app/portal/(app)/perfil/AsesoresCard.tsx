'use client'

import { useState, useTransition } from 'react'
import { Plus, Pencil, Trash2, Users } from 'lucide-react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { RowActions } from '@/components/portal/RowActions'
import type { Asesor } from '@/app/actions/portal/asesores'
import { guardarAsesor, eliminarAsesor } from '@/app/actions/portal/asesores'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Gestión del directorio de asesores desde Perfil (el otro punto de gestión es el
// alta rápida dentro del modal "Enviar al asesor" de Reportes). Cada asesor tiene
// un ámbito: una empresa concreta o "todas".
export default function AsesoresCard({
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
  const [isPending, startTransition] = useTransition()

  const empresaNombre = (id: string | null) =>
    id ? (empresas.find(e => e.empresa_id === id)?.nombre ?? id) : 'Todas las empresas'

  function abrirAlta() {
    setForm('new'); setNombre(''); setEmail(''); setEmpresa('')
  }
  function abrirEdicion(a: Asesor) {
    setForm(a); setNombre(a.nombre); setEmail(a.email); setEmpresa(a.empresa_id ?? '')
  }
  function cerrar() { setForm(null) }

  function guardar() {
    const n = nombre.trim(), e = email.trim()
    if (!n) { toastError('El nombre es obligatorio.'); return }
    if (!EMAIL_RE.test(e)) { toastError('El correo no parece válido.'); return }
    const editando = form !== 'new' && form !== null ? form : null
    startTransition(async () => {
      const r = await guardarAsesor({
        asesor_id: editando?.asesor_id, nombre: n, email: e, empresa_id: empresa || null,
      })
      if (!r.ok || !r.asesor) { toastError(r.error ?? 'No se pudo guardar.'); return }
      setLista(prev => editando
        ? prev.map(x => x.asesor_id === r.asesor!.asesor_id ? r.asesor! : x)
        : [...prev, r.asesor!])
      toastSuccess('Asesor guardado.')
      cerrar()
    })
  }

  function borrar(a: Asesor) {
    startTransition(async () => {
      const r = await eliminarAsesor(a.asesor_id)
      if (!r.ok) { toastError(r.error ?? 'No se pudo eliminar.'); return }
      setLista(prev => prev.filter(x => x.asesor_id !== a.asesor_id))
      toastSuccess('Asesor eliminado.')
    })
  }

  return (
    <div className="card mb-5">
      <div className="prf-card-header">
        <h2 className="prf-section-title">Asesores</h2>
        {!form && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={abrirAlta}>
            <Plus size={14} strokeWidth={2.5} /> Añadir asesor
          </button>
        )}
      </div>
      <p className="prf-asesores-hint">
        Contactos a los que puedes enviarles los reportes desde el módulo de Reportes.
      </p>

      {form && (
        <div className="env-asesor-add prf-asesores-form">
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
        <div className="prf-asesores-empty">
          <Users size={32} strokeWidth={1} opacity={0.3} />
          <p>Aún no tienes asesores. Añade uno para poder enviarle tus reportes.</p>
        </div>
      ) : (
        <ul className="prf-asesores-list">
          {lista.map(a => (
            <li key={a.asesor_id} className="prf-asesor-row">
              <div className="prf-asesor-info">
                <span className="prf-asesor-nombre">{a.nombre}</span>
                <span className="prf-asesor-email">{a.email}</span>
              </div>
              <span className="prf-asesor-ambito">{empresaNombre(a.empresa_id)}</span>
              <RowActions>
                <button className="row-actions-item" onClick={() => abrirEdicion(a)}>
                  <Pencil size={15} strokeWidth={2} /> Editar
                </button>
                <button className="row-actions-item row-actions-item-danger" onClick={() => borrar(a)}>
                  <Trash2 size={14} strokeWidth={2} /> Eliminar
                </button>
              </RowActions>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
