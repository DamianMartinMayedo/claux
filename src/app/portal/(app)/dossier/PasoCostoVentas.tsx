'use client'

import { useState, useTransition } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toastError, toastSuccess, toastLoading } from '@/app/contexts/ToastContext'
import { guardarCostoVentas, type CategoriaCosto, type RolPL } from '@/app/actions/portal/dossier'
import { ROLES_PL, ROL_PL_LABEL, ROL_PL_AYUDA } from '@/lib/pl/estado'
import PrerequisitoAviso from '@/components/portal/PrerequisitoAviso'

// Paso «Coste de ventas» (solo con `base`): clasifica cada categoría de gasto real
// del cliente por su papel en el estado de resultados. Nivel cliente: el 2º dossier
// hereda.
//
// CONVERGENCIA (F4): esto escribe en `categorias_gastos.rol_pl`, la misma columna
// que lee el informe de Reportes. Antes era un booleano propio del dossier
// (`dossier_costo_ventas`), así que el dueño podía tener «Alquiler» como coste de
// ventas en el documento del inversor y como gasto operativo en su propio informe.
// Clasificar aquí clasifica en los dos sitios, porque es un solo dato.

export default function PasoCostoVentas({
  categorias,
  onGuardado,
}: {
  categorias: CategoriaCosto[]
  onGuardado?: () => void
}) {
  const [estado, setEstado] = useState<Record<string, RolPL>>(
    () => Object.fromEntries(categorias.map(c => [c.categoria_id, c.rol_pl])),
  )
  const [pending, startTransition] = useTransition()

  function guardar() {
    const ld = toastLoading('Guardando…')
    startTransition(async () => {
      const fd = new FormData()
      fd.set('clasificacion', JSON.stringify(
        categorias.map(c => ({ categoria_id: c.categoria_id, rol_pl: estado[c.categoria_id] ?? c.rol_pl })),
      ))
      const res = await guardarCostoVentas(fd)
      await ld.dismiss()
      if (res.ok) { toastSuccess('Clasificación guardada'); onGuardado?.() }
      else toastError(res.error || 'No se pudo guardar')
    })
  }

  const cuenta = (rol: RolPL) => categorias.filter(c => (estado[c.categoria_id] ?? 'OPERATIVO') === rol).length

  return (
    <section className="card dos-costo-card">
      <div className="dos-body">
        <h2 className="dos-section-title">Coste de ventas</h2>
        <p className="dos-section-hint">
          Di qué papel tiene cada gasto en tu estado de resultados. Con esto tu informe deja de ser
          una lista y pasa a enseñar <strong>margen bruto</strong> y <strong>resultado operativo</strong>.
          Lo que elijas aquí vale también para tus Reportes: es el mismo dato.
        </p>

        {categorias.length === 0 ? (
          <PrerequisitoAviso acciones={[{ label: 'Crear categorías de gasto', href: '/portal/gastos?tab=categorias' }]}>
            Aún no tienes categorías de gasto registradas: sin ellas no hay nada que clasificar.
            Créalas en Gastos y vuelve a este paso.
          </PrerequisitoAviso>
        ) : (
          <>
            <ul className="dos-rol-lista">
              {categorias.map(c => {
                const rol = estado[c.categoria_id] ?? 'OPERATIVO'
                return (
                  <li key={c.categoria_id} className="dos-rol-fila">
                    <label className="dos-rol-nombre" htmlFor={`rol-${c.categoria_id}`}>{c.categoria}</label>
                    <select
                      id={`rol-${c.categoria_id}`}
                      className="input dos-rol-select"
                      value={rol}
                      onChange={e => setEstado(prev => ({ ...prev, [c.categoria_id]: e.target.value as RolPL }))}
                    >
                      {ROLES_PL.map(r => <option key={r} value={r}>{ROL_PL_LABEL[r]}</option>)}
                    </select>
                  </li>
                )
              })}
            </ul>

            <ul className="dos-rol-leyenda">
              {ROLES_PL.map(r => (
                <li key={r}>
                  <strong>{ROL_PL_LABEL[r]}</strong> ({cuenta(r)}) — {ROL_PL_AYUDA[r]}
                </li>
              ))}
            </ul>

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
