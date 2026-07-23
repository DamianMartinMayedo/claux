'use client'

import { useState, useTransition } from 'react'
import { Loader2, Save, Check } from 'lucide-react'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
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
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const fd = new FormData()
      fd.set('clasificacion', JSON.stringify(categorias.map(c => ({ categoria: c.categoria, es_costo_ventas: !!estado[c.categoria] }))))
      const res = await guardarCostoVentas(fd)
      await ld.dismiss()
      if (res.ok) { toastSuccess('Clasificación guardada'); onGuardado?.() }
      else toastError(res.error || 'No se pudo guardar')
    })
  }

  const marcadas = categorias.filter(c => estado[c.categoria]).length

  return (
    <section className="card dos-costo-card">
      <div className="dos-body">
        <h2 className="dos-section-title">Coste de ventas</h2>
        <p className="dos-section-hint">
          Marca lo que te cuesta <strong>producir o comprar</strong> lo que vendes
          (ingredientes, mercancía). El alquiler, la administración o los servicios, no.
        </p>

        {categorias.length === 0 ? (
          <p className="dos-vacio">Aún no tienes categorías de gasto registradas.</p>
        ) : (
          <>
            <div className="dos-cv-chips">
              {categorias.map(c => {
                const on = !!estado[c.categoria]
                return (
                  <button
                    key={c.categoria} type="button"
                    className={`dos-cv-chip${on ? ' is-costo' : ''}`}
                    onClick={() => toggle(c.categoria)}
                    aria-pressed={on}
                  >
                    <span className="dos-cv-check" aria-hidden="true">{on && <Check size={13} strokeWidth={3} />}</span>
                    {c.categoria}
                  </button>
                )
              })}
            </div>
            <p className="dos-cv-nota">
              {marcadas} de {categorias.length} marcadas como coste de ventas · el resto cuenta como gasto operativo.
            </p>
            <div className="dos-acciones">
              <button className="btn btn-primary" onClick={guardar} disabled={pending}>
                {pending ? <Loader2 size={14} strokeWidth={2.5} className="dos-spin" /> : <Save size={14} strokeWidth={2.5} />}
                Guardar clasificación
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
