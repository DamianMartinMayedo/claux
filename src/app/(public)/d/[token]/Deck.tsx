import type { CSSProperties, ReactNode } from 'react'
import type { DeckPublico } from '@/app/actions/portal/dossier'
import { estadoDeResultados, NOTA_COSTE_COMPRAS } from '@/lib/dossier/estado'
import { proyectar, etiquetaMes } from '@/lib/dossier/snapshot'
import { geometriaGrafico } from '@/lib/dossier/grafico'
import { derivarPaleta, paletaVars } from '@/lib/dossier/paleta'
import { SECCIONES_RELATO } from '@/lib/dossier/secciones'
import { DECK_LABELS, ETIQUETA_SECCION_EN, fechaLargaL, etiquetaMesL, fmtPctL } from '@/lib/dossier/deck-i18n'
import DeckReveal from './DeckReveal'
import './dossier-publica.css'

// ── Deck ensamblado — el MISMO render para el enlace público y la vista previa ──
//
// El componente no sabe de dónde viene el deck: recibe `DeckPublico` ya armado. Un
// solo render garantiza que la vista previa del dueño y lo que ve el inversor son
// idénticos, y que las dos versiones de idioma (ES/EN) salen del mismo sitio.
//
// BILINGÜE (`deck.tieneEn`): cuando hay versión inglesa, cada texto se pinta en los
// DOS idiomas (CSS enseña el activo) y el botón ES/EN los intercambia en vivo, sin
// recargar (el deck es caché de por vida). Los números/porcentajes/fechas se
// reformatean al idioma activo en cliente (DeckReveal). Sin EN, se pinta solo ES y el
// botón no aparece: el deck se comporta como siempre.
//
// PRESENTACIÓN a pantalla completa, legible sin JS (animaciones opt-in bajo `.dp-anim`).
// Presupuesto < 100 KB: CSS + un JS pequeño, sin librerías.

const nf = (dec: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec })
const fmtPct = (n: number) => fmtPctL(n, 'es')

// Resalta los números del relato en el color de acento — dan "impacto con cifras".
function resaltarNumeros(texto: string): ReactNode[] {
  const partes: ReactNode[] = []
  const re = /(?:\d[\d.,]*\d|\d)(?:\s?%)?/g   // 1.000 · 3,5 · 50 % · 12 (sin arrastrar el punto final)
  let last = 0, m: RegExpExecArray | null, i = 0
  while ((m = re.exec(texto)) !== null) {
    if (m.index > last) partes.push(texto.slice(last, m.index))
    partes.push(<span key={i++} className="dp-num-destacado">{m[0]}</span>)
    last = m.index + m[0].length
  }
  if (last < texto.length) partes.push(texto.slice(last))
  return partes
}

function tramoTexto(len: number): 'normal' | 'largo' {
  return len > 550 ? 'largo' : 'normal'
}

// El cuerpo se pinta con `white-space: pre-wrap`: cada salto y cada espaciо colgado
// se VE. Se normaliza igual en ES y EN para que un salto de más que meta la IA al
// traducir no abra un hueco solo en inglés — el idioma cambia el texto, no el espaciado.
function limpiarCuerpo(t: string): string {
  return t
    .replace(/[ \t]+\n/g, '\n')   // sin espacios colgando al final de cada línea
    .replace(/\n{3,}/g, '\n\n')   // como mucho UNA línea en blanco entre párrafos
    .trim()
}

function parseEquipo(cuerpo: string): { nombre: string; puesto: string }[] {
  return cuerpo.split(/\n+/).map(l => l.trim()).filter(Boolean).map(l => {
    const guion = l.match(/^(.+?)\s+[—–-]\s+(.+)$/)
    if (guion) return { nombre: guion[1].trim(), puesto: guion[2].trim() }
    const paren = l.match(/^(.+?)\s*\((.+)\)$/)
    if (paren) return { nombre: paren[1].trim(), puesto: paren[2].trim() }
    return { nombre: l, puesto: '' }
  })
}

