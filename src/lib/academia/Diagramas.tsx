import { GRAFO } from './grafo'
import { CATALOGO } from './catalogo'

/**
 * Los tres diagramas de una ficha, dibujados solo con clases del design system
 * (`.acad-dia*` en 09-academia.css). Server component: sin estado, sin 'use
 * client'. Los datos salen del grafo por slug; si esa pieza no tiene el diagrama
 * pedido, no se pinta nada (la ficha sigue leyéndose igual).
 */

export type TipoDiagrama = 'flujo' | 'conexiones' | 'capas'

function nombreDe(slug: string): string {
  return CATALOGO.find(f => f.slug === slug)?.nombre ?? 'Este módulo'
}

export default function Diagrama({
  tipo, slug, caption,
}: { tipo: TipoDiagrama; slug: string; caption?: string }) {
  const g = GRAFO[slug]
  if (!g) return null

  if (tipo === 'flujo' && g.flujo) {
    const pasos = g.flujo.pasos
    return (
      <figure className="acad-dia acad-flujo">
        <figcaption className="acad-dia-cap">{caption ?? g.flujo.titulo}</figcaption>
        <ol className="acad-flujo-track">
          {pasos.map((p, i) => (
            <li className="acad-flujo-step" key={i}>
              <span className="acad-flujo-node">{i + 1}</span>
              <span className="acad-flujo-t">{p.titulo}</span>
              <span className="acad-flujo-d">{p.detalle}</span>
            </li>
          ))}
        </ol>
      </figure>
    )
  }

  if (tipo === 'conexiones' && g.conexiones) {
    const aristas = g.conexiones.aristas
    const recibe = aristas.filter(a => a.direccion === 'recibe')
    const entrega = aristas.filter(a => a.direccion === 'entrega')
    const ambos = aristas.filter(a => a.direccion === 'ambos')
    return (
      <figure className="acad-dia acad-conex">
        <figcaption className="acad-dia-cap">{caption ?? g.conexiones.titulo}</figcaption>
        {/* Rejilla de 3×2: los rótulos en su propia fila para que coincidan
            entre sí, y las tres columnas centradas para que los puntos medios
            —y por tanto las líneas que los unen— queden a la misma altura. */}
        <div className={`acad-conex-map${recibe.length ? ' con-entrada' : ''}${entrega.length ? ' con-salida' : ''}`}>
          <p className="acad-conex-col-label es-entrada">
            {recibe.length > 0 ? (g.conexiones.entradaTitulo ?? 'Le entra de') : ''}
          </p>
          <span aria-hidden="true" />
          <p className="acad-conex-col-label es-salida">
            {entrega.length > 0 ? (g.conexiones.salidaTitulo ?? 'Sale hacia') : ''}
          </p>

          <div className={`acad-conex-col es-entrada${recibe.length ? '' : ' esta-vacia'}`}>
            {recibe.map((a, i) => (
              <div className="acad-conex-node" key={i}>
                <span className="acad-conex-node-name">{a.otro}</span>
                <span className="acad-conex-node-que">{a.que}</span>
              </div>
            ))}
          </div>

          <div className="acad-conex-center">
            <span className="acad-conex-hub-node">{g.conexiones.hub || nombreDe(slug)}</span>
          </div>

          <div className={`acad-conex-col es-salida${entrega.length ? '' : ' esta-vacia'}`}>
            {entrega.map((a, i) => (
              <div className="acad-conex-node" key={i}>
                <span className="acad-conex-node-name">{a.otro}</span>
                <span className="acad-conex-node-que">{a.que}</span>
              </div>
            ))}
          </div>
        </div>

        {ambos.length > 0 && (
          <div className="acad-conex-both">
            <p className="acad-conex-col-label">Va y viene con</p>
            {ambos.map((a, i) => (
              <div className="acad-conex-node is-ambos" key={i}>
                <span className="acad-conex-node-name">{a.otro}</span>
                <span className="acad-conex-node-que">{a.que}</span>
              </div>
            ))}
          </div>
        )}
      </figure>
    )
  }

  if (tipo === 'capas' && g.capas) {
    const { nucleo, aportes } = g.capas
    return (
      <figure className="acad-dia acad-capas">
        <figcaption className="acad-dia-cap">{caption ?? g.capas.titulo}</figcaption>
        <div className="acad-capas-nucleo">
          <p className="acad-capas-titulo">{g.capas.nucleoTitulo ?? 'Funciona sola'}</p>
          <div className="acad-capas-items">
            {nucleo.map((n, i) => <span className="acad-capas-chip" key={i}>{n}</span>)}
          </div>
        </div>
        {aportes.length > 0 && (
          <div className="acad-capas-add">
            <p className="acad-capas-glabel">{g.capas.aportesTitulo ?? 'Y se llena sola cuando hay…'}</p>
            <div className="acad-capas-add-list">
              {aportes.map((a, i) => (
                <div className="acad-capas-add-item" key={i}>
                  <span className="acad-capas-de">{a.de}</span>
                  <span className="acad-capas-aporta">{a.aporta}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </figure>
    )
  }

  return null
}
