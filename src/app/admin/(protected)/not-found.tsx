import Link from 'next/link'
import { SearchX } from 'lucide-react'

/** Igual que la del portal, dentro del shell del admin. */
export default function AdminNoEncontrado() {
  return (
    <div className="view-container">
      <div className="card">
        <div className="nf-bloque">
          <SearchX size={48} strokeWidth={1.5} />
          <h1 className="nf-titulo">Esta página no existe</h1>
          <Link href="/admin/dashboard" className="btn btn-primary">Ir al Dashboard</Link>
        </div>
      </div>
    </div>
  )
}
