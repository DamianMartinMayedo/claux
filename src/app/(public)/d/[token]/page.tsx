import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import type { CSSProperties, ReactNode } from 'react'
import { obtenerDeckPublico } from '@/app/actions/portal/dossier'
import { estadoDeResultados, notaConversion, congeladoA } from '@/lib/dossier/estado'
import { proyectar, etiquetaMes } from '@/lib/dossier/snapshot'
import { geometriaGrafico } from '@/lib/dossier/grafico'
import { derivarPaleta, paletaVars } from '@/lib/dossier/paleta'
import { SECCIONES_RELATO } from '@/lib/dossier/secciones'
import DeckReveal from './DeckReveal'
import './dossier-publica.css'

// ── Deck público del dossier — /d/<token> ────────────────────────────────────
//
// RUTA `/d/`, no `/[slug]/…`: funciona para un cliente SIN slug y no filtra la
// identidad del negocio en la URL. INVARIANTE que no vive aquí: `/d/` no colisiona
// con `(public)/[slug]/` porque los slugs exigen ≥2 caracteres (guardarSlug).
//
// PRESENTACIÓN a pantalla completa: cada bloque importante es un "slide" que ocupa
// la pantalla; se pasa con scroll (scroll-snap) o clic (rail de puntos). Números
// que cuentan, barras que se llenan, gráfico que se dibuja — pero SIEMPRE legible
// sin JS: todo eso es opt-in bajo `.dp-anim` (ver DeckReveal). Presupuesto duro
// < 100 KB (skill UI §6): CSS + un único archivo JS pequeño, sin librerías.
//
// Snapshot CONGELADO → sin revalidación por tiempo; se revalida por evento.
export const revalidate = false

interface Props {
  params: Promise<{ token: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params
  const deck = await obtenerDeckPublico(token)
  if (!deck) return { robots: { index: false, follow: false } }
  return {
    title: `${deck.nombre} — Dossier`,
    description: `Presentación de ${deck.nombre} para inversores.`,
    // Enlace privado (capability URL): no se indexa ni deja el token en el Referer.
    robots: { index: false, follow: false, nocache: true },
    referrer: 'no-referrer',
    icons: {
      icon: [
        { url: '/favicon.svg', type: 'image/svg+xml' },
        { url: '/favicon.png', type: 'image/png' },
      ],
    },
  }
}

const nf = (dec: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec })
const fmtPct = (n: number) => `${n.toFixed(1).replace('.', ',')} %`

