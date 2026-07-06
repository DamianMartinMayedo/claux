import type { Metadata } from 'next'
import Link from 'next/link'
import { obtenerCatalogoPublico } from '@/lib/publico/catalogo'
import type { ModuloPublico, SectorPublico } from '@/lib/publico/tipos'
import { PublicHeader, PublicFooter } from '@/components/publico/Chrome'
import { DotOrb } from '@/components/publico/DotOrb'
import { Reveal } from '@/components/publico/Reveal'
import {
  iconoModulo,
  colorModulo,
  iconoSector,
  SparklesIcon,
  AiChatIcon,
  CalendarIcon,
  CalculatorIcon,
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

  return (
    <>
      <DotOrb />
      <div className="ld-page">
        <PublicHeader />
        <Hero />
        <ValueSection />
        <ModulesSection modulos={modulos} />
        <SectorsSection sectores={sectores} />
        <IaSection />
        <StepsSection />
        <TrustSection />
        <FaqSection />
        <FinalCTA />
        <PublicFooter />
      </div>
      <JsonLd />
    </>
  )
}

/* ════════════════════════════════════════════════ Hero ════ */

function Hero() {
  return (
    <section className="ld-hero">
      <h1 className="ld-hero-title">
        Tu negocio,{' '}
        <span className="ld-text-gradient">digital y al día</span>.
      </h1>
      <p className="ld-hero-subtitle">
        Contabilidad, catálogo con QR, reservas y un asistente con IA en una
        sola plataforma. Accede desde cualquier móvil, estés donde estés.
      </p>
      <div className="ld-hero-actions">
        <Link href="/diagnostico" className="btn btn-primary btn-lg">
          Hacer mi diagnóstico gratis
          <ArrowRightIcon />
        </Link>
        <a href="#como-funciona" className="btn btn-ghost btn-lg">
          Ver cómo funciona
        </a>
      </div>
      <p className="ld-hero-trust">
        Sin permanencia · Empieza con un módulo · Soporte cercano
      </p>
    </section>
  )
}

/* ════════════════════════════════════════════════ Valor ════ */

function ValueSection() {
  return (
    <section className="ld-section">
      <Reveal className="ld-section-head">
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
          title="Contabilidad simple y completa"
          text="Ventas, gastos, tesorería y reportes. Sin partidas dobles ni complicaciones."
        />
        <ValueItem
          icon={<PuzzleIcon />}
          title="Solo lo que necesitas"
          text="Activas módulos a la carta: inventario, RRHH, reservas, catálogo… y pagas por lo que usas."
        />
        <ValueItem
          icon={<MobileIcon />}
          title="Siempre a mano"
          text="Todo tu negocio en el móvil: consulta, gestiona y decide desde donde quieras, sin depender de un ordenador."
        />
        <ValueItem
          icon={<AiChatIcon />}
          title="Un asistente con IA"
          text="Atiende a tus clientes por Telegram, toma reservas y te resume la semana."
        />
      </Reveal>
    </section>
  )
}

