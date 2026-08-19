'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Pencil } from 'lucide-react'
import { toastError, toastLoading, toastSuccess } from '@/app/contexts/ToastContext'
import { guardarDatosFirma, type DatosFirma } from '@/app/actions/portal/documentos'

const CAMPOS: { key: keyof DatosFirma; label: string; ph: string }[] = [
  { key: 'razon_social',         label: 'Razón social del negocio',       ph: 'Nombre legal completo' },
  { key: 'nif',                  label: 'NIF / CIF',                      ph: 'Identificación fiscal' },
  { key: 'domicilio_fiscal',     label: 'Domicilio fiscal',               ph: 'Calle, nº, población, CP, país' },
  { key: 'representante_nombre', label: 'Representante que firma',        ph: 'Nombre y apellidos' },
  { key: 'representante_doc',    label: 'Documento del representante',    ph: 'DNI / NIE / pasaporte' },
]

export default function DatosFirmaForm({
  datos, completos, puedeEditar, bloqueado, esAdmin,
}: {
  datos: DatosFirma
  completos: boolean
  puedeEditar: boolean
  bloqueado: boolean
  esAdmin: boolean
}) {
  const router = useRouter()
  // Si están incompletos, arranca en modo edición (hay que rellenarlos). Si están
  // completos, arranca colapsado en resumen.
  const [editando, setEditando] = useState(!completos && puedeEditar)
  const [f, setF] = useState<DatosFirma>(datos)
  const [isPending, startTransition] = useTransition()
  const set = (k: keyof DatosFirma) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF(prev => ({ ...prev, [k]: e.target.value }))

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    CAMPOS.forEach(c => fd.append(c.key, (f[c.key] ?? '').trim()))
    const ld = toastLoading('Guardando datos…')
    startTransition(async () => {
      const res = await guardarDatosFirma(fd)
      await ld.dismiss()
      if (!res.ok) { toastError(res.error ?? 'No se pudo guardar.'); return }
      toastSuccess('Datos de firma guardados')
      setEditando(false)
      router.refresh()
    })
  }

  // ── Resumen (datos completos y no editando) ──
  if (completos && !editando) {
    return (
      <div className="doc-datos-resumen">
        <div className="doc-datos-grid">
          {CAMPOS.map(c => (
            <div key={c.key} className="prf-field">
              <span className="prf-label">{c.label}</span>
              <span className="prf-value">{datos[c.key] || '—'}</span>
            </div>
          ))}
        </div>
        {bloqueado ? (
          <p className="doc-firma-legal">
            <Lock size={13} /> Estos datos están bloqueados porque ya has firmado. Para cambiarlos,
            contacta con CLAUX y reabriremos la firma.
          </p>
        ) : puedeEditar ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditando(true)}>
            <Pencil size={14} /> Editar datos
          </button>
        ) : null}
      </div>
    )
  }

  // ── Formulario ──
  if (!puedeEditar) {
    return (
      <p className="doc-firma-legal">
        {esAdmin
          ? 'Los datos de firma están bloqueados porque ya hay documentos firmados.'
          : 'Solo el administrador de la empresa puede completar los datos de firma.'}
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="doc-datos-form">
      <p className="doc-firma-legal">
        Estos datos identifican oficialmente a tu empresa y a quien firma en el contrato y el NDA.
        Complétalos con los datos reales antes de firmar.
      </p>
      <div className="doc-datos-grid">
        {CAMPOS.map(c => (
          <div key={c.key} className="input-group">
            <label>{c.label} <span className="required">*</span></label>
            <input className="input" value={f[c.key] ?? ''} onChange={set(c.key)} placeholder={c.ph} />
          </div>
        ))}
      </div>
      <div className="prf-form-submit">
        {completos && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setF(datos); setEditando(false) }}>
            Cancelar
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={isPending}>
          {isPending ? <><span className="spinner spinner-sm" /> Guardando…</> : 'Guardar datos'}
        </button>
      </div>
    </form>
  )
}
