// Anillo de progreso de la puesta en marcha. SVG a mano: una librería de gráficos
// para dibujar un círculo son decenas de kB que en Cuba se pagan en segundos.
//
// El truco que evita el `style=` inline (prohibido por `skills/ui/SKILL.md` §1):
// `pathLength={100}` reescala el perímetro del círculo a 100 unidades, sea cual
// sea el radio, así que el trazo se puede recortar con `strokeDasharray` — que es
// un ATRIBUTO SVG, no CSS— usando el porcentaje directamente. Sin `pathLength`
// habría que calcular 2πr en JavaScript y escribirlo en un `style`.
export default function OnboardingAnillo({
  hechos, total, compacto = false,
}: {
  hechos:    number
  total:     number
  compacto?: boolean
}) {
  const pct = total > 0 ? Math.round((hechos / total) * 100) : 100
  const clase = `onb-anillo${compacto ? ' onb-anillo-sm' : ''}${hechos >= total ? ' is-completo' : ''}`

  return (
    <div className={clase} role="img" aria-label={`${hechos} de ${total} pasos completados`}>
      <svg viewBox="0 0 44 44" aria-hidden focusable="false">
        <circle className="onb-anillo-pista" cx="22" cy="22" r="19" pathLength={100} />
        {/* Un `strokeDasharray` de «0 100» sigue pintando el remate redondeado del
            trazo: a cero pasos se veía un punto de color que parecía progreso. */}
        {pct > 0 && (
          <circle
            className="onb-anillo-valor" cx="22" cy="22" r="19"
            pathLength={100} strokeDasharray={`${pct} ${100 - pct}`}
          />
        )}
      </svg>
      <span className="onb-anillo-txt" aria-hidden>
        {hechos}<span className="onb-anillo-de">/{total}</span>
      </span>
    </div>
  )
}
