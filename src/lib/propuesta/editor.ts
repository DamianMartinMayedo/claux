// ── La propuesta armada, resumida para la pantalla de edición ───────────────
//
// El editor enseñaba once nombres de sección con una casilla al lado. Cierto y
// también inútil: qué dice «¿Qué es CLAUX?», qué capturas van a salir y en qué
// sitio, o qué texto lleva cada módulo, no se sabía sin abrir la presentación
// en otra pestaña —y las secciones que no se escriben aquí no se sabían nunca—.
//
// Esto no decide nada: recorre las diapositivas YA ARMADAS y las resume. Es el
// mismo motor que imprime el documento, así que lo que se lee en el editor es
// lo que se imprime, no una segunda versión que se pueda desincronizar.

import { importeClaux } from '@/lib/moneda-claux'
import { SECCIONES, seccionDe } from './secciones'
import type { Captura, Prefill, PropuestaResuelta, Slide } from './tipos'

/** Dónde se cambia una sección que no se escribe en el editor. */
export interface EnlaceOrigen {
  href:  string
  texto: string
}

export interface FilaSeccionEditor {
  clave:    string
  etiqueta: string
  /** Cuántas diapositivas emite HOY. Cero = no sale: oculta, o sin datos. */
  diapositivas: number
  /** Qué puesto ocupan en la presentación, contando desde la portada. `null` =
   *  no emite ninguna. Es lo que contesta «¿y esto dónde cae?», que con el
   *  recuento a secas no se sabía. */
  desde: number | null
  hasta: number | null
  /** Lo que lleva dentro, en líneas cortas y en su orden. */
  muestra:  string[]
  /** De dónde sale el texto, en una línea. */
  origen:   string
  enlace:   EnlaceOrigen | null
}

export interface CapturaEditor {
  id:     number
  modulo: string
  vista:  string
  url:    string
  alt:    string
  /** Su sitio en la presentación, contando desde la portada. `null` = está
   *  quitada de esta propuesta, así que hoy no sale en ningún sitio. */
  numero: number | null
}

export interface ModuloEditor {
  cuerpo:   string
  /** Escrito para ESTE negocio. Falso = tal cual está en el catálogo. */
  aMedida:  boolean
}

export interface ResumenEditor {
  prefill:   Prefill
  secciones: FilaSeccionEditor[]
  capturas:  CapturaEditor[]
  /** Cuerpo que sale por módulo. Sin entrada = ese módulo no llega a salir. */
  modulos:   Record<string, ModuloEditor>
  /** Diapositivas que tiene la presentación ahora mismo. */
  total:     number
}

const CONFIGURACION: EnlaceOrigen = { href: '/admin/ventas/propuestas/textos', texto: 'Textos de la presentación' }
const CATALOGO:      EnlaceOrigen = { href: '/admin/modulos',       texto: 'Catálogo de módulos' }
const CAPTURAS:      EnlaceOrigen = { href: '/admin/ventas/propuestas/capturas', texto: 'Biblioteca de capturas' }

/** De dónde sale cada sección. Lo que no se edita aquí dice dónde se edita. */
const ORIGEN: Record<string, { origen: string; enlace: EnlaceOrigen | null }> = {
  portada:           { origen: 'Título, negocio y firma de esta pantalla.', enlace: null },
  entendimos:        { origen: 'Se prellena del diagnóstico. Lo de esta pantalla manda.', enlace: null },
  que_es:            { origen: 'Texto fijo, igual en todas las propuestas.', enlace: CONFIGURACION },
  problema:          { origen: 'La columna de hoy, de esta pantalla. La de CLAUX es fija.', enlace: CONFIGURACION },
  pensado:           { origen: 'Del catálogo, salvo lo que escribas a medida aquí.', enlace: CATALOGO },
  capturas:          { origen: 'De la biblioteca, por módulo y sector del negocio.', enlace: CAPTURAS },
  precios:           { origen: 'Precios del catálogo en el nivel de esta propuesta.', enlace: CATALOGO },
  tu_propuesta:      { origen: 'Del presupuesto vinculado. Sin presupuesto no sale.', enlace: null },
  como_se_configura: { origen: 'Fases del presupuesto. El cobro se escribe aquí.', enlace: null },
  confianza:         { origen: 'Texto fijo, igual en todas las propuestas.', enlace: CONFIGURACION },
  empecemos:         { origen: 'Pasos fijos, más el contacto de quien la firma.', enlace: CONFIGURACION },
}

