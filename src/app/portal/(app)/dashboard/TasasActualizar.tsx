'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { actualizarTasasAuto } from '@/app/actions/portal/monedas'
import { toastTono, toastError } from '@/app/contexts/ToastContext'
import { mensajeTasas } from '@/lib/tasas-mensaje'

// Botón «Actualizar» del widget de tasas: dispara la actualización desde las
// fuentes AQUÍ MISMO, sin ir a Monedas (en Cuba, abrir otra pantalla es caro).
// Sin toast de «cargando»: el propio botón ya se pone en «Actualizando…» con su
// spinner, y dos avisos de lo mismo a la vez es ruido.
export default function TasasActualizar() {
  const router = useRouter()
  const [cargando, setCargando] = useState(false)

  async function actualizar() {
    if (cargando) return
    setCargando(true)
    try {
      const r = await actualizarTasasAuto()
      const { tono, texto } = mensajeTasas(r)
      toastTono(tono, texto)
      router.refresh()
    } catch {
      toastError('No se pudo actualizar.')
    } finally {
      setCargando(false)
    }
  }

  return (
    <button type="button" className="btn btn-secondary btn-sm" onClick={actualizar} disabled={cargando}>
      {cargando
        ? <><span className="spinner spinner-sm" /> Actualizando…</>
        : <><RefreshCw size={14} strokeWidth={2} /> Actualizar</>}
    </button>
  )
}
