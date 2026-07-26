import Link from 'next/link'
import { AlertTriangle, ChevronRight, Clock } from 'lucide-react'
import type { Pendiente } from '@/app/actions/portal/dashboard'

// Franja «Pendiente»: lo accionable de TODOS los módulos, junto y arriba.
//
// El dueño abre el dashboard para saber si tiene que hacer algo hoy, y esa
// respuesta estaba repartida entre ocho tarjetas —había que recorrerlas una a una
// para descubrir que un producto estaba bajo mínimo—. Aquí cada módulo aporta una
// LÍNEA, no una tarjeta: es lo que permite añadir funcionalidades sin que el
// dashboard crezca.
//
// Se dibuja como LISTA en dos grupos, no como una nube de píldoras de colores:
// con nueve chips teñidos de rojo y ámbar todo gritaba igual, ocupaba tres filas
// y no se distinguía lo que ya está vencido de lo que solo hay que mirar. El
// color queda reducido al icono; el orden y el grupo hacen el resto.
//
// Si no hay nada que atender, la franja NO se pinta: un «todo en orden» ocupando
// sitio cada día enseña a ignorar la zona, y el día que salga algo de verdad ya
// nadie la mira.
export default function PendienteFranja({ items }: { items: Pendiente[] }) {
  if (items.length === 0) return null

  const grupos = [
    { tono: 'alerta' as const, label: 'Ya vencido',    items: items.filter(i => i.tono === 'alerta') },
    { tono: 'aviso'  as const, label: 'Cuando puedas', items: items.filter(i => i.tono === 'aviso') },
  ].filter(g => g.items.length > 0)

  // Con un solo grupo la etiqueta sobra: no separa nada de nada.
  const conEtiquetas = grupos.length > 1

  return (
    <section className="dash-pendiente" aria-label="Pendiente">
      <div className="dash-pendiente-cab">
        <h2 className="dash-pendiente-titulo">Pendiente</h2>
        <span className="dash-pendiente-cuenta">{items.length}</span>
      </div>

      {grupos.map(g => (
        <div key={g.tono} className="dash-pendiente-grupo">
          {conEtiquetas && <p className={`dash-pendiente-grupo-label is-${g.tono}`}>{g.label}</p>}
          <ul className="dash-pendiente-lista">
            {g.items.map(p => (
              <li key={p.clave}>
                <Link href={p.ruta} className={`dash-pendiente-item is-${p.tono}`}>
                  <span className="dash-pendiente-icono" aria-hidden="true">
                    {p.tono === 'alerta' ? <AlertTriangle size={15} /> : <Clock size={15} />}
                  </span>
                  <span className="dash-pendiente-texto">{p.texto}</span>
                  <ChevronRight size={15} className="dash-pendiente-chevron" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
