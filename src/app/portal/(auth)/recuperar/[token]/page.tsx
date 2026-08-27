import Link from 'next/link'
import { cuentasDeTokenReset } from '@/lib/portal-reset'
import NuevaPasswordForm from './NuevaPasswordForm'

export const dynamic = 'force-dynamic'

// La pantalla a la que lleva el enlace del correo. Es pública —quien llega aquí
// no puede entrar al portal—; el permiso lo da el token de la URL, que se valida
// en el servidor antes de pintar nada.
export default async function RecuperarPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const valido = await cuentasDeTokenReset(token)

  if (!valido) {
    return (
      <div className="login-container">
        <div className="login-box">
          <div className="login-header">
            <div className="login-logo-group">
              <img src="/logo_color.svg" alt="CLAUX" height={48} />
            </div>
            <p className="login-subtitle">Digitaliza tu negocio</p>
          </div>
          <div className="card card-lg">
            <h1 className="login-card-title">El enlace ya no vale</h1>
            <div className="alert alert-warning">
              Los enlaces caducan a la hora y solo pueden usarse una vez. Si ya lo usaste,
              entra con la contraseña que definiste.
            </div>
            <Link href="/portal/login" className="btn btn-secondary btn-full btn-lg">
              Volver al inicio de sesión
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return <NuevaPasswordForm token={token} email={valido.email} cuentas={valido.cuentas} />
}
