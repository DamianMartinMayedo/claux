import { CreditCard, Lock, User, Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/app/actions/settings'
import PerfilForm from './PerfilForm'
import FacturacionForm from './FacturacionForm'
import IaConfigForm from './IaConfigForm'

interface UsoRow { client_id: string; nombre: string; conversaciones: number; tokens: number }

export default async function ConfiguracionPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const displayName: string =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.email?.split('@')[0] ?? 'Admin')

  const setupDefault   = parseFloat(await getSetting('pago_setup_usd_default', '1000')) || 0
  const descuentoAnual = parseInt(await getSetting('descuento_anual_pct', '10'), 10) || 0
  const diasTrial      = parseInt(await getSetting('dias_trial_default', '15'), 10) || 0

  const iaModel   = await getSetting('ia_model', 'deepseek-v4-flash-free')
  const iaApiBase = await getSetting('ia_api_base', 'https://opencode.ai/zen/v1')

  // Consumo de IA del mes en curso por tenant (CONTEXTO §8). El gasto en $ real
  // se consulta en el panel de billing del proveedor (OpenCode Zen).
  const periodo = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Havana', year: 'numeric', month: '2-digit',
  }).format(new Date()).slice(0, 7)
  const { data: usoRaw } = await supabase
    .from('ia_uso')
    .select('client_id, conversaciones, tokens_in, tokens_out')
    .eq('periodo', periodo)
    .order('conversaciones', { ascending: false })
  const filas = usoRaw ?? []
  const ids = [...new Set(filas.map(r => r.client_id as string))]
  const { data: clientesRows } = ids.length
    ? await supabase.from('clients').select('client_id, nombre_empresa').in('client_id', ids)
    : { data: [] }
  const nombres = Object.fromEntries((clientesRows ?? []).map(c => [c.client_id as string, c.nombre_empresa as string]))
  const usoIa: UsoRow[] = filas.map(r => ({
    client_id: r.client_id as string,
    nombre: nombres[r.client_id as string] ?? (r.client_id as string),
    conversaciones: Number(r.conversaciones) || 0,
    tokens: (Number(r.tokens_in) || 0) + (Number(r.tokens_out) || 0),
  }))
  const totalConv   = usoIa.reduce((s, r) => s + r.conversaciones, 0)
  const totalTokens = usoIa.reduce((s, r) => s + r.tokens, 0)

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

        {/* Asistente IA: modelo del proveedor + consumo por tenant */}
        <section className="card card-lg config-section">
          <div className="config-section-header">
            <div className="config-section-icon">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="config-section-title">Asistente IA</h2>
              <p className="config-section-sub">Modelo del proveedor y consumo del mes por cliente</p>
            </div>
          </div>

          <IaConfigForm model={iaModel} apiBase={iaApiBase} />

          <div className="config-ia-uso">
            <div className="config-field-label">Consumo este mes ({periodo})</div>
            {usoIa.length === 0 ? (
              <p className="config-field-hint">Aún no hay consumo de IA registrado este mes.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr><th>Cliente</th><th className="text-right">Conversaciones</th><th className="text-right">Tokens</th></tr>
                </thead>
                <tbody>
                  {usoIa.map(r => (
                    <tr key={r.client_id}>
                      <td>{r.nombre}</td>
                      <td className="text-right">{r.conversaciones.toLocaleString('es-ES')}</td>
                      <td className="text-right">{r.tokens.toLocaleString('es-ES')}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td>Total</td><td className="text-right">{totalConv.toLocaleString('es-ES')}</td><td className="text-right">{totalTokens.toLocaleString('es-ES')}</td></tr>
                </tfoot>
              </table>
            )}
          </div>
        </section>

      </div>
    </div>
  )
}
