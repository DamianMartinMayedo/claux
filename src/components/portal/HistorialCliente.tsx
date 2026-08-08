'use client'

import { useEffect, useState } from 'react'
import { historialCliente, type HistorialCliente as Historial } from '@/app/actions/portal/agenda-comun'

/**
 * «3ª visita · 1 no asistió» — lo que el dueño sabría de memoria si el cliente fuera
 * de siempre, y que el software no le decía.
 *
 * Se calcula al ABRIR el detalle, no en el listado: es una consulta por ficha, no por
 * fila, y en 3G eso es la diferencia entre una pantalla y cien. Se cruza por teléfono
 * normalizado (últimos 8 dígitos): el mismo cliente escribe `+53 5…` una vez y `5…`
 * la siguiente, y por nombre dos «Ana» no son la misma persona.
 */
export default function HistorialClienteLinea({ telefono }: { telefono: string | null }) {
  const [datos, setDatos] = useState<Historial | null>(null)

  useEffect(() => {
    if (!telefono) return
    let cancel = false
    historialCliente(telefono)
      .then(h => { if (!cancel) setDatos(h) })
      .catch(() => { /* sin historial no se pinta nada: no es un error para el dueño */ })
    return () => { cancel = true }
  }, [telefono])

  // Cliente nuevo (o sin teléfono): no hay nada que contar, y «0 visitas» es ruido.
  if (!datos || (datos.visitas === 0 && datos.no_shows === 0)) return null

  const partes: string[] = []
  if (datos.visitas > 0) partes.push(`${datos.visitas + 1}ª visita`)
  if (datos.no_shows > 0) partes.push(`${datos.no_shows} no asistió`)

  return (
    <div className="input-group ter-col-full">
      <span className={`text-xs-muted${datos.no_shows > 0 ? ' input-hint-danger' : ''}`}>
        {partes.join(' · ')}
      </span>
    </div>
  )
}
