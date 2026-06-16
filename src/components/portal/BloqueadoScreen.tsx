import { Lock } from 'lucide-react'
const MENSAJES: Record<string, { titulo: string; texto: string }> = {
  DESACTIVADO: {
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
        <Lock size={32} strokeWidth={1.5} />
      </div>
      <h2 className="bloqueado-titulo">{msg.titulo}</h2>
      <p className="bloqueado-texto">{msg.texto}</p>
      <a href="mailto:soporte@claux.app" className="btn btn-primary">
        Contactar soporte
      </a>
    </div>
  )
}
