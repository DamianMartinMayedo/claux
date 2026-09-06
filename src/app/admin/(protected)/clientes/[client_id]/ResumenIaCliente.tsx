'use client'

import { useState } from 'react'
import PanelDiagnosticoIa, { type LineaDiagnostico } from '@/components/ia/PanelDiagnosticoIa'
import IaSparkle from '@/components/ia/IaSparkle'
import { resumirClienteIa } from '@/app/actions/clientes'

// ── El minuto antes de la llamada ────────────────────────────────────────────
// Se pide a mano, no al abrir: la ficha se abre veinte veces al día para mirar una
// fecha, y gastar bolsa en cada una para un resumen que nadie iba a leer sería
// tirar el dinero. Cuando hay llamada, se pulsa.
//
// No escribe nada ni se guarda: es el hermano de solo lectura del panel, con dos
// líneas —cómo va y qué hacer ahora—.

export default function ResumenIaCliente({ clientId }: { clientId: string }) {
  const [abierto, setAbierto]   = useState(false)
  const [lineas, setLineas]     = useState<LineaDiagnostico[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [reintento, setReintento] = useState(false)

  async function pedir() {
    setAbierto(true)
    setLineas(null)
    setError(null)
    setReintento(false)
    setCargando(true)
    const res = await resumirClienteIa(clientId)
    setCargando(false)
    if (!res.ok) { setError(res.error); setReintento(!!res.reintentar); return }
    // La primera frase va destacada y las otras dos debajo: es un párrafo, no una
    // lista de tres puntos que obligue a leerlo todo para enterarse.
    const como: LineaDiagnostico[] = res.estado.length ? [{
      clave:   'como-va',
      marca:   'Cómo va',
      titulo:  res.estado[0],
      detalle: res.estado.slice(1).join(' ') || undefined,
    }] : []
    setLineas([...como, { clave: 'ahora', marca: 'Ahora', titulo: res.siguiente }])
  }

  return (
    <>
      <div className="filters-bar filters-bar-end">
        <button type="button" className="btn btn-ia btn-sm" disabled={cargando} onClick={pedir}>
          <IaSparkle size={14} /> {cargando ? 'Leyendo la ficha…' : 'Cómo va este cliente'}
        </button>
      </div>

      {abierto && (
        <PanelDiagnosticoIa
          titulo="Antes de la llamada"
          lineas={lineas}
          cargando={cargando}
          error={error}
          cargandoTexto="Leyendo la ficha…"
          vacio="No hay nada que contar de este cliente."
          descargo="Generado por IA con los datos de esta ficha · no se guarda en ninguna parte."
          onReintentar={reintento ? pedir : undefined}
          onCerrar={() => setAbierto(false)}
        />
      )}
    </>
  )
}
