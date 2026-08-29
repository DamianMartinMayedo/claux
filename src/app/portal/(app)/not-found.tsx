import Link from 'next/link'
import { SearchX } from 'lucide-react'

/**
 * Una pantalla del portal que no está: un enlace guardado de una versión
 * anterior, un documento borrado, una URL escrita a mano.
 *
 * Vive dentro de `(app)`, así que se pinta CON el shell —cabecera, menú, empresa
 * seleccionada—: quien se pierde sigue dentro de su portal, con todas las salidas
 * a la vista. Sin este archivo salía el 404 de Next: en inglés, en blanco y sin
 * un solo enlace del que tirar.
 */
export default function PortalNoEncontrado() {
  return (
    <div className="view-container">
      <div className="card">
        <div className="nf-bloque">
          <SearchX size={48} strokeWidth={1.5} />
          <h1 className="nf-titulo">Esta página no existe</h1>
          <Link href="/portal/dashboard" className="btn btn-primary">Ir al Dashboard</Link>
        </div>
      </div>
    </div>
  )
}
