import { requireAccesoPagina } from '@/lib/admin-guard'
import { Calculator, CreditCard, Lock, Scale, User } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/app/actions/settings'
import { PAGINAS_LEGALES } from '@/lib/publico/legal'
import { cargarParametros } from '@/lib/presupuesto/parametros'
import { AJUSTES_PRESUPUESTO } from '@/lib/presupuesto/config'
import PerfilForm from './PerfilForm'
import FacturacionForm from './FacturacionForm'
import PresupuestoForm from './PresupuestoForm'
import LegalForm from './LegalForm'
import ConfiguracionTabs from './ConfiguracionTabs'

export default async function ConfiguracionPage() {
  await requireAccesoPagina('configuracion')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const displayName: string =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.email?.split('@')[0] ?? 'Admin')

  const descuentoAnual = parseInt(await getSetting('descuento_anual_pct', '10'), 10) || 0
  const diasTrial      = parseInt(await getSetting('dias_trial_default', '15'), 10) || 0

  // Los precios del presupuesto de instalación (mig. 168): antes eran constantes del código.
  const parametros = await cargarParametros()
  const escalaresPresupuesto = Object.fromEntries(
    (Object.keys(AJUSTES_PRESUPUESTO) as (keyof typeof AJUSTES_PRESUPUESTO)[])
      .map(k => [k, parametros[k]]),
  )

  const slugsLegales = Object.keys(PAGINAS_LEGALES)
  const textosLegales = Object.fromEntries(
    await Promise.all(
      slugsLegales.map(async (slug) => [slug, await getSetting(PAGINAS_LEGALES[slug].clave, '')] as const),
    ),
  )

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Configuración</h1>
          <p className="page-subtitle">Gestiona tu perfil y preferencias del panel</p>
        </div>
      </div>

      <ConfiguracionTabs
        cuenta={
          <>
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
          </>
        }
        facturacion={
          <section className="card card-lg config-section">
            <div className="config-section-header">
              <div className="config-section-icon">
                <CreditCard size={20} />
              </div>
              <div>
                <h2 className="config-section-title">Facturación</h2>
                <p className="config-section-sub">Descuento anual y días de prueba</p>
              </div>
            </div>

            <FacturacionForm
              descuentoAnual={descuentoAnual}
              diasTrial={diasTrial}
            />
          </section>
        }
        presupuesto={
          /* `config-section-ancha`: la rejilla de precios son seis columnas y el tope de
             760px de una sección sola la estrangulaba. */
          <section className="card card-lg config-section config-section-ancha">
            <div className="config-section-header">
              <div className="config-section-icon">
                <Calculator size={20} />
              </div>
              <div>
                <h2 className="config-section-title">Presupuesto de instalación</h2>
                <p className="config-section-sub">
                  Tarifa por hora y lo que cuesta cada línea según el volumen
                </p>
              </div>
            </div>

            <PresupuestoForm
              escalares={escalaresPresupuesto}
              lineas={parametros.lineas}
            />
          </section>
        }
        legales={
          <section className="card card-lg config-section">
            <div className="config-section-header">
              <div className="config-section-icon">
                <Scale size={20} />
              </div>
              <div>
                <h2 className="config-section-title">Textos legales</h2>
                <p className="config-section-sub">
                  Aviso legal, privacidad y cookies: se publican en el acto, sin desplegar
                </p>
              </div>
            </div>

            <LegalForm textos={textosLegales} />
          </section>
        }
      />
    </div>
  )
}
