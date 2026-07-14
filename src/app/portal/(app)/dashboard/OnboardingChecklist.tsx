import Link from 'next/link'
import { Check } from 'lucide-react'
import type { OnboardingPaso } from '@/app/actions/portal/dashboard'

// Checklist horizontal de puesta en marcha del negocio. Muestra los pasos base
// (empresa, moneda, almacén…) según los módulos contratados: los cumplidos van
// tachados con check, los pendientes son enlaces directos a la acción. No oculta
// los widgets del dashboard; solo guía el orden de configuración. En móvil la fila
// de pasos hace scroll horizontal.
export default function OnboardingChecklist({ pasos }: { pasos: OnboardingPaso[] }) {
  const hechos = pasos.filter(p => p.hecho).length

  return (
    <section className="onb" role="region" aria-label="Primeros pasos">
      <div className="onb-head">
        <h2 className="onb-title">Primeros pasos</h2>
        <span className="onb-progreso">{hechos} de {pasos.length}</span>
      </div>
      <ol className="onb-pasos">
        {pasos.map((p, i) => (
          <li key={p.clave} className={`onb-paso${p.hecho ? ' onb-paso-hecho' : ''}`}>
            <span className="onb-num" aria-hidden>
              {p.hecho ? <Check size={13} strokeWidth={3} /> : i + 1}
            </span>
            {p.hecho
              ? <span className="onb-label">{p.label}</span>
              : <Link href={p.href} className="onb-label onb-link">{p.label}</Link>}
          </li>
        ))}
      </ol>
    </section>
  )
}