function fechaLarga(f: string | null): string {
  if (!f) return ''
  const [y, m, d] = f.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Número grande con conteo (el JS lo anima al entrar; sin JS ya muestra el final).
function Cifra({ valor, dec = 0, suf = '', label }: { valor: number; dec?: number; suf?: string; label: string }) {
  return (
    <div className="dp-kpi">
      <span className="dp-kpi-num" data-count={valor} data-dec={dec} data-suf={suf}>{nf(dec).format(valor)}{suf}</span>
      <span className="dp-kpi-label">{label}</span>
    </div>
  )
}

// Barra que se llena hasta su proporción de los ingresos (--bar-w es runtime).
function Barra({ label, monto, ingresos, moneda, tono }: { label: string; monto: number; ingresos: number; moneda: string; tono: string }) {
  const pct = ingresos > 0 ? Math.max(0, Math.min(100, (monto / ingresos) * 100)) : 0
  return (
    <div className="dp-bar">
      <div className="dp-bar-head">
        <span className="dp-bar-label">{label}</span>
        <span className="dp-bar-monto" data-count={monto} data-dec={0} data-suf={` ${moneda}`}>{nf(0).format(monto)} {moneda}</span>
      </div>
      <div className="dp-bar-track">
        <div className="dp-bar-fill" data-tono={tono} style={{ '--bar-w': `${pct}%` } as CSSProperties} />
      </div>
      <span className="dp-bar-pct">{fmtPct(pct)}</span>
    </div>
  )
}

export default async function DeckPage({ params }: Props) {
  const { token } = await params
  const deck = await obtenerDeckPublico(token)
  if (!deck) notFound()   // despublicado o revocado → 404

  const paleta = derivarPaleta(deck.color)
  const er = estadoDeResultados(deck.serie, deck.lineas)
  const nota = notaConversion(deck.moneda, deck.tasas, deck.faltantes)

  const historico = deck.serie.map(f => f.ingresos)
  const futuro = proyectar(deck.serie, deck.crecimientoPct, 12)
  // SVG inline en SERVIDOR: 12 puntos son aritmética de path. recharts pesaría
  // ~100 KB — más que el presupuesto entero de esta página.
  const g = geometriaGrafico(historico, futuro, { ancho: 720, alto: 260 })
  const fronteraX = historico.length > 0 && futuro.length > 0 ? g.puntos[historico.length - 1]?.x ?? null : null

  const texto = new Map(deck.secciones.map(s => [s.clave, s.cuerpo]))
  const seccion = (clave: string) => (texto.get(clave) ?? '').trim()
  const periodo = deck.periodoDesde && deck.periodoHasta
    ? `${fechaLarga(deck.periodoDesde)} — ${fechaLarga(deck.periodoHasta)}`
    : ''
  const ultimoProy = futuro.length ? futuro[futuro.length - 1] : 0

  // ── Secuencia de slides ──
  // Narrativa de pitch: problema → solución → mercado → NÚMEROS → modelo →
  // proyección → equipo → cierre. Cada relato solo aparece si el dueño lo escribió.
  const slides: { id: string; label: string; node: ReactNode }[] = []

  slides.push({
    id: 'portada', label: 'Portada',
    node: (
      <div className="dp-portada">
        {deck.logoUrl && (
          /* eslint-disable-next-line @next/next/no-img-element -- next/image
             arrastraría el optimizador a una ruta con presupuesto de 100 KB; el
             logo ya viene optimizado a WebP 400px por el pipeline de subida. */
          <img src={deck.logoUrl} alt="" className="dp-logo" width={88} height={88} />
        )}
        <span className="dp-kicker">Dossier para inversores</span>
        <h1 className="dp-titulo">{deck.nombre}</h1>
        {periodo && <p className="dp-periodo">{periodo}</p>}
        <span className="dp-scroll-hint" aria-hidden="true">Desliza</span>
      </div>
    ),
  })

  const relatoSlide = (clave: string, etiqueta: string) => ({
    id: clave, label: etiqueta,
    node: (
      <div className={`dp-relato${clave === 'cierre' ? ' dp-relato-cierre' : ''}`}>
        <span className="dp-kicker">{etiqueta}</span>
        <p className="dp-relato-cuerpo">{seccion(clave)}</p>
      </div>
    ),
  })

  // Relato "antes" de los números (problema, solución, mercado).
  for (const s of SECCIONES_RELATO) {
    if (s.orden > 40 || !seccion(s.clave)) continue
    slides.push(relatoSlide(s.clave, s.etiqueta))
  }

  // Tracción: números grandes que cuentan. NO se pregunta, sale de la serie.
  if (deck.serie.length > 0) {
    slides.push({
      id: 'traccion', label: 'Tracción',
      node: (
        <div className="dp-bloque">
          <span className="dp-kicker">Tracción</span>
          <div className="dp-kpis">
            <Cifra valor={er.ingresos} suf={` ${deck.moneda}`} label="Ingresos del período" />
            <Cifra valor={er.margenBrutoPct} dec={1} suf=" %" label="Margen bruto" />
            <Cifra valor={er.resultadoNeto} suf={` ${deck.moneda}`} label="Resultado neto" />
            <Cifra valor={deck.serie.length} label={deck.serie.length === 1 ? 'Mes registrado' : 'Meses registrados'} />
          </div>
        </div>
      ),
    })

    // Desglose: barras que se llenan (cómo se reparte cada unidad de ingreso).
    if (er.ingresos > 0) {
      slides.push({
        id: 'desglose', label: 'Desglose',
        node: (
          <div className="dp-bloque">
            <span className="dp-kicker">De cada {deck.moneda} que entra</span>
            <h2 className="dp-bloque-titulo">Cómo se reparte</h2>
            <div className="dp-bars">
              <Barra label="Coste de ventas" monto={er.costoVentas} ingresos={er.ingresos} moneda={deck.moneda} tono="coste" />
              <Barra label="Gastos operativos" monto={er.gastosOperativos} ingresos={er.ingresos} moneda={deck.moneda} tono="gasto" />
              <Barra label="Resultado neto" monto={Math.max(0, er.resultadoNeto)} ingresos={er.ingresos} moneda={deck.moneda} tono="neto" />
            </div>
          </div>
        ),
      })
    }
  }

  // Proyección: el gráfico que se dibuja. Lo estimado va MARCADO, nunca colado.
  if (g.pathHistorico) {
    slides.push({
      id: 'proyeccion', label: 'Proyección',
      node: (
        <div className="dp-bloque">
          <span className="dp-kicker">Evolución y proyección</span>
          <figure className="dp-grafico">
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
            <figcaption className="dp-leyenda">
              <span className="dp-leyenda-item"><span className="dp-leyenda-marca" /> Real</span>
              {futuro.length > 0 && (
                <span className="dp-leyenda-item">
                  <span className="dp-leyenda-marca dp-leyenda-proy" />
                  Proyección ({fmtPct(deck.crecimientoPct)} mensual) — estimación del negocio, no un resultado
                </span>
              )}
            </figcaption>
          </figure>
        </div>
      ),
    })
  }

  // Relato "después" de los números (modelo, equipo, cierre).
  for (const s of SECCIONES_RELATO) {
    if (s.orden <= 40 || !seccion(s.clave)) continue
    slides.push(relatoSlide(s.clave, s.etiqueta))
  }

  // Pie técnico: la promesa del módulo (mismos números que el PDF, congelados).
  slides.push({
    id: 'datos', label: 'Datos',
    node: (
      <div className="dp-pie">
        <p className="dp-pie-dato">{congeladoA(deck.snapshotAt)} · Importes en {deck.moneda}.</p>
        {nota && <p className="dp-pie-dato">{nota}</p>}
        <p className="dp-pie-marca">Hecho con CLAUX</p>
      </div>
    ),
  })

  return (
    // La paleta entra como custom properties en el wrapper; la hoja solo consume
    // var(--do-*) y trae sus propios fallbacks. Ninguna regla lleva el color escrito.
    <div className="dp-page" style={paletaVars(paleta)}>
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
