/**
 * La pantalla de «cargando» de una ruta entera, para los `loading.tsx`.
 *
 * Con la latencia de Cuba, una navegación sin frontera de streaming deja al
 * usuario mirando la pantalla ANTERIOR hasta que vuelve la última consulta de
 * Supabase: parece que el clic no ha entrado, y se vuelve a pinchar. Con un
 * `loading.tsx` el navegador recibe el armazón (cabecera y menú del layout) al
 * instante y esto ocupa el hueco del contenido (loading innegociable,
 * skills/ui/SKILL.md §5).
 *
 * Es el mismo aspecto que <TablaCargando> —la tarjeta con el spinner y la
 * palabra— porque es el mismo momento: no se inventa un segundo lenguaje de
 * espera para el que llega a la página y otro para el que cambia un filtro.
 *
 * `titulo` pinta la cabecera de la página cuando ya se sabe cuál es (una ruta
 * fija como Clientes o Pagos): así el título no aparece de golpe al terminar la
 * carga y el contenido no da el salto. Sin él —la red general del layout, que no
 * sabe adónde vas— solo sale la tarjeta.
 */
export default function CargandoPantalla({ titulo }: { titulo?: string }) {
  return (
    <div className="view-container">
      {titulo && (
        <div className="page-header">
          <div>
            <h1 className="page-title">{titulo}</h1>
          </div>
        </div>
      )}
      <div className="card card-table">
        <div className="mon-empty" role="status" aria-live="polite">
          <span className="spinner spinner-sm" />
          <p>Cargando…</p>
        </div>
      </div>
    </div>
  )
}
