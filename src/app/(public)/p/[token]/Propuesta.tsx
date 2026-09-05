import { importeClaux } from '@/lib/moneda-claux'
import type { PropuestaResuelta, Slide } from '@/lib/propuesta/tipos'
import BrandFonts from '@/components/BrandFontsSinCursiva'
import PropuestaReveal from './PropuestaReveal'
import { Marca, MarcaSprite } from './Marca'
import Configurador from './Configurador'
import './propuesta-publica.css'

// ── La propuesta ensamblada — el MISMO render para el enlace y la vista previa ─
//
// No sabe de dónde viene: recibe una `PropuestaResuelta` ya decidida (qué
// diapositivas, en qué orden, con qué dentro) y solo pinta. Un único render
// garantiza que lo que el comercial previsualiza es exactamente lo que el
// cliente abre, y que el PDF es esta misma página paginada.
//
// Legible SIN JS: las animaciones son opt-in bajo `.pp-anim`. Presupuesto
// < 100 KB — CSS propio y un JS pequeño, sin librerías.

/** Solo la portada y el cierre van a color pleno: son las dos tapas. Las de
 *  dentro van TODAS sobre la misma crema. Antes alternaban verde, blanco y
 *  crema, que es el gesto del deck del dossier —y esto no es un pase de
 *  diapositivas, es un documento nuestro—: lo que separa una sección de la
 *  siguiente es el membrete y el folio, no el color del papel. */
function fondoDe(s: Slide): 'crema' | 'verde' {
  return s.tipo === 'portada' || s.tipo === 'empecemos' ? 'verde' : 'crema'
}

/** Dos cifras siempre: `03 / 16` no baila de ancho entre una hoja y la siguiente. */
const folio = (n: number) => String(n).padStart(2, '0')

function horasTexto(h: number | null): string | null {
  if (h === null || h <= 0) return null
  return `${h} h`
}

/** `doc` solo lo usa el configurador, que necesita saber a dónde guarda la
 *  selección. Las demás diapositivas se pintan enteras desde su propio `Slide`,
 *  que es la regla del motor: si un dato no está, la diapositiva no se emite. */
