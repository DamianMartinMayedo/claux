'use client'

import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { useState } from 'react'
import { guardarSetting } from '@/app/actions/settings'
import { CLAVES_PROVEEDOR } from '@/lib/documentos/proveedor'
import FormHelp from '@/components/portal/FormHelp'

type Props = {
  nombre:    string
  nif:       string
  domicilio: string
  email:     string
  telefono:  string
  iae:       string
}

// Datos legales del proveedor (Claudia, autónoma) que rellenan el contrato y el
// NDA. Editables aquí para no tener que desplegar cuando cambien (p. ej. al
// constituir CLAUX S.L. o al mudar el domicilio fiscal).
export default function ProveedorForm(props: Props) {
  const [f, setF] = useState(props)
  const [loading, setLoading] = useState(false)
  const set = (k: keyof Props) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF(prev => ({ ...prev, [k]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const results = await Promise.all([
      guardarSetting(CLAVES_PROVEEDOR.nombre,    f.nombre.trim()),
      guardarSetting(CLAVES_PROVEEDOR.nif,       f.nif.trim()),
      guardarSetting(CLAVES_PROVEEDOR.domicilio, f.domicilio.trim()),
      guardarSetting(CLAVES_PROVEEDOR.email,     f.email.trim()),
      guardarSetting(CLAVES_PROVEEDOR.telefono,  f.telefono.trim()),
      guardarSetting(CLAVES_PROVEEDOR.iae,       f.iae.trim()),
    ])
    setLoading(false)
    if (results.some(r => !r.ok)) { toastError('No se pudo guardar algún dato.'); return }
    toastSuccess('Datos del proveedor guardados')
  }

  return (
    <form onSubmit={handleSubmit} className="config-form">
      <div className="grid-cols-2">
        <div className="input-group">
          <label>Nombre completo</label>
          <input className="input" value={f.nombre} onChange={set('nombre')} placeholder="Claudia Cuevas Alarcón" />
        </div>
        <div className="input-group">
          <div className="form-label-with-help">
            <label>NIF / DNI</label>
            <FormHelp text="Identificación fiscal de la parte firmante. Aparece en el contrato y el NDA." label="Para qué se usa el NIF" />
          </div>
          <input className="input" value={f.nif} onChange={set('nif')} placeholder="00000000X" />
        </div>
        <div className="input-group">
          <label>Domicilio fiscal / profesional</label>
          <input className="input" value={f.domicilio} onChange={set('domicilio')} placeholder="Calle, nº, población, CP, provincia, país" />
        </div>
        <div className="input-group">
          <label>Email de contacto</label>
          <input className="input" type="email" value={f.email} onChange={set('email')} placeholder="contacto@claux.es" />
        </div>
        <div className="input-group">
          <label>Teléfono (opcional)</label>
          <input className="input" value={f.telefono} onChange={set('telefono')} placeholder="+34 …" />
        </div>
        <div className="input-group">
          <div className="form-label-with-help">
            <label>Epígrafe IAE (opcional)</label>
            <FormHelp text="Actividad económica declarada. No es obligatorio en los documentos." label="Qué es el epígrafe IAE" />
          </div>
          <input className="input" value={f.iae} onChange={set('iae')} placeholder="…" />
        </div>
      </div>

      <button type="submit" className="btn btn-primary" disabled={loading}>
        {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar datos'}
      </button>
    </form>
  )
}
