import { createClient } from '@/lib/supabase/server'
import PerfilForm from './PerfilForm'

export default async function ConfiguracionPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const displayName: string =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.email?.split('@')[0] ?? 'Admin')

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
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
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
              <span className="badge badge-info" style={{ marginTop: '0.5rem', display: 'inline-flex' }}>Super Admin</span>
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
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
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

      </div>
    </div>
  )
}