function Cifra({ valor, dec = 0, unidad, label }: { valor: number; dec?: number; unidad?: string; label: ReactNode }) {
  return (
    <div className="dp-kpi">
      <span className="dp-kpi-valor">
        <span className="dp-kpi-num" data-count={valor} data-dec={dec}>{nf(dec).format(valor)}</span>
        {unidad && <span className="dp-kpi-unidad">{unidad}</span>}
      </span>
      <span className="dp-kpi-label">{label}</span>
    </div>
  )
}

function Barra({ label, monto, ingresos, moneda }: { label: ReactNode; monto: number; ingresos: number; moneda: string }) {
  const pct = ingresos > 0 ? Math.max(0, Math.min(100, (monto / ingresos) * 100)) : 0
  return (
    <div className="dp-bar">
      <div className="dp-bar-head">
        <span className="dp-bar-label">{label}</span>
        <span className="dp-bar-monto">
          <span data-count={monto} data-dec={0}>{nf(0).format(monto)}</span>
          <span className="dp-bar-moneda">{moneda}</span>
        </span>
      </div>
      <div className="dp-bar-track">
        <div className="dp-bar-fill" style={{ '--bar-w': `${pct}%` } as CSSProperties} />
      </div>
      <span className="dp-bar-pct" data-pct={pct}>{fmtPct(pct)}</span>
    </div>
  )
}

