import Link from 'next/link'
import { BookOpen, ChevronRight } from 'lucide-react'
import { obtenerSoportePortal, type Faq } from '@/app/actions/portal/soporte'
import { guiaDeModulo } from '@/lib/academia/ayuda-portal'
import { BASE_AYUDA } from '@/lib/academia/rutas'
import SoporteContacto from './SoporteContacto'
import SoportePie from './SoportePie'

/**
 * Ayuda y soporte: la puerta del cliente al manual.
 *
 * El orden es deliberado. Primero lo que resuelve la duda solo —las preguntas
 * frecuentes, y desde cada grupo el enlace a la guía completa de ese módulo—, y
 * escribirle al equipo como acción de la cabecera. Antes era al revés: medio
 * ancho de pantalla ocupado por un formulario en blanco, que invita a preguntar
 * lo que ya está contestado dos dedos más a la izquierda.
 *
 * Las guías se abren en una pestaña nueva a propósito: viven fuera del portal
 * (son públicas, sin sesión) y volver atrás obligaría a recargar el portal
 * entero. Con la conexión de Cuba eso son segundos que no hay que pagar.
 */

export const dynamic = 'force-dynamic'

function FaqRow({ f }: { f: Faq }) {
  return (
    <details className="faq-item">
      <summary className="faq-q">{f.pregunta}</summary>
      <p className="faq-a">{f.respuesta}</p>
    </details>
  )
}

/** Enlace a la guía completa del módulo, si esa pieza tiene ficha escrita. */
function EnlaceGuia({ clave, nombre }: { clave: string; nombre: string }) {
  const href = guiaDeModulo(clave)
  if (!href) return null
  return (
    <Link href={href} className="faq-group-guia enlace-lista" target="_blank" rel="noopener">
      Ver la guía de {nombre} <ChevronRight size={14} strokeWidth={2} />
    </Link>
  )
}

export default async function SoportePage({
  searchParams,
}: { searchParams: Promise<{ asunto?: string }> }) {
  const { generales, porModulo, modulos } = await obtenerSoportePortal()
  const sinFaq = generales.length === 0 && porModulo.length === 0
  // Los avisos del portal traen aquí con el asunto ya escrito
  // (?asunto=Quiero activar X) y el modal de contacto se abre solo.
  const { asunto } = await searchParams
  const asuntoInicial = (asunto ?? '').slice(0, 160)

  const guias = modulos
    .map(m => ({ ...m, href: guiaDeModulo(m.clave) }))
    .filter((m): m is typeof m & { href: string } => m.href !== null)

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Ayuda y soporte</h1>
          <p className="page-subtitle">
            Resuelve tu duda con las preguntas frecuentes y las guías, o escríbenos y te ayudamos.
          </p>
        </div>
        <div className="btn-group-wrap">
          <SoporteContacto asuntoInicial={asuntoInicial} abrirAlEntrar={asuntoInicial !== ''} />
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
                  <div className="faq-group-head">
                    <h3 className="faq-group-title">Generales</h3>
                  </div>
                  {generales.map(f => <FaqRow key={f.id} f={f} />)}
                </div>
              )}
              {porModulo.map(g => (
                <div key={g.clave} className="faq-group">
                  <div className="faq-group-head">
                    <h3 className="faq-group-title">{g.nombre}</h3>
                    <EnlaceGuia clave={g.clave} nombre={g.nombre} />
                  </div>
                  {g.items.map(f => <FaqRow key={f.id} f={f} />)}
                </div>
              ))}
            </>
          )}

          {/* Salida para lo que las preguntas no cubren, que es donde se llega
              tras leerlas todas: el asistente si está contratado, y si no, el
              mismo modal de contacto de la cabecera. */}
          <SoportePie />
        </div>

        {/* Centro de ayuda */}
        <div className="card">
          <h2 className="detail-section-title">Centro de ayuda</h2>
          <p className="text-sm-muted mb-3">
            Cómo se usa cada parte de CLAUX, paso a paso.
          </p>

          {guias.length > 0 && (
            <div className="soporte-guias">
              {guias.map(g => (
                <Link key={g.clave} href={g.href} className="soporte-guia enlace-lista" target="_blank" rel="noopener">
                  <BookOpen size={15} strokeWidth={2} className="flex-shrink-0" />
                  <span className="soporte-guia-nombre">{g.nombre}</span>
                  <ChevronRight size={15} strokeWidth={2} className="flex-shrink-0" />
                </Link>
              ))}
            </div>
          )}

          <Link href={BASE_AYUDA} className="btn btn-secondary btn-full mt-3" target="_blank" rel="noopener">
            Ver toda la ayuda
          </Link>
        </div>
      </div>
    </div>
  )
}
