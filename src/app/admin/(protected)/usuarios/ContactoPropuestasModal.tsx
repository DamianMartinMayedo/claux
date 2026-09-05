'use client'

import { X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { useModalKeyboard } from '@/lib/use-modal-keyboard'
import { useMounted } from '@/lib/use-mounted'
import { toastError, toastSuccess } from '@/app/contexts/ToastContext'
import { guardarContactoPropuestas, type UsuarioAdmin } from '@/app/actions/usuarios-admin'

/**
 * El contacto que un cliente lee en la propuesta que firma esta persona.
 *
 * Va en su propio modal y no dentro de «Editar usuario» por dos razones: es lo
 * único que se puede tocar de una cuenta base —que no se edita desde el panel—,
 * y no tiene nada que ver con el acceso. Aquí no se cambia ni el rol, ni las
 * secciones, ni la contraseña.
 */
export default function ContactoPropuestasModal({
  usuario,
  onClose,
}: {
  usuario: UsuarioAdmin
  onClose: (guardado: boolean) => void
}) {
  const mounted = useMounted()
  const [nombre, setNombre] = useState(usuario.nombre)
  const [email, setEmail] = useState(usuario.emailPublico ?? '')
  const [tel, setTel]     = useState(usuario.telefonoPublico ?? '')
  const [loading, setLoading] = useState(false)

  const close = useCallback(() => onClose(false), [onClose])
  useModalKeyboard(true, close)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const r = await guardarContactoPropuestas(usuario.email, {
        emailPublico: email, telefonoPublico: tel, nombre,
      })
      if (!r.ok) { toastError(r.error); return }
      toastSuccess('Contacto actualizado')
      onClose(true)
    } finally {
      setLoading(false)
    }
  }

  const modal = (
    <div className="modal-backdrop">
      <div className="modal modal-sm">
        <div className="modal-header">
          <h2 className="modal-title">Contacto en propuestas</h2>
          <button onClick={close} className="modal-close" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p className="text-sm-muted">
              Lo que ve el cliente en las propuestas que firma esta persona. En blanco, firma con
              el de la empresa.
            </p>

            {/* Una cuenta base no se edita desde el panel, así que esta es la
                única pantalla donde puede ponerse su nombre — y es el que sale
                impreso en la portada. Las demás lo tienen en «Editar usuario»:
                pedirlo dos veces sería dos sitios para el mismo dato. */}
            {!usuario.gestionable && (
              <div className="input-group">
                <label htmlFor="cp-nombre">Nombre</label>
                <input id="cp-nombre" className="input" value={nombre}
                  onChange={e => setNombre(e.target.value)} placeholder="Ej: Claudia Cuevas" />
              </div>
            )}

            <div className="input-group">
              <label htmlFor="cp-email">Correo de trabajo</label>
              <input id="cp-email" type="email" className="input" value={email}
                onChange={e => setEmail(e.target.value)} placeholder="persona@claux.es" />
            </div>

            <div className="input-group">
              <label htmlFor="cp-tel">WhatsApp</label>
              <input id="cp-tel" type="tel" className="input" value={tel}
                onChange={e => setTel(e.target.value)} placeholder="+34 600 000 000" />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={close}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <><span className="spinner" /> Guardando...</> : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return mounted ? createPortal(modal, document.body) : null
}