function Cuerpo({ s, doc }: { s: Slide; doc: PropuestaResuelta }) {
  switch (s.tipo) {
    case 'portada':
      return (
        <div className="pp-portada">
          <Marca className="pp-portada-logo" rotulo="CLAUX" />
          <h1 className="pp-titulo">{s.titulo}</h1>
          {/* Ficha de portada, no un pie centrado: cada dato con su rótulo, como
              la primera página de un documento. */}
          {(s.comercial || s.fecha) && (
          <dl className="pp-portada-ficha">
            {s.comercial && <><dt>Preparado por</dt><dd>{s.comercial.nombre}</dd></>}
            {/* «Actualizada el…» y no una fecha suelta: esta propuesta lee el
                presupuesto vivo, así que el papel que el cliente tiene encima de
                la mesa puede no ser el que abre el enlace. Decir de cuándo es
                cada copia es lo que evita esa discusión. */}
            {s.fecha && <><dt>Actualizada el</dt><dd>{s.fecha}</dd></>}
          </dl>
          )}
        </div>
      )

    case 'lista':
      return (
        <>
          <p className="pp-kicker">Tu negocio</p>
          <h2 className="pp-titulo">{s.titulo}</h2>
          <ol className="pp-lista">
            {s.puntos.map((p, i) => <li key={i}>{p}</li>)}
          </ol>
        </>
      )

    case 'tarjetas':
      return (
        <>
          <h2 className="pp-titulo">{s.titulo}</h2>
          <div className="pp-tarjetas">
            {s.tarjetas.map((t, i) => (
              <div key={i} className="pp-tarjeta">
                <h3>{t.titulo}</h3>
                <p>{t.cuerpo}</p>
              </div>
            ))}
          </div>
        </>
      )

    case 'problema':
      return (
        <>
          <h2 className="pp-titulo">{s.titulo}</h2>
          <div className="pp-columnas">
            <div className="pp-columna pp-columna-hoy">
              <h3>{s.rotuloHoy}</h3>
              <ul>{s.hoy.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
            <div className="pp-columna pp-columna-claux">
              <h3>{s.rotuloClaux}</h3>
              <ul>{s.conClaux.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          </div>
        </>
      )

    case 'pensado':
      return (
        <>
          <p className="pp-kicker">A medida</p>
          <h2 className="pp-titulo">{s.titulo}</h2>
          <div className="pp-modulos">
            {s.modulos.map(m => (
              <div key={m.clave} className="pp-modulo">
                <h3>{m.nombre}</h3>
                <p>{m.cuerpo}</p>
              </div>
            ))}
          </div>
          {s.paginas > 1 && <p className="pp-paginacion">{s.pagina} de {s.paginas}</p>}
        </>
      )

    case 'captura':
      return (
        <div className="pp-captura">
          <h2 className="pp-titulo">{s.titulo}</h2>
          {/* Sin next/image: la ruta pública va aislada, igual que el deck. El
              hueco se reserva con width/height para que el texto no salte
              cuando la imagen aterriza en una conexión lenta. */}
          <div className="pp-captura-marco">
            <div className="pp-captura-barra" aria-hidden="true"><span /><span /><span /></div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={s.captura.url} alt={s.captura.alt} loading="lazy" decoding="async"
              width={s.captura.ancho ?? undefined} height={s.captura.alto ?? undefined}
            />
          </div>
          {s.pie && <p className="pp-captura-pie">{s.pie}</p>}
        </div>
      )

    case 'precios':
      return (
        <>
          <p className="pp-kicker">Módulos a la carta</p>
          <h2 className="pp-titulo">{s.titulo}</h2>
          <Configurador
            opciones={s.opciones} moneda={s.moneda} cuotaPropuesta={s.cuotaPropuesta}
            diasPrueba={s.diasPrueba} descuentoAnualPct={s.descuentoAnualPct}
            propuestaId={doc.id} token={doc.token}
          />
        </>
      )

    case 'tu_propuesta':
      return (
        <>
          <p className="pp-kicker">Lo que te proponemos</p>
          <h2 className="pp-titulo">{s.titulo}</h2>
          <div className="pp-propuesta">
            <div className="pp-bloque">
              <h3>Configuración y puesta en marcha</h3>
              <table className="pp-tabla">
                <tbody>
                  {s.fases.map(f => (
                    <tr key={f.etiqueta}>
                      <td>{f.etiqueta}</td>
                      <td className="pp-num">{horasTexto(f.horas) ?? '—'}</td>
                      <td className="pp-num">{f.subtotal === null ? '—' : importeClaux(f.subtotal, s.moneda)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="pp-total">
                <span className="pp-total-label">
                  Pago único
                  {s.descuentoPct > 0 && ` · ${s.descuentoPct} % de descuento`}
                </span>
                <span className="pp-total-cifra">{importeClaux(s.totalFinal, s.moneda)}</span>
              </div>
            </div>

            <div className="pp-bloque">
              <h3>Tu suscripción</h3>
              <table className="pp-tabla">
                <tbody>
                  {s.modulos.map(m => (
                    <tr key={m.clave}>
                      <td>{m.nombre}</td>
                      <td className="pp-num">{importeClaux(m.precio, s.moneda)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="pp-total">
                <span className="pp-total-label">Al mes</span>
                <span className="pp-total-cifra">{importeClaux(s.cuotaMensual, s.moneda)}</span>
              </div>
              {s.cuotaAnual !== null && (
                <p className="pp-anual">
                  Pagando el año por adelantado: {importeClaux(s.cuotaAnual, s.moneda)},
                  un {s.descuentoAnualPct} % menos.
                </p>
              )}
            </div>
          </div>
        </>
      )

    case 'fases':
      return (
        <>
          <h2 className="pp-titulo">{s.titulo}</h2>
          <div className="pp-fases">
            {s.fases.map(f => (
              <div key={f.etiqueta} className="pp-fase">
                <span className="pp-fase-num">{String(f.num).padStart(2, '0')}</span>
                <span className="pp-fase-nombre">{f.etiqueta}</span>
                {horasTexto(f.horas) && <span className="pp-fase-horas">{horasTexto(f.horas)}</span>}
              </div>
            ))}
          </div>
          <p className="pp-nota">{s.pago}</p>
        </>
      )

    case 'empecemos':
      return (
        <>
          <h2 className="pp-titulo">{s.titulo}</h2>
          <div className="pp-pasos">
            {s.pasos.map((p, i) => (
              <div key={i} className="pp-paso">
                <h3>{p.titulo}</h3>
                <p>{p.cuerpo}</p>
              </div>
            ))}
          </div>
          {s.comercial && (
            <div className="pp-contacto">
              <span><strong>{s.comercial.nombre}</strong></span>
              {s.comercial.tel && <a href={`tel:${s.comercial.tel.replace(/\s/g, '')}`}>{s.comercial.tel}</a>}
              {s.comercial.email && <a href={`mailto:${s.comercial.email}`}>{s.comercial.email}</a>}
            </div>
          )}
        </>
      )
  }
}

export default function Propuesta({ p, borrador = false }: { p: PropuestaResuelta; borrador?: boolean }) {
  return (
    <div className="pp-page">
      {borrador && <div className="pp-borrador" role="status">Vista previa · borrador (nadie más lo ve)</div>}
      {/* Las mismas dos fuentes que el resto de CLAUX, servidas desde nuestro
          dominio en vez de desde Google: se abre en el móvil de un dueño que a
          lo mejor está en datos, y ahorra dos conexiones y una hoja que bloquea
          el pintado. */}
      <BrandFonts />
      <MarcaSprite />
      <PropuestaReveal />

      <nav className="pp-nav" aria-label="Ir a una sección">
        {p.slides.map((s, i) => (
          <a key={s.clave} href={`#pp-${i}`} className="pp-nav-dot" aria-label={s.titulo}><span /></a>
        ))}
      </nav>

      {/* `data-largo` marca «esta puede no caber en una página». En pantalla no
          cambia nada; en papel es lo único que la deja PARTIR en dos en vez de
          recortarse, que es lo que le pasó al PDF de Elina: Precios con once
          módulos y Tu propuesta con el bloque anual salieron cortados por abajo. */}
      {p.slides.map((s, i) => (
        <section
          key={s.clave} id={`pp-${i}`}
          className={`pp-slide${s.tipo === 'portada' ? ' pp-slide-portada' : ''}`}
          data-bg={fondoDe(s)}
          data-largo={s.tipo === 'precios' || s.tipo === 'tu_propuesta' ? 'si' : undefined}
        >
          {/* Membrete: el logotipo, de qué documento es esta hoja y por dónde va.
              Se repite en todas menos la portada, que ya lleva la marca grande, y
              es lo que hace que una página suelta —impresa o reenviada— siga
              diciendo de quién es y de qué. Va DENTRO de la diapositiva y no
              `fixed` en la página: en pantalla da igual, pero al imprimir Chrome
              solo pinta lo fijo en la primera hoja. Sin voz para el lector de
              pantalla: es cromo repetido, y lo que dice ya está en la portada. */}
          {s.tipo !== 'portada' && (
            <header className="pp-membrete" aria-hidden="true">
              <Marca className="pp-membrete-logo" />
              <span className="pp-membrete-doc">Propuesta para {p.nombreNegocio}</span>
              <span className="pp-membrete-folio">{folio(i + 1)} / {folio(p.slides.length)}</span>
            </header>
          )}
          <div className="pp-slide-inner"><Cuerpo s={s} doc={p} /></div>
        </section>
      ))}
    </div>
  )
}
