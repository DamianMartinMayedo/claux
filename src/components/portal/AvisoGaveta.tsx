'use client'

// ── «Tienes dinero de la caja sin clasificar» ────────────────────────────────
//
// El aviso sale en TODAS las pantallas a las que le falta ese dinero: Tesorería
// (donde está la bandeja), Gastos, el estado de resultados y las operaciones del
// punto de venta. Un solo componente, porque cuatro copias acabarían diciendo
// cuatro números distintos el día que cambie el criterio de «pendiente» — y porque
// el texto tiene que ser el mismo en los cuatro sitios o parecen cuatro problemas.
//
// Esto es solo el aviso: quien lo pinta con su acción es `GavetaLanzador`, que es
// el que sabe abrir la bandeja donde estés. Aquí no hay enlace a Tesorería a
// propósito — mandar al dueño a otra pantalla para que allí vuelva a pulsar era
// una recarga entera por una respuesta de dos palabras.
//
// Lo que NO lleva aviso es el deck del dossier: ahí lo lee un inversor, y las
// tareas pendientes del dueño no son asunto suyo. Esa honestidad se resuelve
// antes, al congelar el snapshot y al publicar. Ver `DossierEditor`.
//
// ── Forma ────────────────────────────────────────────────────────────────────
// La del resto de avisos con acción del portal (`ReservasView`, `ProductosView`,
// `AvisoContabilidad`): `alert alert-warning alert-cta` + `.alert-titulo` con el
// hecho + el cuerpo explicando, y la acción en `.btn-aviso btn-sm`. Sin icono en el
// texto (ninguno de esos lo lleva; el color ya dice el tono) y **sin clase de
// margen**: `.alert` ya trae `margin-bottom: var(--space-4)`, y ponerle un `mb-3`
// encima lo dejaría más pegado a lo de abajo que cualquier otro aviso del portal.

import { textoAvisoGaveta, type ResumenGaveta } from '@/lib/caja/pendientes'

export default function AvisoGaveta({
  resumen, onAbrir, className, nota, cargando,
}: {
  resumen:    ResumenGaveta
  onAbrir:    () => void
  /** La bandeja se está pidiendo al servidor. En Cuba, un botón que no dice nada
   *  al pulsarlo se pulsa tres veces más. */
  cargando?:  boolean
  /** Solo para excepciones de colocación (p. ej. `mt-3` si va pegado a un bloque). */
  className?: string
  /**
   * Sustituye el cuerpo. El hecho («faltan N por X CUP») es el mismo en todas partes
   * y sale de `textoAvisoGaveta`; lo que cambia es la CONSECUENCIA, y en el dossier
   * no es la misma que en Gastos: allí falta dinero de una tabla, aquí se le está
   * enseñando a un inversor un resultado inflado.
   */
  nota?:      string
}) {
  if (resumen.n === 0) return null

  // La antigüedad es lo que convierte el aviso en algo que se atiende: «3
  // operaciones» se pospone, «desde hace 12 días» no. Solo se dice a partir de una
  // semana, para no meter prisa por lo de ayer. El número viene calculado del
  // servidor (ver `ResumenGaveta.dias`).
  const antiguo = resumen.dias >= 7
    ? ` La más antigua lleva ${resumen.dias} días esperando.`
    : ''

  return (
    <div className={`alert alert-warning alert-cta${className ? ` ${className}` : ''}`}>
      <div className="alert-cta-texto">
        <strong className="alert-titulo">
          Tu punto de venta registró {textoAvisoGaveta(resumen)}
        </strong>
        {nota ?? 'Hasta que digas qué fue cada una, ese dinero no aparece en tu estado de resultados.'}
        {antiguo}
      </div>
      <button type="button" className="btn btn-aviso btn-sm" onClick={onAbrir} disabled={cargando}>
        {cargando
          ? <><span className="spinner spinner-sm" /> Abriendo…</>
          : 'Clasificarlas'}
      </button>
    </div>
  )
}
