'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { TriangleAlert } from 'lucide-react'

/**
 * Una pantalla del portal que se cae. Antes esto era la pantalla en blanco del
 * navegador y un cliente sin nada que hacer más que cerrar la pestaña.
 *
 * `retry()` vuelve a pedir el contenido del segmento sin recargar la página
 * entera: en Cuba, un fallo de red a mitad de una consulta es lo más probable, y
 * reintentar suele bastar. Va envuelto en una transición para que el botón se
 * apague mientras tanto (indicador de carga, skills/ui/SKILL.md §5).
 *
 * OJO: esta frontera envuelve la PÁGINA, no el layout de su propio segmento. Si
 * lo que revienta es `(app)/layout.tsx` —la sesión, el catálogo de módulos—, el
 * error sube por encima de aquí y no lo ve nadie.
 */
export default function PortalError({
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
            <Link href="/portal/dashboard" className="btn btn-secondary">Ir al Dashboard</Link>
          </div>
          {error.digest && <p className="nf-referencia">Referencia: {error.digest}</p>}
        </div>
      </div>
    </div>
  )
}
