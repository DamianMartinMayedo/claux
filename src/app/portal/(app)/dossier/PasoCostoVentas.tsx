'use client'

import { useState, useTransition } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { guardarCostoVentas, type CategoriaCosto } from '@/app/actions/portal/dossier'

// Paso "Coste de ventas" (solo con `base`): clasifica cada categoría de gasto
// real del cliente como coste de ventas o no. Nivel cliente: el 2º dossier hereda.
export default function PasoCostoVentas({
  categorias,
  onGuardado,
}: {
  categorias: CategoriaCosto[]
  onGuardado?: () => void
}) {
  const [estado, setEstado] = useState<Record<string, boolean>>(
    () => Object.fromEntries(categorias.map(c => [c.categoria, c.es_costo_ventas])),
  )
  const [pending, startTransition] = useTransition()

  function toggle(cat: string) {
    setEstado(prev => ({ ...prev, [cat]: !prev[cat] }))
  }

  function guardar() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('clasificacion', JSON.stringify(categorias.map(c => ({ categoria: c.categoria, es_costo_ventas: !!estado[c.categoria] }))))
      const res = await guardarCostoVentas(fd)
      if (res.ok) { toastSuccess('Clasificación guardada'); onGuardado?.() }
      else toastError(res.error || 'No se pudo guardar')
    })
  }

  return (
    <section className="card dos-costo-card">
      <div className="card-body">
        <h2 className="dos-section-title">Coste de ventas</h2>
        <p className="dos-section-hint">
          Es lo que te cuesta producir lo que vendes: ingredientes, mercancía. El alquiler
          o la administración no lo son. Marca las categorías que sean coste de ventas.
        </p>

        {categorias.length === 0 ? (
          <p className="dos-vacio">Aún no tienes categorías de gasto registradas.</p>
        ) : (
          <ul className="dos-costo-lista">
            {categorias.map(c => (
              <li key={c.categoria} className="dos-costo-item">
                <label className="dos-costo-label">
                  <input
                    type="checkbox"
                    checked={!!estado[c.categoria]}
                    onChange={() => toggle(c.categoria)}
                  />
                  <span>{c.categoria}</span>
                </label>
                <span className={`dos-costo-tag${estado[c.categoria] ? ' is-costo' : ''}`}>
                  {estado[c.categoria] ? 'Coste de ventas' : 'Operativo'}
                </span>
              </li>
            ))}
          </ul>
        )}

        {categorias.length > 0 && (
          <div className="dos-acciones">
            <button className="btn btn-primary" onClick={guardar} disabled={pending}>
              {pending ? <Loader2 size={14} strokeWidth={2.5} className="dos-spin" /> : <Save size={14} strokeWidth={2.5} />}
              Guardar clasificación
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
