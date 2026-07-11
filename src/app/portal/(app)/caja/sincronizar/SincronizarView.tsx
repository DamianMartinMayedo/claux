'use client'

import { useState, useTransition, useRef, type ChangeEvent } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { ingestarLoteArchivo } from '@/app/actions/portal/caja'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'

interface Props { cajas: { caja_id: string; nombre: string }[] }
type Resultado = { tickets_nuevos: number; cierres_posteados: number; duplicados: number; errores: string[] }

export default function SincronizarView({ cajas }: Props) {
  const [cajaId, setCajaId] = useState(cajas[0]?.caja_id ?? '')
  const [isPending, startTransition] = useTransition()
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !cajaId) return
    const reader = new FileReader()
    reader.onload = () => {
      let payload
      try { payload = JSON.parse(String(reader.result)) }
      catch { toastError('El archivo no es un JSON válido.'); return }
      startTransition(async () => {
        const r = await ingestarLoteArchivo(cajaId, payload)
        if (!r.ok || !r.resultado) { toastError(r.error ?? 'No se pudo procesar el archivo.'); return }
        setResultado(r.resultado)
        toastSuccess('Archivo sincronizado.')
        if (fileRef.current) fileRef.current.value = ''
      })
    }
    reader.readAsText(file)
  }

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sincronizar</h1>
          <p className="page-subtitle">Sube el archivo exportado por una caja sin conexión. Se registra por fecha, sin duplicar.</p>
        </div>
      </div>

      <div className="card caja-config-section">
        {cajas.length === 0 ? (
          <p className="caja-install-hint">Primero crea una caja en la sección Cajas.</p>
        ) : (
          <div className="caja-install">
            <div className="input-group">
              <label htmlFor="sync-caja">Caja</label>
              <select id="sync-caja" className="input" value={cajaId} onChange={e => setCajaId(e.target.value)}>
                {cajas.map(c => <option key={c.caja_id} value={c.caja_id}>{c.nombre}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label htmlFor="sync-file">Archivo de la caja (.json)</label>
              <input id="sync-file" ref={fileRef} type="file" accept="application/json,.json"
                className="input" onChange={onFile} disabled={isPending} />
            </div>
            {isPending && <p className="caja-install-hint"><span className="spinner spinner-sm" /> Procesando…</p>}
          </div>
        )}
      </div>

      {resultado && (
        <div className="card">
          <div className="alert alert-success">
            <CheckCircle2 size={16} strokeWidth={2} />
            <span>
              {resultado.tickets_nuevos} ventas nuevas · {resultado.cierres_posteados} cierres registrados · {resultado.duplicados} ya existentes
            </span>
          </div>
          {resultado.errores.length > 0 && (
            <ul className="caja-install-hint">
              {resultado.errores.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