export default function Deck({ deck, borrador = false }: { deck: DeckPublico; borrador?: boolean }) {
  const paleta = derivarPaleta(deck.color)
  const er = estadoDeResultados(deck.serie, deck.lineas)
  const bi = deck.tieneEn
  const Les = DECK_LABELS.es, Len = DECK_LABELS.en

  // Etiqueta fija bilingüe: en modo bilingüe pinta las dos versiones (CSS enseña la
  // activa); si no, solo español. Cada versión conserva la clase de estilo.
  const bl = (es: string, en: string, cls?: string, Tag: 'span' | 'h2' | 'p' = 'span'): ReactNode => {
    if (!bi) return cls ? <Tag className={cls}>{es}</Tag> : <>{es}</>
    return (
      <>
        <Tag className={cls ? `${cls} lang-es` : 'lang-es'}>{es}</Tag>
        <Tag className={cls ? `${cls} lang-en` : 'lang-en'}>{en}</Tag>
      </>
    )
  }

  const historico = deck.serie.map(f => f.ingresos)
  const futuro = proyectar(deck.serie, deck.crecimientoPct, 12)
  const g = geometriaGrafico(historico, futuro, { ancho: 720, alto: 260 })
  const fronteraX = historico.length > 0 && futuro.length > 0 ? g.puntos[historico.length - 1]?.x ?? null : null

  const texto = new Map(deck.secciones.map(s => [s.clave, s.cuerpo]))
  const textoEn = new Map(deck.secciones.map(s => [s.clave, s.cuerpoEn ?? s.cuerpo]))
  const seccion = (clave: string) => limpiarCuerpo(texto.get(clave) ?? '')
  const seccionEn = (clave: string) => limpiarCuerpo(textoEn.get(clave) ?? '')
  const periodoEs = deck.periodoDesde && deck.periodoHasta
    ? `${fechaLargaL(deck.periodoDesde, 'es')} — ${fechaLargaL(deck.periodoHasta, 'es')}` : ''
  const periodoEn = deck.periodoDesde && deck.periodoHasta
    ? `${fechaLargaL(deck.periodoDesde, 'en')} — ${fechaLargaL(deck.periodoHasta, 'en')}` : ''
  const ultimoProy = futuro.length ? futuro[futuro.length - 1] : 0

  const slides: { id: string; label: string; node: ReactNode }[] = []

  slides.push({
    id: 'portada', label: 'Portada',
    node: (
      <div className="dp-portada">
        {deck.logoUrl && (
          /* eslint-disable-next-line @next/next/no-img-element -- next/image
             arrastraría el optimizador a una ruta con presupuesto de 100 KB. */
          <img src={deck.logoUrl} alt="" className="dp-logo" width={88} height={88} />
        )}
        {bl(Les.kickerPortada, Len.kickerPortada, 'dp-kicker')}
        <h1 className="dp-titulo">{deck.nombre}</h1>
        {(deck.resumenPortada || deck.resumenPortadaEn) && (
          bi
            ? <>
                {deck.resumenPortada && <p className="dp-resumen lang-es">{deck.resumenPortada}</p>}
                <p className="dp-resumen lang-en">{deck.resumenPortadaEn ?? deck.resumenPortada}</p>
              </>
            : deck.resumenPortada && <p className="dp-resumen">{deck.resumenPortada}</p>
        )}
        {periodoEs && bl(periodoEs, periodoEn, 'dp-periodo', 'p')}
        {bl(Les.desliza, Len.desliza, 'dp-scroll-hint')}
      </div>
    ),
  })

  const nodoRelato = (clave: string, etiquetaEs: string): ReactNode => {
    const cuerpo = seccion(clave)
    const cuerpoEn = seccionEn(clave)
    const etiquetaEn = ETIQUETA_SECCION_EN[clave] ?? etiquetaEs
    // Equipo jerarquizado: si viene como lista "Nombre — Puesto", cuadrícula.
    if (clave === 'equipo') {
      const miembros = parseEquipo(cuerpo)
      // EN alineado con ES por POSICIÓN: el nombre es un nombre propio (idéntico en
      // ambos idiomas) y solo el puesto se traduce. Así la cuadrícula tiene EXACTAMENTE
      // los mismos elementos aunque la IA reordene, funda o añada líneas al traducir.
      const miembrosEnRaw = parseEquipo(cuerpoEn)
      const miembrosEn = miembros.map((m, i) => ({ nombre: m.nombre, puesto: miembrosEnRaw[i]?.puesto || m.puesto }))
      const conPuesto = miembros.filter(m => m.puesto).length
      if (miembros.length > 0 && conPuesto >= 1 && conPuesto >= miembros.length - 1) {
        const grid = (ms: { nombre: string; puesto: string }[], lang?: 'es' | 'en') => (
          <div className={`dp-equipo-grid${lang ? ` lang-${lang}` : ''}`}>
            {ms.map((m, i) => (
              <div key={i} className="dp-equipo-item">
                <span className="dp-equipo-nombre">{m.nombre}</span>
                {m.puesto && <span className="dp-equipo-puesto">{m.puesto}</span>}
              </div>
            ))}
          </div>
        )
        return (
          <div className="dp-relato dp-equipo">
            {bl(etiquetaEs, etiquetaEn, 'dp-kicker')}
            {bi ? <>{grid(miembros, 'es')}{grid(miembrosEn, 'en')}</> : grid(miembros)}
          </div>
        )
      }
    }
    // El "tramo" (que fija espaciado/tamaño del bloque) se decide con la longitud del
    // cuerpo ES y se aplica IGUAL a las dos versiones: si cada idioma usara la suya,
    // ES y EN cruzarían el umbral en puntos distintos y el mismo slide se vería con
    // espaciados distintos según el idioma. El idioma cambia el texto, no la maqueta.
    const tramo = tramoTexto(cuerpo.length)
    const parrafo = (cuerpoTxt: string, lang?: 'es' | 'en') => (
      <p className={`dp-relato-cuerpo${lang ? ` lang-${lang}` : ''}`} data-largo={tramo}>
        {resaltarNumeros(cuerpoTxt)}
      </p>
    )
    return (
      <div className={`dp-relato${clave === 'cierre' ? ' dp-relato-cierre' : ''}`}>
        {bl(etiquetaEs, etiquetaEn, 'dp-kicker')}
        {bi ? <>{parrafo(cuerpo, 'es')}{parrafo(cuerpoEn, 'en')}</> : parrafo(cuerpo)}
      </div>
    )
  }

  const relatoSlide = (clave: string, etiqueta: string) => ({ id: clave, label: etiqueta, node: nodoRelato(clave, etiqueta) })

  for (const s of SECCIONES_RELATO) {
    if (s.orden > 40 || !seccion(s.clave)) continue
    slides.push(relatoSlide(s.clave, s.etiqueta))
  }

  if (deck.serie.length > 0) {
    slides.push({
      id: 'traccion', label: 'Tracción',
      node: (
        <div className="dp-bloque">
          {bl(Les.traccion, Len.traccion, 'dp-kicker')}
          <div className="dp-kpis">
            <Cifra valor={er.ingresos} unidad={deck.moneda} label={bl(Les.ingresosPeriodo, Len.ingresosPeriodo)} />
            <Cifra valor={er.margenBrutoPct} dec={1} unidad="%" label={bl(Les.margenBruto, Len.margenBruto)} />
            <Cifra valor={er.resultadoNeto} unidad={deck.moneda} label={bl(Les.resultadoNeto, Len.resultadoNeto)} />
            <Cifra valor={deck.serie.length} label={bl(Les.mesesRegistrados(deck.serie.length), Len.mesesRegistrados(deck.serie.length))} />
          </div>
        </div>
      ),
    })

    if (er.ingresos > 0) {
      slides.push({
        id: 'desglose', label: 'Desglose',
        node: (
          <div className="dp-bloque">
            {bl(Les.deCada(deck.moneda), Len.deCada(deck.moneda), 'dp-kicker')}
            {bl(Les.comoSeReparte, Len.comoSeReparte, 'dp-bloque-titulo', 'h2')}
            <div className="dp-bars">
              <Barra label={bl(Les.costeVentas, Len.costeVentas)} monto={er.costoVentas} ingresos={er.ingresos} moneda={deck.moneda} />
              <Barra label={bl(Les.gastosOperativos, Len.gastosOperativos)} monto={er.gastosOperativos} ingresos={er.ingresos} moneda={deck.moneda} />
              <Barra label={bl(Les.resultadoNeto, Len.resultadoNeto)} monto={Math.max(0, er.resultadoNeto)} ingresos={er.ingresos} moneda={deck.moneda} />
            </div>
            {deck.costeEsCompras && <p className="dp-detalle-nota">{NOTA_COSTE_COMPRAS}</p>}
          </div>
        ),
      })

      // «El detalle» = «En qué se va»: SOLO destinos del dinero. Los ingresos son el
      // 100 % (el denominador de los %), no un concepto de gasto — no van aquí.
      const detalle: { es: string; en: string; cats: typeof er.costoPorCategoria }[] = [
        { es: Les.costeVentas,     en: Len.costeVentas,     cats: er.costoPorCategoria },
        { es: Les.gastosPersonal,  en: Len.gastosPersonal,  cats: er.personalPorCategoria },
        { es: Les.gastosOperativos, en: Len.gastosOperativos, cats: er.gastosPorCategoria },
        { es: Les.otros,           en: Len.otros,           cats: er.otrosPorCategoria },
      ].filter(grp => grp.cats.length > 0)

      if (deck.estadoModo === 'DESGLOSADO' && detalle.length > 0) {
        slides.push({
          id: 'detalle', label: 'Detalle',
          node: (
            <div className="dp-bloque">
              {bl(Les.elDetalle, Len.elDetalle, 'dp-kicker')}
              {bl(Les.enQueSeVa, Len.enQueSeVa, 'dp-bloque-titulo', 'h2')}
              <div className="dp-detalle">
                {detalle.map(grp => (
                  <div key={grp.es} className="dp-detalle-grupo">
                    {bl(grp.es, grp.en, 'dp-detalle-titulo')}
                    <ul className="dp-detalle-lista">
                      {grp.cats.map(c => (
                        <li key={c.concepto} className="dp-detalle-fila">
                          {bl(c.concepto, c.conceptoEn || c.concepto, 'dp-detalle-concepto')}
                          <span className="dp-detalle-monto">
                            <span data-count={c.monto} data-dec={0}>{nf(0).format(c.monto)}</span>
                            <span className="dp-detalle-pct" data-pct={c.pct}>{fmtPct(c.pct)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              {bl(Les.notaDetalle(deck.moneda), Len.notaDetalle(deck.moneda), 'dp-detalle-nota', 'p')}
            </div>
          ),
        })
      }
    }
  }

  if (g.pathHistorico) {
    const rangoEs = `${etiquetaMes(deck.serie[0].mes)} — ${etiquetaMes(deck.serie[deck.serie.length - 1].mes)}`
    const rangoEn = `${etiquetaMesL(deck.serie[0].mes, 'en')} — ${etiquetaMesL(deck.serie[deck.serie.length - 1].mes, 'en')}`
    slides.push({
      id: 'proyeccion', label: 'Proyección',
      node: (
        <div className="dp-bloque">
          {bl(Les.evolucionProyeccion, Len.evolucionProyeccion, 'dp-kicker')}
          <figure className="dp-grafico">
            <div className="dp-grafico-caja">
              {bl(Les.ingresosEje(deck.moneda), Len.ingresosEje(deck.moneda), 'dp-eje-y')}
              <svg
                viewBox={`0 0 ${g.ancho} ${g.alto}`} className="dp-grafico-svg"
                role="img" preserveAspectRatio="none"
                aria-label={
                  futuro.length
                    ? `Ingresos de ${etiquetaMes(deck.serie[0].mes)} a ${etiquetaMes(deck.serie[deck.serie.length - 1].mes)}, y proyección a 12 meses hasta ${nf(0).format(ultimoProy)} ${deck.moneda}`
                    : `Ingresos de ${etiquetaMes(deck.serie[0].mes)} a ${etiquetaMes(deck.serie[deck.serie.length - 1].mes)}`
                }
              >
              <defs>
                <linearGradient id="dpAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop className="dp-grad-a" offset="0%" />
                  <stop className="dp-grad-b" offset="100%" />
                </linearGradient>
              </defs>
              {g.areaHistorico && <path d={g.areaHistorico} className="dp-area" />}
              {fronteraX != null && <line x1={fronteraX} y1={0} x2={fronteraX} y2={g.alto} className="dp-divisor" />}
              <path d={g.pathHistorico} className="dp-linea" pathLength={1} />
              {g.pathProyectado && <path d={g.pathProyectado} className="dp-linea dp-linea-proy" />}
              </svg>
            </div>
            {bl(
              `${rangoEs}${futuro.length ? ` · ${Les.proyeccionMeses}` : ''}`,
              `${rangoEn}${futuro.length ? ` · ${Len.proyeccionMeses}` : ''}`,
              'dp-eje-x', 'p',
            )}
            <figcaption className="dp-leyenda">
              <span className="dp-leyenda-item"><span className="dp-leyenda-marca" /> {bl(Les.real, Len.real)}</span>
              {futuro.length > 0 && (
                <span className="dp-leyenda-item">
                  <span className="dp-leyenda-marca dp-leyenda-proy" />
                  {bl(Les.proyeccionLeyenda(fmtPctL(deck.crecimientoPct, 'es')), Len.proyeccionLeyenda(fmtPctL(deck.crecimientoPct, 'en')))}
                </span>
              )}
            </figcaption>
          </figure>
        </div>
      ),
    })
  }

  for (const s of SECCIONES_RELATO) {
    if (s.orden <= 40 || !seccion(s.clave)) continue
    slides.push(relatoSlide(s.clave, s.etiqueta))
  }

  slides.push({
    id: 'gracias', label: 'Gracias',
    node: (
      <div className="dp-gracias">
        <div className="dp-gracias-centro">
          {bl(Les.graciasTitulo, Len.graciasTitulo, 'dp-gracias-titulo', 'h2')}
          {deck.contactoEmail && (
            <a className="dp-gracias-email" href={`mailto:${deck.contactoEmail}`}>{deck.contactoEmail}</a>
          )}
        </div>
        {bl(Les.hechoCon, Len.hechoCon, 'dp-pie-marca', 'p')}
      </div>
    ),
  })

  return (
    // `data-lang="es"` inicial: el server pinta español; el botón lo cambia en vivo.
    <div className="dp-page" style={paletaVars(paleta)} data-lang="es">
      {borrador && <div className="dp-borrador" role="status">Vista previa · borrador (nadie más lo ve)</div>}
      {bi && (
        <div className="dp-lang" role="group" aria-label="Idioma / Language">
          <button type="button" className="dp-lang-btn is-activo" data-set-lang="es">ES</button>
          <button type="button" className="dp-lang-btn" data-set-lang="en">EN</button>
        </div>
      )}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <DeckReveal />

      <nav className="dp-nav" aria-label="Ir a una sección">
        {slides.map((s, i) => (
          <a key={s.id} href={`#${s.id}`} className="dp-nav-dot" data-i={i} aria-label={s.label}><span /></a>
        ))}
      </nav>

      {slides.map((s, i) => (
        <section key={s.id} id={s.id} className="dp-slide" data-bg={i % 2 === 0 ? 'color' : 'white'}>
          <div className="dp-slide-inner">{s.node}</div>
        </section>
      ))}
    </div>
  )
}
