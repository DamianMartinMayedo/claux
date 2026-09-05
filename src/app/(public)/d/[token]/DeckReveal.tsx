'use client'

import { useEffect } from 'react'
import { localeDe, fmtNumL, fmtPctL, type Lang } from '@/lib/dossier/deck-i18n'
import { esTokenValido } from '@/lib/publico/token'
import { montarReveal, montarImpresion, enviarAcuse } from '@/lib/publico/reveal'

// Lo específico del deck del dossier. El reveal, el punto activo, el teclado, la
// impresión y el acuse son comunes con la propuesta y viven en
// `lib/publico/reveal.ts`; aquí quedan las dos cosas que solo tiene el dossier:
// el conteo de cifras y el botón ES/EN.

// Idioma activo del deck (lo fija `data-lang` en `.dp-page`; 'es' por defecto).
function langActual(): Lang {
  return document.querySelector('.dp-page')?.getAttribute('data-lang') === 'en' ? 'en' : 'es'
}

// Texto final de un contador, en el idioma activo. Lo usan el conteo al terminar y
// `beforeprint`, para que una cifra a medias no se congele en el PDF.
function textoFinal(el: HTMLElement): string {
  const objetivo = parseFloat(el.dataset.count ?? '')
  if (Number.isNaN(objetivo)) return el.textContent ?? ''
  const dec = parseInt(el.dataset.dec ?? '0', 10)
  return fmtNumL(objetivo, dec, langActual()) + (el.dataset.suf ?? '')
}

// Conteo de un número de 0 → objetivo (easeOutCubic), formateado en el idioma activo.
function contar(el: HTMLElement) {
  const objetivo = parseFloat(el.dataset.count ?? '')
  if (Number.isNaN(objetivo)) return
  const dec = parseInt(el.dataset.dec ?? '0', 10)
  const suf = el.dataset.suf ?? ''
  const fmt = new Intl.NumberFormat(localeDe(langActual()), { minimumFractionDigits: dec, maximumFractionDigits: dec })
  const dur = 1100
  let inicio: number | null = null
  const paso = (ts: number) => {
    if (inicio == null) inicio = ts
    const t = Math.min(1, (ts - inicio) / dur)
    const e = 1 - Math.pow(1 - t, 3)
    el.textContent = fmt.format(objetivo * e) + suf
    if (t < 1) requestAnimationFrame(paso)
    else el.textContent = textoFinal(el)
  }
  requestAnimationFrame(paso)
}

export default function DeckReveal() {
  useEffect(() => montarReveal({
    raiz: '.dp-page',
    slide: '.dp-slide',
    dot: '.dp-nav-dot',
    claseAnim: 'dp-anim',
    // Al revelar una diapositiva, sus números suben o bajan hasta su valor.
    alRevelar: (s) => s.querySelectorAll<HTMLElement>('[data-count]').forEach(contar),
  }), [])

  // Acuse de lectura. La clave de sessionStorage se mantiene («dossier-») para no
  // contar una apertura de más a quien tuviese el deck abierto al desplegar.
  useEffect(() => { enviarAcuse('d', esTokenValido, 'dossier') }, [])

  // ── Botón ES/EN en vivo ──
  // Solo existe cuando el deck trae versión inglesa (`.dp-lang`). El texto lo
  // intercambia el CSS (clases lang-es/lang-en); aquí solo cambiamos `data-lang` y
  // reformateamos los NÚMEROS y PORCENTAJES al idioma activo (es-ES ↔ en-US).
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.dp-page')
    if (!root) return
    const botones = Array.from(root.querySelectorAll<HTMLElement>('.dp-lang-btn'))
    if (botones.length === 0) return

    const setLang = (lang: Lang) => {
      root.setAttribute('data-lang', lang)
      botones.forEach(b => b.classList.toggle('is-activo', b.dataset.setLang === lang))
      root.querySelectorAll<HTMLElement>('[data-count]').forEach(el => {
        const objetivo = parseFloat(el.dataset.count ?? '')
        if (Number.isNaN(objetivo)) return
        const dec = parseInt(el.dataset.dec ?? '0', 10)
        el.textContent = fmtNumL(objetivo, dec, lang) + (el.dataset.suf ?? '')
      })
      root.querySelectorAll<HTMLElement>('[data-pct]').forEach(el => {
        const v = parseFloat(el.dataset.pct ?? '')
        if (!Number.isNaN(v)) el.textContent = fmtPctL(v, lang)
      })
    }

    const onClick = (e: Event) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.dp-lang-btn')
      if (!b?.dataset.setLang) return
      setLang(b.dataset.setLang === 'en' ? 'en' : 'es')
    }
    for (const b of botones) b.addEventListener('click', onClick)
    return () => { for (const b of botones) b.removeEventListener('click', onClick) }
  }, [])

  // PDF. El único agujero que el CSS no puede tapar son los contadores: imprimir
  // con una cifra a medio contar la congelaría a medias.
  useEffect(() => montarImpresion(() => {
    document.querySelectorAll<HTMLElement>('[data-count]').forEach(el => { el.textContent = textoFinal(el) })
  }), [])

  return (
    // El print() se DIFIERE fuera del handler (setTimeout 0): `window.print()` es
    // síncrono y bloquea el hilo ~segundos mientras el navegador pagina — medido como
    // INP de ~3 s en Vercel. Sacándolo del evento, la interacción devuelve al instante
    // y el diálogo abre en el siguiente tick; el usuario no nota diferencia.
    <button type="button" className="dp-print-btn" onClick={() => setTimeout(() => window.print(), 0)}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      PDF
    </button>
  )
}
