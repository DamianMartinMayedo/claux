'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { TriangleAlert } from 'lucide-react'

/** Igual que la del portal, dentro del shell del admin. */
export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const [reintentando, startTransition] = useTransition()

  return (
    <div className="view-container">
      <div className="card">
        <div className="nf-bloque">
          <TriangleAlert size={48} strokeWidth={1.5} />
          <h1 className="nf-titulo">No se pudo cargar esta pantalla</h1>
          <div className="nf-acciones">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => startTransition(() => retry())}
              disabled={reintentando}
            >
              {reintentando ? <><span className="spinner spinner-sm" /> Reintentando…</> : 'Reintentar'}
            </button>
            <Link href="/admin/dashboard" className="btn btn-secondary">Ir al Dashboard</Link>
          </div>
          {error.digest && <p className="nf-referencia">Referencia: {error.digest}</p>}
        </div>
      </div>
    </div>
  )
}
