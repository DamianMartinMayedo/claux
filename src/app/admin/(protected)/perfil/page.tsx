import { Lock, User } from 'lucide-react'
import { requireContextoAdmin } from '@/lib/admin-guard'
import { createClient } from '@/lib/supabase/server'
import { ROL_LABEL } from '@/lib/roles'
import PerfilForm from './PerfilForm'

/**
 * Tus datos y tu contraseña, y nada más.
 *
 * Estaba dentro de `/admin/configuracion`, en la pestaña «Cuenta», junto a los
 * datos fiscales del proveedor y los precios del presupuesto. Dos cosas que no
 * se parecen: esto es TUYO y lo ve cualquiera que entre; lo otro es la
 * configuración de CLAUX y la toca quien tiene esa sección.
 *
 * Por eso el guard es `requireContextoAdmin` y no `requireAccesoPagina`: no hay
 * permiso que valga para mirarse el propio nombre. Un vendedor sin ninguna
 * sección de Sistema llega aquí desde su menú de cuenta.
 */
export default async function PerfilAdminPage() {
  const ctx = await requireContextoAdmin()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const displayName: string =
    (user?.user_metadata?.full_name as string | undefined) || ctx.nombre || (user?.email?.split('@')[0] ?? 'Admin')
  const email = user?.email ?? ctx.email

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mi perfil</h1>
          <p className="page-subtitle">Tus datos de acceso al panel</p>
        </div>
      </div>

      {/* Las dos caben una al lado de la otra: son cortas y hablan de lo mismo. */}
      <div className="grid-cols-2">
        <section className="card card-lg config-section">
          <div className="config-section-header">
            <div className="config-section-icon">
              <User size={20} />
            </div>
            <div>
              <h2 className="config-section-title">Perfil</h2>
              <p className="config-section-sub">Datos de tu cuenta</p>
            </div>
          </div>

          <div className="profile-hero">
            <div className="profile-avatar-lg">
              {displayName.split(' ').map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'}
            </div>
            <div>
              <p className="profile-name">{displayName}</p>
              <p className="profile-email">{email}</p>
              {/* El rol es el de quien mira, no «Super Admin» siempre: esa etiqueta
                  estaba escrita a mano y le decía «Super Admin» a un vendedor. */}
              <span className="badge badge-info mt-2">{ROL_LABEL[ctx.rol]}</span>
            </div>
          </div>

          <PerfilForm initialName={displayName} email={email} />
        </section>

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
            <PerfilForm email={email} initialName={displayName} passwordOnly />
          </div>
        </section>
      </div>
    </div>
  )
}
