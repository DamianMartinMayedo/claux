'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Upload } from 'lucide-react'

// Clave de descarte por navegador. Un único aviso, un único destino → clave fija.
const DISMISS_KEY = 'importar-bienvenida'

// Aviso de bienvenida al importador de AUTOSERVICIO (plan §5/§6). Aparece SOLO cuando
// el servidor confirma `migracion_estado='pendiente'` ∧ `autoimport_activo` ∧ el usuario
// puede importar (todo resuelto en el dashboard con `accesoImportCliente`, la MISMA regla
// que pinta la entrada del menú y guarda la página). NO es un candado: la herramienta
// existe igual; esto solo la NOMBRA a quien trae datos de un sistema anterior.
//
// «Descartable POR USUARIO» (plan §5): un self-import NO cambia `migracion_estado` —el
// cierre lo gobierna el equipo—, así que el descarte vive en localStorage por navegador,
// no en BD. Mismo patrón que el auto-aviso de IA (`IaTouchpoint`). Cuando el cliente
// contrata la migración o el equipo la termina, el estado cambia y el servidor deja de
// mandar `mostrar`: el aviso desaparece solo, sin depender del descarte local.
export default function ImportarBienvenidaBanner({ mostrar }: { mostrar: boolean }) {
  // Arranca oculto y se decide tras montar: leer localStorage en el primer render
  // divergiría del HTML del servidor (que no lo tiene) y rompería la hidratación.
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!mostrar) return
    try { if (localStorage.getItem(DISMISS_KEY) !== '1') setVisible(true) } catch { setVisible(true) }
  }, [mostrar])

  if (!mostrar || !visible) return null

  function descartar() {
    setVisible(false)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch {}
  }

  return (
    <div className="alert alert-info alert-cta">
      <span className="alert-cta-texto">
        <strong>¿Tienes datos de antes?</strong> Trae tus productos, terceros, saldos… de tu sistema anterior. Te guiamos paso a paso.
        <span className="alert-cta-nota">Se conserva lo que ya tengas y, si algo no cuadra, puedes deshacer la importación.</span>
      </span>
      <span className="alert-cta-acciones">
        <Link href="/portal/importar-datos" className="btn btn-primary btn-sm">
          <Upload size={15} strokeWidth={2} /> Traer mis datos
        </Link>
        <button type="button" className="btn btn-ghost btn-sm" onClick={descartar}>Ahora no</button>
      </span>
    </div>
  )
}
