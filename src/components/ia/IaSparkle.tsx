import { useId } from 'react'
import { Sparkles } from 'lucide-react'

// La estrellita de IA con el TRAZO en degradado de marca (primary → amber), el
// mismo lenguaje visual de .ia-tp-icon y los titulares. Es la marca «esto es IA»
// y la usan LAS DOS CARAS: en el portal identifica lo que gasta el addon, en el
// admin lo que gasta nuestra bolsa interna. Por eso vive aquí y no en
// `components/portal/ia/` —donde nació—: la IA del admin se ve igual que la del
// portal a propósito, para que nadie tenga que aprender dos lenguajes visuales.
// Cada instancia lleva su propio <defs> con id único (useId) para que dos en la
// misma página no colisionen.
export default function IaSparkle({ size = 13, strokeWidth = 2.5 }: { size?: number; strokeWidth?: number }) {
  const gradId = `iaspark-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <>
      <svg className="ia-grad-defs" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" className="ia-grad-0" />
            <stop offset="100%" className="ia-grad-1" />
          </linearGradient>
        </defs>
      </svg>
      <Sparkles className="ia-sparkle-icon" size={size} strokeWidth={strokeWidth} color={`url(#${gradId})`} />
    </>
  )
}
