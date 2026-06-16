import { ZapOff } from 'lucide-react'
interface Props {
  titulo:     string
  subtitulo?: string
  mensaje?:   string
}

/**
 * Placeholder reutilizable para módulos declarados pero aún sin implementar.
 * Evita el 404 y mantiene el shell del portal (sidebar + header).
 * Mismo patrón visual que el dashboard (clases del design system, sin estilos inline).
 */
export default function EnConstruccion({ titulo, subtitulo, mensaje }: Props) {
  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">{titulo}</h1>
          {subtitulo && <p className="page-subtitle">{subtitulo}</p>}
        </div>
      </div>
      <div className="modulo-placeholder">
        <ZapOff size={48} strokeWidth={1.5} />
        <h3>{titulo} en construcción</h3>
        <p>{mensaje ?? 'Este módulo estará disponible próximamente.'}</p>
      </div>
    </div>
  )
}
