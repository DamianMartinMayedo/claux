import Link from 'next/link'
import type { AccesoRapido } from '@/app/actions/portal/dashboard'

// Fallback: cuando los módulos activos no tienen widget propio (p.ej. solo
// Documentos de imprenta), el dashboard ofrece accesos directos a sus pantallas.
export default function AccesosRapidos({ accesos }: { accesos: AccesoRapido[] }) {
  return (
    <section className="card dash-col-full">
      <div className="card-header">
        <h2 className="card-title">Accesos rápidos</h2>
      </div>
      {accesos.length === 0 ? (
        <p className="dash-muted">Tu cuenta está lista. Empieza por el menú lateral.</p>
      ) : (
        <div className="dash-accesos">
          {accesos.map(a => (
            <Link key={a.clave} href={a.ruta} className="dash-acceso">{a.label}</Link>
          ))}
        </div>
      )}
    </section>
  )
}
