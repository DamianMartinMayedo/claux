'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import PanelPropuestaIa from '@/components/ia/PanelPropuestaIa'
import IaSparkle from '@/components/ia/IaSparkle'
import { proponerRolesIa, aplicarRolesIa } from '@/app/actions/portal/clasificador'
import type { RolPropuesto } from '@/lib/ia/equipo'
import type { LineaPropuesta, PropuestaIa } from '@/lib/ia/propuesta'

// ── Colocar en el plan las categorías que llegaron con la migración ──────────
//
// Solo lo ve el EQUIPO (la pantalla lo pinta en impersonación): es la última mano
// de una migración, cuando el histórico entero ha entrado en el mismo renglón
// porque el importador pregunta el papel UNA vez para todo el lote.
//
// La IA propone y aplica quien mira: aquí se cambia de renglón el dinero ya
// contabilizado de un negocio real, así que el clic es de una persona. Lo que la
// IA no sabe colocar ni se ofrece —sale en la nota del panel—.

export default function ClasificarCuentasIa() {
  const router = useRouter()
  const [abierto, setAbierto]     = useState(false)
  const [propuesta, setPropuesta] = useState<PropuestaIa<RolPropuesto> | null>(null)
  const [pensando, setPensando]   = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [reintento, setReintento]  = useState(false)

  async function pedir() {
    setAbierto(true)
    setPropuesta(null)
    setError(null)
    setReintento(false)
    setPensando(true)
    const res = await proponerRolesIa()
    setPensando(false)
    if (!res.ok) { setError(res.error); setReintento(!!res.reintentar); return }
    setPropuesta(res.propuesta)
  }

  async function aplicar(lineas: LineaPropuesta<RolPropuesto>[]) {
    if (!propuesta) return
    setAplicando(true)
    const res = await aplicarRolesIa({
      entradas:   lineas.map(l => l.valor),
      propuestas: propuesta.lineas.length,
    })
    setAplicando(false)
    if (!res.ok) { toastError(res.error ?? 'No se pudo aplicar.'); return }
    toastSuccess(res.aplicadas === 1 ? 'Categoría colocada' : `${res.aplicadas} categorías colocadas`)
    setAbierto(false)
    setPropuesta(null)
    router.refresh()
  }

  return (
    <>
      <div className="filters-bar filters-bar-end">
        <button type="button" className="btn btn-ia btn-sm" disabled={pensando} onClick={pedir}>
          <IaSparkle size={14} /> {pensando ? 'Leyendo el catálogo…' : 'Colocar en el informe'}
        </button>
      </div>

      {abierto && (
        <PanelPropuestaIa
          titulo="Dónde va cada categoría"
          propuesta={propuesta}
          cargando={pensando}
          error={error}
          aplicando={aplicando}
          verbo="Colocar"
          onAplicar={aplicar}
          onReintentar={reintento ? pedir : undefined}
          onCerrar={() => { setAbierto(false); setPropuesta(null); setError(null) }}
        />
      )}
    </>
  )
}
