import Link from 'next/link'

// Banner de captación en dashboards con pocos módulos: anima al dueño a activar
// más funcionalidades. "Contáctanos" lleva al formulario de soporte.
export default function ContratarMasBanner() {
  return (
    <section className="card dash-col-full dash-cta">
      <div className="dash-cta-body">
        <h2 className="card-title">Saca más partido a tu negocio</h2>
        <p className="dash-muted">
          Activa más módulos —contabilidad, inventario, reservas, personal o el
          asistente con IA— y gestiónalo todo desde un mismo lugar.
        </p>
      </div>
      <div className="dash-cta-action">
        <Link href="/portal/soporte" className="btn btn-primary">Contáctanos</Link>
      </div>
    </section>
  )
}