function ValueItem({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="ld-value-item">
      <div className="ld-value-icon">{icon}</div>
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
    <section className="ld-section ld-section-alt">
      <Reveal className="ld-section-head">
        <div className="ld-section-label">Módulos disponibles</div>
        <h2 className="ld-section-title">
          Los módulos que tú eliges
        </h2>
        <p className="ld-section-text">
          Activas solo los módulos que tu negocio necesita —contabilidad,
          inventario, reservas, citas…— y pagas únicamente por lo que usas.
        </p>
      </Reveal>

      <Reveal stagger className="ld-modules-grid">
        {cards.map((m) => {
          const Icon = iconoModulo(m.clave)
          return (
            <div key={m.clave} className="ld-module-card">
              <div className={`ld-module-icon ${colorModulo(m.clave)}`}>
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
      <Reveal className="ld-section-head">
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
            <div key={s.sector} className="ld-sector-badge">
              <Icon />
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
            propio catálogo: responde dudas, toma reservas y pedidos en lenguaje
            natural, y a ti te resume cómo va la semana.
          </p>
          <ul className="ld-spotlight-list">
            <li>
              <CheckMini />
              Atiende a tus clientes 24/7 por Telegram y en tu catálogo
            </li>
            <li>
              <CheckMini />
              Reservas y pedidos sin que tengas que estar pendiente
            </li>
            <li>
              <CheckMini />
              Pregúntale por tus números y recibe un resumen semanal
            </li>
          </ul>
          <Link href="/diagnostico" className="btn btn-primary btn-lg">
            Quiero verlo en mi negocio
            <ArrowRightIcon />
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
    <section className="ld-section ld-section-alt" id="como-funciona">
      <Reveal className="ld-section-head">
        <div className="ld-section-label">Así de simple</div>
        <h2 className="ld-section-title">Tres pasos para digitalizar tu negocio</h2>
      </Reveal>

      <Reveal stagger className="ld-steps">
        <div className="ld-step">
          <div className="ld-step-number">1</div>
          <h3>Cuéntanos tu negocio</h3>
          <p>
            Responde unas preguntas rápidas sobre qué haces y qué necesitas. Sin
            escribir, solo seleccionar.
          </p>
        </div>
        <div className="ld-step">
          <div className="ld-step-number">2</div>
          <h3>Te lo dejamos listo</h3>
          <p>
            Configuramos tus módulos, tu catálogo y tus canales. Tú solo revisas y
            validas: llave en mano.
          </p>
        </div>
        <div className="ld-step">
          <div className="ld-step-number">3</div>
          <h3>Empieza a operar</h3>
          <p>
            En cuestión de días tienes tu negocio funcionando en digital. Con
            soporte cuando lo necesites.
          </p>
        </div>
      </Reveal>
    </section>
  )
}

/* ════════════════════════════════════════════════ Confianza ════ */

function TrustSection() {
  const items = [
    { icon: <ShieldIcon />, label: 'Sin permanencia' },
    { icon: <StarIcon />, label: 'Precios justos y transparentes' },
    { icon: <MobileIcon />, label: 'Todo tu negocio en el móvil' },
    { icon: <LockIcon />, label: 'Tus datos, seguros' },
    { icon: <ChatIcon />, label: 'Soporte cercano y real' },
  ]
  return (
    <section className="ld-section">
      <Reveal stagger className="ld-trust-grid">
        {items.map((it) => (
          <div key={it.label} className="ld-trust-item">
            <span className="ld-trust-icon">{it.icon}</span>
            {it.label}
          </div>
        ))}
      </Reveal>
    </section>
  )
}

/* ════════════════════════════════════════════════ FAQ ════ */

function FaqSection() {
  const faqs = [
    {
      q: '¿Puedo usarlo desde cualquier dispositivo?',
      a: 'Sí. CLAUX está diseñado para funcionar en cualquier móvil, tableta u ordenador. Accede a tu negocio estés donde estés.',
    },
    {
      q: '¿Tengo que contratar todo de golpe?',
      a: 'No. La base es la Contabilidad; el resto de módulos los activas solo si los necesitas y pagas por lo que usas.',
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
    <section className="ld-section ld-section-alt">
      <Reveal className="ld-section-head">
        <div className="ld-section-label">Preguntas frecuentes</div>
        <h2 className="ld-section-title">Lo que la gente nos pregunta</h2>
      </Reveal>
      <Reveal className="ld-faq">
        {faqs.map((f) => (
          <details key={f.q} className="ld-faq-item">
            <summary className="ld-faq-q">
              {f.q}
              <ChevronIcon />
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
          <ArrowRightIcon />
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

/* ════════════════════════════════════════════════ Iconos UI ════ */

function ArrowRightIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  )
}
function PuzzleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15.5 3.5a2 2 0 0 1 4 0c0 .5-.2 1-.5 1.4l-.5.6h2a1.5 1.5 0 0 1 1.5 1.5v2l-.6-.5a2 2 0 1 0 0 3l.6-.5v2a1.5 1.5 0 0 1-1.5 1.5h-2l.5.6a2 2 0 1 1-4 0l.5-.6h-2A1.5 1.5 0 0 1 10 16v-2l-.6.5a2 2 0 1 1 0-3l.6.5V10a1.5 1.5 0 0 1 1.5-1.5h2l-.5-.6c-.3-.4-.5-.9-.5-1.4z" />
    </svg>
  )
}
function MobileIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M12 18h.01" />
    </svg>
  )
}
function CheckMini() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}
function StarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}
function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}
function ChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}
function ChevronIcon() {
  return (
    <svg className="ld-faq-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}
