import { NIVELES } from '@/lib/niveles'
import { DIMENSIONES_LIMITE, etiquetaDimension, type Dimension } from '@/lib/limites'
import { topesDeNiveles } from './topes'

/**
 * La tabla de topes por nivel que una ficha inserta con
 * ```claux:limites:productos,almacenes``` (sin claves, las diez).
 *
 * Server component, hermano de los diagramas: lo que pinta no es texto del
 * manual sino dato del sistema, leído de `nivel_limites` en cada visita.
 *
 * Si la matriz no se puede leer NO se pinta una tabla de huecos: la ficha sigue
 * explicando de qué depende el tope, que es lo que hay que saber para vender, y
 * quien necesite la cifra exacta la mira en `/admin/niveles`. Media tabla en un
 * manual de ventas se lee como «el nivel Pro no tiene ese límite».
 */

/** La etiqueta de la dimensión viene en minúscula, pensada para meterla dentro
 *  de una frase («te caben 200 productos»); aquí encabeza una fila. */
function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Un tope sin número no es un hueco: es el nivel que no lo tiene. */
function celda(valor: number | null | undefined): string {
  if (valor === null) return 'Sin tope'
  if (valor === undefined) return '—'
  return valor.toLocaleString('es-ES')
}

export default async function Limites({ dims, caption }: { dims?: string; caption?: string }) {
  const pedidas = (dims ?? '').split(',').map(d => d.trim()).filter(Boolean)
  // Una clave mal escrita se ignora en vez de pintar una fila vacía con su
  // nombre: el error se ve como una fila que falta, no como un tope inventado.
  const lista = (pedidas.length ? pedidas : DIMENSIONES_LIMITE)
    .filter((d): d is Dimension => (DIMENSIONES_LIMITE as string[]).includes(d))
  if (lista.length === 0) return null

  const { matriz, nombresNivel } = await topesDeNiveles()
  if (Object.keys(matriz).length === 0) return null

  return (
    <figure className="acad-dia acad-limites">
      <figcaption className="acad-dia-cap">{caption ?? 'Lo que cabe en cada nivel'}</figcaption>
      <div className="acad-table-wrap">
        <table className="acad-table">
          <thead>
            <tr>
              <th scope="col">Tope</th>
              {NIVELES.map(n => <th scope="col" key={n}>{nombresNivel[n]}</th>)}
            </tr>
          </thead>
          <tbody>
            {lista.map(dim => (
              <tr key={dim}>
                <th scope="row">{capitalizar(etiquetaDimension(dim))}</th>
                {NIVELES.map(n => <td key={n}>{celda(matriz[n]?.[dim])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
