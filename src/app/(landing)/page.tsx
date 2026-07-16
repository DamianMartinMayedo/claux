import type { Metadata } from 'next'
import Link from 'next/link'
import { obtenerCatalogoPublico } from '@/lib/publico/catalogo'
import type { ModuloPublico, SectorPublico } from '@/lib/publico/tipos'
import { PublicHeader, PublicFooter } from '@/components/publico/Chrome'
import LandingAnim from '@/components/publico/LandingAnim'
import { Reveal } from '@/components/publico/Reveal'
import {
  iconoModulo,
  colorModulo,
  iconoSector,
  colorSector,
  SparklesIcon,
  AiChatIcon,
  CalendarIcon,
  CalculatorIcon,
  ArrowRightIcon,
  PuzzleIcon,
  CheckIcon,
  ChevronIcon,
  CajaIcon,
  DossierIcon,
  InventarioIcon,
  type ColorModulo,
} from '@/components/publico/iconos'

export const metadata: Metadata = {
  title: 'Digitaliza tu negocio',
  description:
    'CLAUX es la plataforma todo en uno para digitalizar tu negocio: contabilidad, catálogo con QR, reservas y un asistente con IA. Activas solo los módulos que necesitas y pagas por lo que usas. Empieza con tu diagnóstico gratis.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'CLAUX — Digitaliza tu negocio',
    description:
      'Plataforma todo en uno para digitalizar tu negocio: contabilidad, catálogo QR, reservas y asistente con IA. Activas solo los módulos que necesitas.',
    url: '/',
  },
}

// ISR: el catálogo cambia poco; revalidamos cada hora para que al activar un
// módulo o sector en el admin la landing se actualice sola sin redeploy.
export const revalidate = 3600

export default async function LandingPage() {
  const { modulos, sectores } = await obtenerCatalogoPublico()

  // El fondo de puntos interactivo (DotOrb) está retirado del render mientras
  // decidimos qué hacer con él: era `position: fixed`, así que no daba ritmo al
  // scroll y mantenía un requestAnimationFrame vivo toda la visita. El ritmo lo
  // dan ahora las bandas de color. El componente sigue intacto en
  // components/publico/DotOrb.tsx (y su CSS en 08-landing.css): para recuperarlo
  // basta importarlo y montarlo aquí de nuevo.
  return (
    <>
      <div className="ld-page">
        {/* La cabecera va FUERA de .ld-hero-zona aunque flote sobre ella: es
            `fixed` (no ocupa flujo) y tiene fondo propio, así que anidarla solo
            servía para que las reglas de color de la zona —pensadas para el
            degradado— se le colaran y le dejaran los botones en blanco también
            al bajar, sobre el crema. */}
        <PublicHeader />
        <div className="ld-hero-zona">
          <Hero />
          <div className="ld-hero-fin" aria-hidden="true" />
        </div>
        <ValueSection />
        <ModulesSection modulos={modulos} />
        <SectorsSection sectores={sectores} />
        <IaSection />
        <StepsSection />
        <FaqSection />
        <FinalCTA />
        <PublicFooter />
      </div>
      <LandingAnim />
      <JsonLd />
    </>
  )
}

/* ════════════════════════════════════════════════ Hero ════ */

function Hero() {
  return (
    <section className="ld-hero">
      <h1 className="ld-hero-title">
        Tu negocio, <span className="ld-hero-realce">digital y al día</span>.
      </h1>
      <p className="ld-hero-subtitle">
        Contabilidad, punto de venta, catálogo digital, reservas y presentaciones
        para inversores. Todo en una plataforma, y activas solo lo que necesitas.
      </p>
      <div className="ld-hero-actions">
        <Link href="/diagnostico" className="btn btn-primary btn-lg">
          Hacer mi diagnóstico gratis
          <ArrowRightIcon size={18} />
        </Link>
        <a href="#como-funciona" className="btn btn-ghost btn-lg">
          Ver cómo funciona
        </a>
      </div>
      <p className="ld-hero-trust">
        Sin permanencia · Personalizado para ti · Soporte cercano
      </p>
    </section>
  )
}

