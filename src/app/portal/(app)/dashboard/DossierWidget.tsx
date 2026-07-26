import Link from 'next/link'
import { Presentation, AlertTriangle } from 'lucide-react'
import type { DossierResumen } from '@/app/actions/portal/dashboard'
import { TZ_NEGOCIO } from '@/lib/fecha-tz'

// Widget del Dossier del negocio.
//
// NO pinta cifras del negocio a propósito: los ingresos y el margen ya están en
// Contabilidad, y repetirlos aquí con otro corte (el del snapshot congelado, que
// puede ser de hace un mes) sería enseñar dos verdades del mismo dato en la misma
// pantalla. Lo que este módulo tiene que responder de un vistazo es otra cosa:
// ¿el documento que reparto está publicado y dice números de hoy?

/** «hace 3 días» / «hoy». Sin horas: en un snapshot de meses, el reloj sobra. */
function haceCuanto(iso: string | null): string {
  if (!iso) return 'sin congelar'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'sin congelar'
  const dias = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (dias <= 0) return 'hoy'
  if (dias === 1) return 'ayer'
  if (dias < 30) return `hace ${dias} días`
  const fecha = new Intl.DateTimeFormat('es-ES', {
    timeZone: TZ_NEGOCIO, day: '2-digit', month: 'short', year: 'numeric',
  }).format(d)
  return fecha
}

export default function DossierWidget({ data }: { data: DossierResumen }) {
  return (
    <section className="card dash-card-sm">
      <div className="card-header">
        <div className="dash-card-head">
          <span className="dash-card-icon metric-icon-purple"><Presentation size={18} /></span>
          <h2 className="card-title">Dossier del negocio</h2>
        </div>
        <Link href="/portal/dossier" className="btn btn-secondary btn-sm">
          {data.vacio ? 'Crear dossier' : 'Ver dossier'}
        </Link>
      </div>

      {data.vacio ? (
        <p className="dash-muted">
          Convierte tus números en una presentación y un estado de resultados para enseñar
          a un inversor, un banco o un socio.
        </p>
      ) : (
        <>
          <div className="dash-kpis">
            <div className="dash-kpi">
              <span className="dash-kpi-label">{data.total === 1 ? 'Dossier' : 'Dossiers'}</span>
              <span className="dash-kpi-value">{data.total}</span>
            </div>
            <div className="dash-kpi">
              <span className="dash-kpi-label">Publicados</span>
              <span className="dash-kpi-value">{data.publicados}</span>
            </div>
          </div>

          <p className="dash-muted">
            {data.titulo && <>{data.titulo} · </>}
            Números actualizados {haceCuanto(data.ultimoSnapshot)}
          </p>

          {/* La única cifra accionable del widget. Mismo criterio que el aviso de
              la campana (`snapshot_stale` o más de 45 días), para que los dos no
              se contradigan. Solo cuenta lo PUBLICADO: un borrador con números
              viejos no lo ve nadie. */}
          {data.desfasados > 0 && (
            <p className="dash-alerta">
              <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
              {data.desfasados === 1
                ? 'Tu enlace publicado muestra números viejos.'
                : `${data.desfasados} enlaces publicados muestran números viejos.`}
              {' '}Actualízalos antes de volver a compartirlos.
            </p>
          )}

          {data.publicados === 0 && data.desfasados === 0 && (
            <p className="dash-muted">Aún no has publicado ninguno: nadie puede verlo todavía.</p>
          )}
        </>
      )}
    </section>
  )
}
