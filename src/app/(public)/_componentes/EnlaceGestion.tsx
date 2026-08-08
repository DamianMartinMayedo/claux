'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/**
 * El enlace para gestionar (o cancelar) lo que se acaba de reservar.
 *
 * Antes era un `<a>` suelto en la pantalla de éxito: si el cliente cerraba la pestaña
 * lo perdía para siempre y ya no podía cancelar — que es justo la mitad del no-show.
 * Ahora se le dice que lo guarde y se le da el botón para copiarlo.
 *
 * Vive en `(public)/_componentes` porque lo usan las dos mini-webs (reservar y citas) y
 * usa la paleta pública (`--rp-*`), no los tokens del portal (regla de Cuba, UI §6).
 */
export default function EnlaceGestion({ url, tipo }: {
  url:  string
  tipo: 'reserva' | 'cita'
}) {
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Sin permiso de portapapeles (o http sin TLS): el enlace está a la vista y se
      // puede copiar a mano, así que no se convierte en un error para el cliente.
    }
  }

  return (
    <div className="rp-guardar">
      <p className="rp-guardar-tit">Guarda este enlace</p>
      <p className="rp-guardar-url">{url}</p>
      <div className="rp-guardar-acciones">
        <button type="button" className="rp-copiar" onClick={copiar}>
          {copiado
            ? <><Check size={14} strokeWidth={2.5} /> Copiado</>
            : <><Copy size={14} strokeWidth={2} /> Copiar enlace</>}
        </button>
        <a className="rp-manage-link" href={url}>
          Ver o cancelar mi {tipo}
        </a>
      </div>
    </div>
  )
}