/* ════════════════════════════════════════════════ Valor ════ */

function ValueSection() {
  return (
    <section className="ld-section">
      <Reveal stagger className="ld-section-head">
        <div className="ld-section-label">¿Por qué CLAUX?</div>
        <h2 className="ld-section-title">
          Todo lo que necesitas para operar, en un solo lugar
        </h2>
        <p className="ld-section-text">
          Olvídate de usar cinco herramientas distintas. CLAUX unifica la gestión
          de tu negocio: desde las cuentas hasta el catálogo que escanean tus
          clientes.
        </p>
      </Reveal>

      <Reveal stagger className="ld-value-grid">
        <ValueItem
          icon={<CalculatorIcon />}
          color="teal"
          title="Contabilidad simple y completa"
          text="Ventas, gastos, tesorería y reportes. Sin partidas dobles ni complicaciones."
        />
        <ValueItem
          icon={<PuzzleIcon />}
          color="amber"
          title="Solo lo que necesitas"
          text="Cada módulo funciona por su cuenta: activas los que quieras y pagas solo por esos."
        />
        <ValueItem
          icon={<CajaIcon />}
          color="green"
          title="Un punto de venta que no se para"
          text="Cobra, registra las ventas y cierra caja aunque estés sin conexión. Luego se sincroniza solo."
        />
        <ValueItem
          icon={<DossierIcon />}
          color="indigo"
          title="Tus números, listos para enseñar"
          text="Convierte tu contabilidad en una presentación para inversores: un enlace para enseñar y un PDF para enviar."
        />
        <ValueItem
          icon={<AiChatIcon />}
          color="purple"
          title="Un asistente con IA"
          text="Atiende a tus clientes, toma reservas y responde a lo que le preguntes sobre tu negocio."
        />
        <ValueItem
          icon={<InventarioIcon />}
          color="rose"
          title="Control de tu inventario"
          text="Qué tienes, dónde está y cuánto queda. Con las compras y las salidas al día."
        />
      </Reveal>
    </section>
  )
}

