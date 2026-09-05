'use client'

import { useEffect } from 'react'
import { esTokenValido } from '@/lib/publico/token'
import { montarReveal, montarImpresion, enviarAcuse } from '@/lib/publico/reveal'

// Todo el JS de la propuesta cabe aquí porque el trabajo lo hace `lib/publico/
// reveal.ts`, común con el deck del dossier. Sin contadores que fijar antes de
// imprimir —esta presentación no anima cifras—, así que `montarImpresion` no
// necesita preparar nada.

export default function PropuestaReveal() {
  useEffect(() => montarReveal({
    raiz: '.pp-page', slide: '.pp-slide', dot: '.pp-nav-dot', claseAnim: 'pp-anim',
  }), [])

  useEffect(() => { enviarAcuse('p', esTokenValido) }, [])

  useEffect(() => montarImpresion(), [])

  return (
    // El print() se DIFIERE fuera del handler (setTimeout 0): `window.print()` es
    // síncrono y bloquea el hilo ~segundos mientras el navegador pagina — medido
    // como INP de ~3 s. Sacándolo del evento, la interacción devuelve al instante.
    <button type="button" className="pp-print-btn" onClick={() => setTimeout(() => window.print(), 0)}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      PDF
    </button>
  )
}
