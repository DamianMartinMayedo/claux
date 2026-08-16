'use client'

import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'

// Base de los modales del portal (Empresas, Usuarios, Monedas). Centraliza lo que
// cada uno repetía a mano —el backdrop, la cabecera con título y botón de cerrar—
// y añade lo que a todos les faltaba: cerrar con Escape, atrapar el foco dentro
// (Tab no se escapa al fondo), devolver el foco a quien abrió al cerrar y
// `aria-labelledby` apuntando al título (un lector de pantalla anuncia de qué es
// el diálogo). NO cierra al hacer clic fuera a propósito: son formularios, y un
// clic despistado no puede tirar lo que llevas escrito.
export default function ModalShell({
  title, onClose, size, children,
}: {
  title: React.ReactNode
  onClose: () => void
  /** Clase de ancho ya existente: 'modal-lg' | 'modal-md' | 'modal-sm' | 'modal-520'… */
  size?: string
  children: React.ReactNode
}) {
  const titleId = useId()
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null
    const cont = modalRef.current

    // Enfocables VISIBLES del modal (offsetParent null = oculto por CSS).
    const enfocables = (): HTMLElement[] =>
      cont
        ? Array.from(
            cont.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter(el => el.offsetParent !== null)
        : []

    // Foco inicial en el primer control (no en el botón de cerrar): quien abre un
    // formulario quiere empezar a rellenarlo.
    const f0 = enfocables()
    ;(f0.find(el => !el.classList.contains('modal-close')) ?? f0[0])?.focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const f = enfocables()
      if (f.length === 0) return
      const primero = f[0]
      const ultimo = f[f.length - 1]
      const activo = document.activeElement as HTMLElement | null
      if (e.shiftKey && (activo === primero || !cont?.contains(activo))) {
        e.preventDefault(); ultimo.focus()
      } else if (!e.shiftKey && activo === ultimo) {
        e.preventDefault(); primero.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      // Devuelve el foco a quien abrió el modal (una fila, un botón «Nuevo»…).
      previo?.focus?.()
    }
  }, [onClose])

  return (
    <div className="modal-backdrop open">
      <div
        ref={modalRef}
        className={`modal${size ? ` ${size}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <h2 className="modal-title" id={titleId}>{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
            <X size={20} strokeWidth={2} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
