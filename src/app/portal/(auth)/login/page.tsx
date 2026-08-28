'use client'

import { useState, useTransition } from 'react'
import { useRouter }               from 'next/navigation'
import { loginCliente }            from '@/app/actions/portal/auth'
import { solicitarResetPortal }    from '@/app/actions/portal/password-reset'
import CampoPassword           from '@/components/CampoPassword'

export default function PortalLoginPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error,    setError]    = useState('')
  // La recuperación vive en esta misma tarjeta (no en otra ruta): quien no puede
  // entrar ya está aquí, y volver atrás es un clic.
  const [modo,     setModo]     = useState<'login' | 'recuperar'>('login')
  const [enviado,  setEnviado]  = useState('')

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await loginCliente(fd)
      if (result?.error) {
        setError(result.error)
      } else if (result?.mustChangePassword) {
        router.push('/portal/cambiar-password')
      } else {
        router.push('/portal/dashboard')
      }
    })
  }

  function handleRecuperar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const fd    = new FormData(e.currentTarget)
    const email = ((fd.get('email') as string) ?? '').trim()
    startTransition(async () => {
      const result = await solicitarResetPortal(fd)
      if (!result.ok) { setError(result.error ?? 'No se pudo enviar el enlace.'); return }
      setEnviado(email)
    })
  }

  function volverALogin() {
    setModo('login'); setError(''); setEnviado('')
  }

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
          {modo === 'login' ? (
            <>
              <h1 className="login-card-title">Iniciar sesión</h1>

              <form onSubmit={handleSubmit} className="login-form" noValidate>

                <div className="form-group">
                  <label className="form-label">Email <span className="required">*</span></label>
                  <input
                    className="form-input"
                    type="email"
                    name="email"
                    autoComplete="email"
                    placeholder="tu@empresa.com"
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Contraseña <span className="required">*</span></label>
                  <CampoPassword
                    name="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    required
                  />
                </div>

                {error && <div className="alert alert-error">{error}</div>}

                <button
                  type="submit"
                  disabled={isPending}
                  className="btn btn-primary btn-full btn-lg"
                >
                  {isPending
                    ? <><span className="spinner spinner-sm" /> Entrando…</>
                    : 'Iniciar sesión'}
                </button>

                <button
                  type="button"
                  className="login-forgot-link"
                  onClick={() => { setModo('recuperar'); setError('') }}
                >
                  ¿Olvidaste tu contraseña?
                </button>

              </form>
            </>
          ) : (
            <>
              <h1 className="login-card-title">Recuperar contraseña</h1>

              {enviado ? (
                <>
                  <div className="alert alert-success">
                    Si <strong>{enviado}</strong> tiene una cuenta, le llega un enlace para
                    definir una contraseña nueva. Caduca en una hora y solo sirve una vez.
                  </div>
                  <p className="text-sm-muted">
                    ¿No aparece? Revisa el correo no deseado antes de volver a pedirlo.
                  </p>
                  <button
                    type="button"
                    className="login-forgot-link link-full-center mt-5"
                    onClick={volverALogin}
                  >
                    ← Volver al inicio de sesión
                  </button>
                </>
              ) : (
                <form onSubmit={handleRecuperar} className="login-form" noValidate>
                  <p className="text-sm-muted">
                    Escribe el email con el que entras y te enviamos un enlace para
                    ponerle una contraseña nueva.
                  </p>

                  <div className="form-group">
                    <label className="form-label">Email <span className="required">*</span></label>
                    <input
                      className="form-input"
                      type="email"
                      name="email"
                      autoComplete="email"
                      placeholder="tu@empresa.com"
                      required
                    />
                  </div>

                  {error && <div className="alert alert-error">{error}</div>}

                  <button
                    type="submit"
                    disabled={isPending}
                    className="btn btn-primary btn-full btn-lg"
                  >
                    {isPending
                      ? <><span className="spinner spinner-sm" /> Enviando…</>
                      : 'Enviar enlace'}
                  </button>

                  <button type="button" className="login-forgot-link" onClick={volverALogin}>
                    ← Volver al inicio de sesión
                  </button>
                </form>
              )}
            </>
          )}
        </div>

        <p className="login-footer">
          ¿Problemas de acceso?{' '}
          <a href="mailto:soporte@claux.es">soporte@claux.es</a>
        </p>
      </div>
    </div>
  )
}
