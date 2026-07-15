import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
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
// RUTA `/d/`, no `/[slug]/…`, por dos razones:
//   1. Funciona para un cliente SIN slug: el dossier no puede depender de que el
//      dueño haya configurado el catálogo.
//   2. No filtra la identidad del negocio en la URL.
// INVARIANTE QUE NO VIVE AQUÍ: `/d/` no colisiona con `(public)/[slug]/` porque
// los slugs exigen ≥2 caracteres (`catalogo.ts`, guardarSlug: "Mínimo 2 caracteres").
// Si algún día se permiten slugs de 1 carácter, esta ruta se rompe en silencio.
//
// El snapshot está CONGELADO: no hay dato vivo que caduque, así que una ventana
// de revalidación solo generaría regeneraciones inútiles. Se revalida por evento
// (`revalidatePath('/d/'+token)` al publicar / actualizar / revocar).
export const revalidate = false

// Sin `generateStaticParams` a propósito: volcaría todos los tokens al build.
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
    // Un enlace privado NO se indexa: es una capability URL, y un buscador que la
    // rastree convierte "privado" en "público" sin que el dueño se entere.
    robots: { index: false, follow: false, nocache: true },
    // Si el deck enlaza fuera, el token se fugaría por la cabecera Referer.
    referrer: 'no-referrer',
    icons: {
      icon: [
        { url: '/favicon.svg', type: 'image/svg+xml' },
        { url: '/favicon.png', type: 'image/png' },
      ],
    },
  }
}

const nfEntero = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })
const fmtPct = (n: number) => `${n.toFixed(1).replace('.', ',')} %`

function fechaLarga(f: string | null): string {
  if (!f) return ''
  const [y, m, d] = f.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default async function DeckPage({ params }: Props) {
  const { token } = await params
  const deck = await obtenerDeckPublico(token)
  // Despublicado o revocado → null → 404 en la siguiente petición.
  if (!deck) notFound()

  const paleta = derivarPaleta(deck.color)
  const er = estadoDeResultados(deck.serie, deck.lineas)
  const nota = notaConversion(deck.moneda, deck.tasas, deck.faltantes)

  const historico = deck.serie.map(f => f.ingresos)
  const futuro = proyectar(deck.serie, deck.crecimientoPct, 12)
  // SVG inline calculado en SERVIDOR: 12 puntos son aritmética de path. recharts
  // pesa ~100 KB él solo — más que el presupuesto entero de esta página.
  const g = geometriaGrafico(historico, futuro, { ancho: 640, alto: 200 })

  const texto = new Map(deck.secciones.map(s => [s.clave, s.cuerpo]))
  const seccion = (clave: string) => (texto.get(clave) ?? '').trim()
  const periodo = deck.periodoDesde && deck.periodoHasta
    ? `${fechaLarga(deck.periodoDesde)} — ${fechaLarga(deck.periodoHasta)}`
    : ''

  const ultimoProy = futuro.length ? futuro[futuro.length - 1] : 0
  const relato = SECCIONES_RELATO.filter(s => seccion(s.clave).length > 0)
  const antes = relato.filter(s => s.orden < 40)
  const despues = relato.filter(s => s.orden > 40)

  return (
    // La paleta entra como custom properties en UN wrapper; la hoja solo consume
    // var(--do-*) y trae sus propios fallbacks. Ninguna regla lleva el color escrito.
    <div className="dp-page" style={paletaVars(paleta)}>
      <DeckReveal />

      {/* ── Portada ── */}
      <header className="dp-portada">
        <div className="dp-portada-inner">
          {deck.logoUrl && (
            /* eslint-disable-next-line @next/next/no-img-element -- next/image
               arrastraría el optimizador a una ruta con presupuesto de 100 KB; el
               logo ya viene optimizado a WebP 400px por el pipeline de subida. */
            <img src={deck.logoUrl} alt="" className="dp-logo" width={96} height={96} />
          )}
          <h1 className="dp-titulo">{deck.nombre}</h1>
          <p className="dp-subtitulo">Dossier para inversores</p>
          {periodo && <p className="dp-periodo">{periodo}</p>}
        </div>
      </header>

      <main className="dp-main">
        {antes.map(s => (
          <section key={s.clave} className="dp-seccion">
            <h2 className="dp-seccion-titulo">{s.etiqueta}</h2>
            <p className="dp-seccion-cuerpo">{seccion(s.clave)}</p>
          </section>
        ))}

        {/* ── Tracción: NO se pregunta, sale de los números ── */}
        {deck.serie.length > 0 && (
          <section className="dp-seccion dp-traccion">
            <h2 className="dp-seccion-titulo">Tracción</h2>
            <div className="dp-cifras">
              <div className="dp-cifra">
                <span className="dp-cifra-valor">{nfEntero.format(er.ingresos)}</span>
                <span className="dp-cifra-label">Ingresos · {deck.moneda}</span>
              </div>
              <div className="dp-cifra">
                <span className="dp-cifra-valor">{fmtPct(er.margenBrutoPct)}</span>
                <span className="dp-cifra-label">Margen bruto</span>
              </div>
              <div className="dp-cifra">
                <span className="dp-cifra-valor">{nfEntero.format(er.resultadoNeto)}</span>
                <span className="dp-cifra-label">Resultado neto · {deck.moneda}</span>
              </div>
              <div className="dp-cifra">
                <span className="dp-cifra-valor">{deck.serie.length}</span>
                <span className="dp-cifra-label">{deck.serie.length === 1 ? 'Mes registrado' : 'Meses registrados'}</span>
              </div>
            </div>
          </section>
        )}

        {/* ── Proyección: lo estimado va MARCADO, nunca colado como histórico ── */}
        {g.pathHistorico && (
          <section className="dp-seccion">
            <h2 className="dp-seccion-titulo">Evolución y proyección</h2>
            <figure className="dp-grafico">
              <svg
                viewBox={`0 0 ${g.ancho} ${g.alto}`} className="dp-grafico-svg"
                role="img" preserveAspectRatio="none"
                aria-label={
                  futuro.length
                    ? `Ingresos mensuales de ${etiquetaMes(deck.serie[0].mes)} a ${etiquetaMes(deck.serie[deck.serie.length - 1].mes)}, y proyección a 12 meses hasta ${nfEntero.format(ultimoProy)} ${deck.moneda}`
                    : `Ingresos mensuales de ${etiquetaMes(deck.serie[0].mes)} a ${etiquetaMes(deck.serie[deck.serie.length - 1].mes)}`
                }
              >
                {g.areaHistorico && <path d={g.areaHistorico} className="dp-area" />}
                <path d={g.pathHistorico} className="dp-linea" />
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
          </section>
        )}

        {despues.map(s => (
          <section key={s.clave} className="dp-seccion">
            <h2 className="dp-seccion-titulo">{s.etiqueta}</h2>
            <p className="dp-seccion-cuerpo">{seccion(s.clave)}</p>
          </section>
        ))}
      </main>

      <footer className="dp-pie">
        <p className="dp-pie-dato">{congeladoA(deck.snapshotAt)} · Importes en {deck.moneda}.</p>
        {nota && <p className="dp-pie-dato">{nota}</p>}
        <p className="dp-pie-marca">Hecho con CLAUX</p>
      </footer>
    </div>
  )
}
