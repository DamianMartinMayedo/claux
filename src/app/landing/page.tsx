import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Digitaliza tu negocio en Cuba',
  description:
    'CLAUX es el SaaS todo en uno para negocios locales cubanos. Contabilidad, menú digital QR, reservas, inventario y RRHH. Empieza gratis con tu diagnóstico.',
  openGraph: {
    title: 'CLAUX — Digitaliza tu negocio en Cuba',
    description:
      'SaaS todo en uno para digitalizar negocios locales cubanos. Contabilidad, menú QR, reservas, inventario y RRHH.',
  },
}

export default function LandingPage() {
  return (
    <div>
      <Header />
      <Hero />
      <ValueSection />
      <ModulesSection />
      <SectorsSection />
      <StepsSection />
      <FinalCTA />
      <footer className="ld-footer">
        <div className="ld-header-logo">
          <div className="ld-header-logo-icon">C</div>
          <span className="ld-header-logo-text">CLAUX</span>
        </div>
        <p className="mt-3">
          Hecho para negocios cubanos. Simple, rápido, sin complicaciones.
        </p>
      </footer>
    </div>
  )
}

function Header() {
  return (
    <header className="ld-header">
      <Link href="/landing" className="ld-header-logo">
        <div className="ld-header-logo-icon">C</div>
        <span className="ld-header-logo-text">CLAUX</span>
      </Link>
      <nav className="ld-header-nav">
        <a href="/admin/login" className="btn btn-ghost btn-sm">
          Acceso clientes
        </a>
      </nav>
    </header>
  )
}

function Hero() {
  return (
    <section className="ld-hero">
      <div className="ld-hero-badge">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ flexShrink: 0 }}
        >
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
        Lanzamiento 2026 &middot; Precios fundador
      </div>

      <h1 className="ld-hero-title">
        El SaaS que{' '}
        <span className="ld-hero-highlight">digitaliza</span> tu negocio en
        Cuba
      </h1>
      <p className="ld-hero-subtitle">
        CLAUX te da contabilidad, menú digital QR, reservas online, inventario
        y más en una sola plataforma. Diseñado para funcionar en cualquier móvil,
        incluso con conexión lenta.
      </p>

      <div className="ld-hero-actions">
        <Link href="/diagnostico" className="btn btn-primary btn-lg">
          Quiero digitalizar mi negocio
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Link>
        <a href="#como-funciona" className="btn btn-ghost btn-lg">
          Cómo funciona
        </a>
      </div>
    </section>
  )
}

function ValueSection() {
  return (
    <section className="ld-section">
      <div className="ld-section-label">¿Por qué CLAUX?</div>
      <h2 className="ld-section-title">
        Todo lo que necesitas para operar, en un solo lugar
      </h2>
      <p className="ld-section-text">
        Olvídate de usar cinco herramientas distintas. CLAUX unifica la gestión de
        tu negocio: desde la contabilidad hasta el menú que escanean tus clientes
        con el QR.
      </p>

      <div className="ld-value-grid">
        <ValueItem
          icon={<ChartIcon />}
          title="Contabilidad simple y completa"
          text="Ventas, gastos, tesorería y reportes financieros. Sin partidas dobles ni complicaciones."
        />
        <ValueItem
          icon={<PuzzleIcon />}
          title="Módulos a tu medida"
          text="Elige solo lo que necesitas: inventario, RRHH, reservas, menú QR... Actívalos cuando quieras."
        />
        <ValueItem
          icon={<MobileIcon />}
          title="Optimizado para Cuba"
          text="Funciona en cualquier móvil con 3G. Diseñado para los cortes de luz y la conectividad real."
        />
        <ValueItem
          icon={<MessageIcon />}
          title="Telegram y QR integrados"
          text="Tus clientes reservan mesa, piden cita o ven tu carta desde Telegram o escaneando un QR."
        />
      </div>
    </section>
  )
}

