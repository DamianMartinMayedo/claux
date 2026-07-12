import { requireAccesoPagina } from '@/lib/admin-guard'
import { CreditCard, Lock, User } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/app/actions/settings'
import PerfilForm from './PerfilForm'
import FacturacionForm from './FacturacionForm'

export default async function ConfiguracionPage() {
  await requireAccesoPagina('configuracion')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const displayName: string =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.email?.split('@')[0] ?? 'Admin')

  const setupDefault   = parseFloat(await getSetting('pago_setup_usd_default', '1000')) || 0
  const descuentoAnual = parseInt(await getSetting('descuento_anual_pct', '10'), 10) || 0
  const diasTrial      = parseInt(await getSetting('dias_trial_default', '15'), 10) || 0

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Configuración</h1>
          <p className="page-subtitle">Gestiona tu perfil y preferencias del panel</p>
        </div>
      </div>

      <div className="config-grid">

        {/* Perfil */}
        <section className="card card-lg config-section">
          <div className="config-section-header">
            <div className="config-section-icon">
              <User size={20} />
            </div>
            <div>
              <h2 className="config-section-title">Perfil</h2>
              <p className="config-section-sub">Datos de tu cuenta de administrador</p>
            </div>
          </div>

          {/* Avatar + info */}
          <div className="profile-hero">
            <div className="profile-avatar-lg">
              {displayName.split(' ').map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'}
            </div>
            <div>
              <p className="profile-name">{displayName}</p>
              <p className="profile-email">{user?.email}</p>
              <span className="badge badge-info mt-2">Super Admin</span>
            </div>
          </div>

          <PerfilForm
            initialName={displayName}
            email={user?.email ?? ''}
          />
        </section>

        {/* Seguridad */}
        <section className="card card-lg config-section">
          <div className="config-section-header">
            <div className="config-section-icon">
              <Lock size={20} />
            </div>
            <div>
              <h2 className="config-section-title">Seguridad</h2>
              <p className="config-section-sub">Contraseña y acceso al panel</p>
            </div>
          </div>

          <div className="config-security-block">
            <div>
              <p className="config-field-label">Contraseña</p>
              <p className="config-field-hint">
                Recibirás un enlace en tu correo para establecer una nueva contraseña de forma segura.
              </p>
            </div>
            <PerfilForm email={user?.email ?? ''} initialName={displayName} passwordOnly />
          </div>
        </section>

        {/* Facturación */}
        <section className="card card-lg config-section">
          <div className="config-section-header">
            <div className="config-section-icon">
              <CreditCard size={20} />
            </div>
            <div>
              <h2 className="config-section-title">Facturación</h2>
              <p className="config-section-sub">Pago de configuración, descuento anual y días de prueba</p>
            </div>
          </div>

          <FacturacionForm
            setupDefault={setupDefault}
            descuentoAnual={descuentoAnual}
            diasTrial={diasTrial}
          />
        </section>

      </div>
    </div>
  )
}