/** Una línea por cosa que lleva la diapositiva dentro. */
function lineasDe(s: Slide): string[] {
  switch (s.tipo) {
    case 'portada':
      return [
        s.titulo,
        s.comercial
          ? [s.comercial.nombre, s.comercial.tel, s.comercial.email].filter(Boolean).join(' · ')
          : 'Sin firma: no se pinta el contacto',
      ]
    case 'lista':
      return s.puntos
    case 'tarjetas':
      return s.tarjetas.map(t => `${t.titulo} — ${t.cuerpo}`)
    case 'problema':
      return [...s.hoy.map(h => `Hoy · ${h}`), ...s.conClaux.map(c => `Con CLAUX · ${c}`)]
    case 'pensado':
      return s.modulos.map(m => `${m.nombre} — ${m.cuerpo}`)
    case 'captura':
      return [`${s.captura.modulo} · ${s.captura.vista}`]
    case 'precios':
      return [
        `${s.opciones.length} módulos con su precio`,
        `Lo propuesto: ${importeClaux(s.cuotaPropuesta, s.moneda)}/mes`,
        `${s.diasPrueba} días de prueba`,
        ...(s.descuentoAnualPct > 0 ? [`${s.descuentoAnualPct} % de descuento al año`] : []),
      ]
    case 'tu_propuesta':
      return [
        `Puesta en marcha: ${importeClaux(s.totalFinal, s.moneda)}`,
        `${s.horasTotal} h en ${s.fases.length} fase${s.fases.length === 1 ? '' : 's'}`,
        `Cuota: ${importeClaux(s.cuotaMensual, s.moneda)}/mes`,
      ]
    case 'fases':
      return [
        ...s.fases.map(f => `${f.etiqueta}${f.horas !== null ? ` — ${f.horas} h` : ''}`),
        s.pago,
      ]
    case 'empecemos':
      return s.pasos.map(p => p.titulo)
  }
}

export function resumirParaEditor(
  r: PropuestaResuelta, prefill: Prefill, candidatas: Captura[],
): ResumenEditor {
  // El puesto de cada diapositiva, que es lo que se pinta en el editor.
  const puesto = new Map<Slide, number>(r.slides.map((x, i) => [x, i + 1]))

  const secciones: FilaSeccionEditor[] = SECCIONES.map(s => {
    const suyas = r.slides.filter(x => seccionDe(x.clave) === s.clave)
    const o = ORIGEN[s.clave] ?? { origen: '', enlace: null }
    return {
      clave: s.clave,
      etiqueta: s.etiqueta,
      diapositivas: suyas.length,
      desde: suyas.length > 0 ? puesto.get(suyas[0])! : null,
      hasta: suyas.length > 0 ? puesto.get(suyas[suyas.length - 1])! : null,
      // Las capturas son la única sección cuyo orden INTERNO se toca, así que
      // cada línea dice en qué diapositiva cae: el resto van seguidas y con el
      // rango de la fila basta.
      muestra: s.clave === 'capturas'
        ? suyas.map(x => `${puesto.get(x)} · ${lineasDe(x)[0]}`)
        : suyas.flatMap(lineasDe),
      origen: o.origen,
      enlace: o.enlace,
    }
  })

  // Las que se emiten, en el orden en que se van a ver; detrás, las quitadas.
  // Se listan las CANDIDATAS y no las diapositivas porque una captura escondida
  // no genera diapositiva, y sin listarla no habría forma de volver a enseñarla.
  const numeros = new Map<number, number>()
  const modulos: Record<string, ModuloEditor> = {}
  r.slides.forEach((s, i) => {
    if (s.tipo === 'captura') numeros.set(s.captura.id, i + 1)
    if (s.tipo === 'pensado') {
      for (const m of s.modulos) modulos[m.clave] = { cuerpo: m.cuerpo, aMedida: m.a_medida }
    }
  })
  const capturas: CapturaEditor[] = [
    ...candidatas.filter(c => numeros.has(c.id))
      .sort((a, b) => numeros.get(a.id)! - numeros.get(b.id)!),
    ...candidatas.filter(c => !numeros.has(c.id)),
  ].map(c => ({
    id: c.id, modulo: c.modulo, vista: c.vista, url: c.url, alt: c.alt,
    numero: numeros.get(c.id) ?? null,
  }))

  return { prefill, secciones, capturas, modulos, total: r.slides.length }
}
