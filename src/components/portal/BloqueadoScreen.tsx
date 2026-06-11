const MENSAJES: Record<string, { titulo: string; texto: string }> = {
  SUSPENDIDO: {
    titulo: 'Cuenta suspendida',
    texto:  'Tu suscripción ha sido suspendida. Contacta con soporte para regularizar tu situación y recuperar el acceso.',
  },
  VENCIDO: {
    titulo: 'Suscripción vencida',
    texto:  'Tu período de suscripción ha expirado. Renueva tu plan para continuar usando CLAUX.',
  },
}

export default function BloqueadoScreen({ estado }: { estado: string }) {
  const msg = MENSAJES[estado] ?? {
    titulo: 'Acceso restringido',
    texto:  'Tu cuenta no tiene acceso activo. Contacta con soporte.',
  }

  return (
    <div className="bloqueado-screen">
      <div className="bloqueado-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0110 0v4"/>
        </svg>
      </div>
      <h2 className="bloqueado-titulo">{msg.titulo}</h2>
      <p className="bloqueado-texto">{msg.texto}</p>
      <a href="mailto:soporte@claux.app" className="btn btn-primary">
        Contactar soporte
      </a>
    </div>
  )
}
