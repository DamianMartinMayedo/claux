'use client'

// ── El aviso de la gaveta, con la bandeja detrás ─────────────────────────────
//
// El aviso sale en cinco pantallas y la bandeja se abre **donde estés**. Antes
// enlazaba a Tesorería y allí había que volver a pulsar: dos pantallas y una
// recarga para contestar «esto fue hielo». Con una conexión cubana eso no es un
// clic de más, es medio minuto en blanco — y una tarea que cuesta medio minuto
// arrancar es una tarea que se deja para luego.
//
// El detalle de los movimientos NO viaja en el render de las cinco pantallas: se
// pide al pulsar (`abrirBandejaGaveta`). Casi siempre no se pulsa, y entonces no
// se ha pagado nada. Tesorería es la excepción: ahí la página ya trae la bandeja
// cargada del servidor y se le pasa por `datos`, así que abre sin ir a la red.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toastError } from '@/app/contexts/ToastContext'
import AvisoGaveta from './AvisoGaveta'
import BandejaGaveta from './BandejaGaveta'
import { abrirBandejaGaveta, type DatosGaveta } from '@/app/actions/portal/caja-gaveta'
import type { ResumenGaveta } from '@/lib/caja/pendientes'
import type { CategoriaGasto } from '@/app/actions/portal/gastos'

type Cargada = DatosGaveta & { categorias: CategoriaGasto[] }

export default function GavetaLanzador({
  resumen, nota, className, datos,
}: {
  resumen:    ResumenGaveta
  /** Ver `AvisoGaveta.nota`: cambia la consecuencia, no el hecho. */
  nota?:      string
  className?: string
  /** Solo Tesorería: la bandeja ya viene del servidor, no hay que pedirla. */
  datos?:     Cargada
}) {
  const router = useRouter()
  const [abierta,  setAbierta]  = useState(false)
  const [cargando, setCargando] = useState(false)
  const [cargada,  setCargada]  = useState<Cargada | null>(datos ?? null)

  async function abrir() {
    if (cargada) { setAbierta(true); return }
    setCargando(true)
    const res = await abrirBandejaGaveta()
    setCargando(false)
    // Cero pendientes aquí significa que otro ya las clasificó desde otra pestaña:
    // no es un error, es un aviso que se quedó viejo en pantalla.
    if (!res.pendientes.length) {
      toastError('Ya no queda nada por clasificar. Actualizando…')
      router.refresh()
      return
    }
    setCargada(res)
    setAbierta(true)
  }

  return (
    <>
      <AvisoGaveta resumen={resumen} nota={nota} className={className}
        onAbrir={abrir} cargando={cargando} />
      {abierta && cargada && (
        <BandejaGaveta
          pendientes={cargada.pendientes}
          categorias={cargada.categorias}
          puedeEditar={cargada.puedeEditar}
          onClose={() => setAbierta(false)}
          onSaved={() => { setAbierta(false); setCargada(null); router.refresh() }}
        />
      )}
    </>
  )
}