function ValueItem({
  icon,
  color,
  title,
  text,
}: {
  icon: React.ReactNode
  color: ColorModulo
  title: string
  text: string
}) {
  return (
    <div className="ld-value-item">
      <div className={`ld-value-icon ld-ac-${color}`}>{icon}</div>
      <div>
        <div className="ld-value-title">{title}</div>
        <div className="ld-value-text">{text}</div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════ Módulos ════ */

function ModulesSection({ modulos }: { modulos: ModuloPublico[] }) {
  const cards = modulos.filter((m) => m.mostrarEnLanding)

  return (
    <section className="ld-section ld-band-amber">
      <Reveal stagger className="ld-section-head">
        <div className="ld-section-label">Módulos disponibles</div>
        <h2 className="ld-section-title">
          Los módulos que tú eliges
        </h2>
        <p className="ld-section-text">
          Cada módulo funciona por su cuenta: activas los que necesitas —punto de
          venta, contabilidad, reservas, presentación para inversores…— y pagas
          solo por esos.
        </p>
      </Reveal>

      <Reveal stagger className="ld-modules-grid">
        {cards.map((m) => {
          const Icon = iconoModulo(m.clave)
          const color = colorModulo(m.clave)
          return (
            <div key={m.clave} className="ld-module-card">
              <div className={`ld-module-icon ld-ac-${color}`}>
                <Icon />
              </div>
              <h3>{m.nombre}</h3>
              <p>{m.descripcion}</p>
            </div>
          )
        })}
      </Reveal>
    </section>
  )
}

/* ════════════════════════════════════════════════ Sectores ════ */

function SectorsSection({ sectores }: { sectores: SectorPublico[] }) {
  const rest = sectores.find((s) => s.sector === 'restaurante')
  const pelu = sectores.find((s) => s.sector === 'peluqueria')

  return (
    <section className="ld-section">
      <Reveal stagger className="ld-section-head">
        <div className="ld-section-label">Para todo tipo de negocio</div>
        <h2 className="ld-section-title">Una plataforma que se adapta a tu sector</h2>
        <p className="ld-section-text">
          El núcleo es el mismo, pero cada sector ve lo que necesita.
          {rest && pelu && (
            <>
              {' '}
              En un {rest.nombre.toLowerCase()} verás «{rest.etiquetas.catalogo}»
              y «{rest.etiquetas.recurso_pl}»; en una {pelu.nombre.toLowerCase()},
              «{pelu.etiquetas.catalogo}» y «{pelu.etiquetas.recurso_pl}». El
              sistema habla el idioma de tu negocio.
            </>
          )}
        </p>
      </Reveal>

      <Reveal stagger className="ld-sectors-grid">
        {sectores.map((s) => {
          const Icon = iconoSector(s.sector)
          return (
            <div key={s.sector} className="ld-sector-card">
              <span className={`ld-sector-icon ld-ac-${colorSector(s.sector)}`}>
                <Icon />
              </span>
              {s.nombre}
            </div>
          )
        })}
      </Reveal>
    </section>
  )
}

/* ════════════════════════════════════════════════ IA (spotlight) ════ */

function IaSection() {
  return (
    <section className="ld-spotlight">
      <Reveal className="ld-spotlight-inner">
        <div className="ld-spotlight-copy">
          <div className="ld-section-label ld-spotlight-label">Asistente con IA · Módulo opcional</div>
          <h2 className="ld-spotlight-title">El asistente que atiende por ti</h2>
          <p className="ld-spotlight-text">
            Un chat con IA que habla con tus clientes por Telegram y desde tu
            propio catálogo: responde dudas y toma reservas y pedidos escribiendo
            normal. Y a ti te ayuda a decidir, con los números de tu negocio
            delante.
          </p>
          <ul className="ld-spotlight-list">
            <li>
              <CheckIcon size={18} />
              Atiende a tus clientes 24/7 por Telegram y en tu catálogo
            </li>
            <li>
              <CheckIcon size={18} />
              Reservas y pedidos sin que tengas que estar pendiente
            </li>
            <li>
              <CheckIcon size={18} />
              Pregúntale lo que quieras de tu negocio y decide con datos
            </li>
            <li>
              <CheckIcon size={18} />
              Te ayuda a escribir tu presentación para inversores
            </li>
          </ul>
          <Link href="/diagnostico" className="btn btn-primary btn-lg">
            Quiero verlo en mi negocio
            <ArrowRightIcon size={18} />
          </Link>
        </div>
        <div className="ld-spotlight-visual" aria-hidden="true">
          <div className="ld-chatcard">
            <div className="ld-chat-row ld-chat-in">
              <SparklesIcon size={16} />
              <span>¿Tienen mesa para 4 esta noche?</span>
            </div>
            <div className="ld-chat-row ld-chat-out">
              <span>¡Sí! A las 20:30 o 21:00. ¿Te reservo una?</span>
            </div>
            <div className="ld-chat-row ld-chat-in">
              <CalendarIcon size={16} />
              <span>Las 20:30, gracias</span>
            </div>
            <div className="ld-chat-row ld-chat-out">
              <span>Reservada para 4 a las 20:30. ¡Te esperamos!</span>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  )
}

/* ════════════════════════════════════════════════ Pasos ════ */

function StepsSection() {
  return (
    <section className="ld-section" id="como-funciona">
      <Reveal stagger className="ld-section-head">
        <div className="ld-section-label">Así de simple</div>
        <h2 className="ld-section-title">Tres pasos para digitalizar tu negocio</h2>
      </Reveal>

      <Reveal stagger className="ld-steps">
        <div className="ld-step">
          <div className="ld-step-number ld-ac-teal">1</div>
          <h3>Cuéntanos tu negocio</h3>
          <p>
            Responde unas preguntas rápidas sobre qué haces y qué necesitas. Sin
            escribir, solo seleccionar.
          </p>
        </div>
        <div className="ld-step">
          <div className="ld-step-number ld-ac-purple">2</div>
          <h3>Te lo dejamos listo</h3>
          <p>
            Configuramos tus módulos, tu catálogo y tus canales. Tú solo revisas y
            validas: llave en mano.
          </p>
        </div>
        <div className="ld-step">
          <div className="ld-step-number ld-ac-amber">3</div>
          <h3>Empieza a operar</h3>
          <p>
            En cuestión de días tienes tu negocio funcionando en digital. Con
            soporte cuando lo necesites.
          </p>
        </div>
      </Reveal>

      <Reveal className="ld-steps-cta">
        <Link href="/diagnostico" className="btn btn-primary btn-lg">
          Empezar por el paso 1
          <ArrowRightIcon size={18} />
        </Link>
      </Reveal>
    </section>
  )
}

/* ════════════════════════════════════════════════ FAQ ════ */

function FaqSection() {
  const faqs = [
    {
      q: '¿La caja funciona sin conexión?',
      a: 'Sí. El punto de venta cobra, registra las ventas y cierra caja offline. Cuando vuelve la conexión, se sincroniza solo.',
    },
    {
      q: '¿Tengo que contratar todo de golpe?',
      a: 'No. Cada módulo funciona solo: puedes empezar con el punto de venta y no llevar contabilidad, o al revés. Pagas solo por lo que actives.',
    },
    {
      q: '¿Puedo enseñarle mis números a un inversor?',
      a: 'Sí. El Dossier convierte tu contabilidad en una presentación con enlace web y un estado de resultados en PDF, a partir de los datos que ya tienes.',
    },
    {
      q: '¿Necesito tener WhatsApp Business?',
      a: 'No hace falta. Las reservas y la atención al cliente funcionan por Telegram, y también desde tu propio catálogo digital.',
    },
    {
      q: '¿Sirve para mi tipo de negocio?',
      a: 'Sí. Restaurantes, peluquerías, gimnasios, clínicas, tiendas y servicios: el sistema se adapta con la terminología de cada sector.',
    },
    {
      q: '¿Cómo empiezo?',
      a: 'Haz el diagnóstico gratis (2 minutos). Te decimos qué módulos encajan con tu negocio y lo preparamos todo para que empieces rápido.',
    },
  ]
  return (
    <section className="ld-section">
      <Reveal stagger className="ld-section-head">
        <div className="ld-section-label">Preguntas frecuentes</div>
        <h2 className="ld-section-title">Lo que la gente nos pregunta</h2>
      </Reveal>
      <Reveal className="ld-faq">
        {faqs.map((f) => (
          <details key={f.q} className="ld-faq-item">
            <summary className="ld-faq-q">
              {f.q}
              <ChevronIcon className="ld-faq-chevron" size={18} />
            </summary>
            <p className="ld-faq-a">{f.a}</p>
          </details>
        ))}
      </Reveal>
    </section>
  )
}

/* ════════════════════════════════════════════════ CTA final ════ */

function FinalCTA() {
  return (
    <section className="ld-cta">
      <Reveal>
        <h2 className="ld-cta-title">¿Listo para digitalizar tu negocio?</h2>
        <p className="ld-cta-text">
          Haz el diagnóstico gratuito en 2 minutos. Sin compromiso.
        </p>
        <Link href="/diagnostico" className="btn btn-primary btn-lg">
          Empezar diagnóstico gratis
          <ArrowRightIcon size={18} />
        </Link>
      </Reveal>
    </section>
  )
}

/* ════════════════════════════════════════════════ JSON-LD ════ */

function JsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'CLAUX',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web, Android, iOS',
    description:
      'Plataforma SaaS todo en uno para digitalizar negocios locales: contabilidad, catálogo con QR, reservas y citas, inventario, RRHH y asistente con IA.',
    inLanguage: 'es',
    audience: {
      '@type': 'BusinessAudience',
      audienceType: 'Negocios locales: restaurantes, peluquerías, gimnasios, clínicas, tiendas y servicios',
    },
    publisher: { '@type': 'Organization', name: 'CLAUX' },
  }
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