function ValueItem({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode
  title: string
  text: string
}) {
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

function ModulesSection() {
  return (
    <section className="ld-section ld-section-alt">
      <div className="ld-section-label">Módulos disponibles</div>
      <h2 className="ld-section-title">
        Una base sólida, los módulos que tú eliges
      </h2>
      <p className="ld-section-text">
        Todos los clientes tienen la base contable incluida. El resto de módulos
        los activas solo si los necesitas. Pagas por lo que usas.
      </p>

      <div className="ld-modules-grid">
        <ModuleCard
          icon={<BookIcon />}
          iconClass="ld-module-icon-teal"
          title="Base contable"
          desc="Ventas, facturas, gastos, tesorería, cuentas por cobrar y pagar, y reportes financieros."
          tag="Incluida"
        />
        <ModuleCard
          icon={<PackageIcon />}
          iconClass="ld-module-icon-amber"
          title="Inventario"
          desc="Productos, almacenes, compras y control de stock por almacén."
        />
        <ModuleCard
          icon={<UsersIcon />}
          iconClass="ld-module-icon-indigo"
          title="RRHH"
          desc="Personal, contratos, turnos y nómina simple integrada con la contabilidad."
        />
        <ModuleCard
          icon={<QRIcon />}
          iconClass="ld-module-icon-green"
          title="Catálogo digital QR"
          desc="Menú o catálogo de servicios con fotos y precios. Tus clientes lo ven al escanear un QR."
        />
        <ModuleCard
          icon={<CalendarIcon />}
          iconClass="ld-module-icon-purple"
          title="Reservas"
          desc="Reservas por franja horaria con control de aforo. Ideal para restaurantes y bares."
        />
        <ModuleCard
          icon={<ClockIcon />}
          iconClass="ld-module-icon-rose"
          title="Citas"
          desc="Agenda por profesional o recurso con servicios de duración. Para peluquerías y clínicas."
        />
      </div>
    </section>
  )
}

function ModuleCard({
  icon,
  iconClass,
  title,
  desc,
  tag,
}: {
  icon: React.ReactNode
  iconClass: string
  title: string
  desc: string
  tag?: string
}) {
  return (
    <div className="ld-module-card">
      <div className={`ld-module-icon ${iconClass}`}>{icon}</div>
      <h3>{title}</h3>
      <p>{desc}</p>
      {tag && <span className="ld-module-tag">{tag}</span>}
    </div>
  )
}

function SectorsSection() {
  const sectors = [
    { label: 'Restaurantes y bares', icon: <UtensilsIcon /> },
    { label: 'Peluquerías y barberías', icon: <ScissorsIcon /> },
    { label: 'Gimnasios', icon: <DumbbellIcon /> },
    { label: 'Clínicas y consultorios', icon: <HeartIcon /> },
    { label: 'Tiendas y comercios', icon: <StoreIcon /> },
    { label: 'Servicios profesionales', icon: <BriefcaseIcon /> },
  ]

  return (
    <section className="ld-section">
      <div className="ld-section-label">Para todo tipo de negocio</div>
      <h2 className="ld-section-title">
        Una plataforma que se adapta a tu sector
      </h2>
      <p className="ld-section-text">
        El núcleo es el mismo, pero cada sector ve lo que necesita. Restaurantes
        ven &ldquo;Menú&rdquo; y &ldquo;Reservas&rdquo;; peluquerías ven
        &ldquo;Catálogo&rdquo; y &ldquo;Citas&rdquo;.
      </p>
      <div className="ld-sectors-grid">
        {sectors.map((s) => (
          <div key={s.label} className="ld-sector-badge">
            {s.icon}
            {s.label}
          </div>
        ))}
      </div>
    </section>
  )
}

function StepsSection() {
  return (
    <section className="ld-section ld-section-alt" id="como-funciona">
      <div className="ld-section-label">Así de simple</div>
      <h2 className="ld-section-title">Tres pasos para digitalizar tu negocio</h2>

      <div className="ld-steps">
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
          <h3>Te preparamos todo</h3>
          <p>
            Configuramos tus módulos, tu catálogo y tus canales. Tú solo
            revisas y validas.
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
      </div>
    </section>
  )
}

function FinalCTA() {
  return (
    <section className="ld-cta">
      <h2 className="ld-cta-title">¿Listo para digitalizar tu negocio?</h2>
      <p className="ld-cta-text">
        Haz el diagnóstico gratuito en 2 minutos. Sin compromiso.
      </p>
      <Link href="/diagnostico" className="btn btn-primary btn-lg">
        Empezar diagnóstico gratis
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </Link>
    </section>
  )
}

/* ════════════════════════════════════════════════
   SVG Icons
   ════════════════════════════════════════════════ */

function ChartIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M18 20V10M12 20V4M6 20v-6" />
    </svg>
  )
}

function PuzzleIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.611a2.404 2.404 0 0 1-1.705.706 2.404 2.404 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.404 2.404 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.315 8.685a.98.98 0 0 1 .837-.276c.47.07.802.48.968.925a2.501 2.501 0 1 0 3.214-3.214c-.446-.166-.855-.497-.925-.968a.979.979 0 0 1 .276-.837l1.611-1.611a2.404 2.404 0 0 1 1.704-.706 2.404 2.404 0 0 1 1.705.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.969a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.968 1.02z" />
    </svg>
  )
}

function MobileIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <path d="M12 18h.01" />
    </svg>
  )
}

function MessageIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function BookIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  )
}

function PackageIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function QRIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function UtensilsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
      <path d="M7 2v20" />
      <path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
    </svg>
  )
}

function ScissorsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="6" cy="6" r="3" />
      <path d="M8.12 8.12 12 12" />
      <path d="M20 4 8.12 15.88" />
      <circle cx="6" cy="18" r="3" />
      <path d="M14.8 14.8 20 20" />
    </svg>
  )
}

function DumbbellIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M6.5 6.5h11v11H6.5z" />
      <path d="M3 7.5h3.5v9H3zM17.5 7.5H21v9h-3.5z" />
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  )
}

function StoreIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
      <path d="M2 7h20" />
      <path d="M22 7v3a2 2 0 0 1-2 2v0a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12v0a2 2 0 0 1-2-2V7" />
    </svg>
  )
}

function BriefcaseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  )
}
