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
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
        </svg>
        <h3>{titulo} en construcción</h3>
        <p>{mensaje ?? 'Este módulo estará disponible próximamente.'}</p>
      </div>
    </div>
  )
}
