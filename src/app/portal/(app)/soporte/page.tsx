import { obtenerFaqPortal, type Faq } from '@/app/actions/portal/soporte'
import SoporteContactForm from './SoporteContactForm'

export const dynamic = 'force-dynamic'

function FaqRow({ f }: { f: Faq }) {
  return (
    <details className="faq-item">
      <summary className="faq-q">{f.pregunta}</summary>
      <p className="faq-a">{f.respuesta}</p>
    </details>
  )
}

export default async function SoportePage() {
  const { generales, porModulo } = await obtenerFaqPortal()
  const sinFaq = generales.length === 0 && porModulo.length === 0

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Soporte</h1>
          <p className="page-subtitle">Preguntas frecuentes y contacto con el equipo CLAUX.</p>
        </div>
      </div>

      <div className="soporte-grid">
        {/* Preguntas frecuentes */}
        <div className="card">
          <h2 className="detail-section-title">Preguntas frecuentes</h2>
          {sinFaq ? (
            <p className="text-sm-muted">Aún no hay preguntas frecuentes disponibles.</p>
          ) : (
            <>
              {generales.length > 0 && (
                <div className="faq-group">
                  <h3 className="faq-group-title">Generales</h3>
                  {generales.map(f => <FaqRow key={f.id} f={f} />)}
                </div>
              )}
              {porModulo.map(g => (
                <div key={g.clave} className="faq-group">
                  <h3 className="faq-group-title">{g.nombre}</h3>
                  {g.items.map(f => <FaqRow key={f.id} f={f} />)}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Contacto */}
        <div className="card">
          <h2 className="detail-section-title">Contacta con nosotros</h2>
          <p className="text-sm-muted mb-3">
            ¿No encuentras respuesta? Escríbenos y te ayudamos. Recibiremos tu mensaje en el panel de CLAUX.
          </p>
          <SoporteContactForm />
        </div>
      </div>
    </div>
  )
}
