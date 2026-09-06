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
//
// También bloquea el scroll del fondo mientras está abierto. Con un CONTADOR
// y no con un booleano: cuando un modal abre otro encima, al cerrarse el de arriba
// el de abajo sigue abierto, y un booleano habría devuelto el scroll al fondo con
// el diálogo todavía en pantalla.
let abiertos = 0

export default function ModalShell({
  title, subtitle, onClose, size, children,
}: {
  title: React.ReactNode
  /**
   * La línea que dice SOBRE QUÉ es este diálogo: el pago y el cliente, la factura,
   * el trabajador. La mitad de los modales del admin la tenían escrita a mano bajo
   * el `<h2>`; aquí es un dato del componente para que salga siempre igual y para
   * que el lector de pantalla la anuncie con el título (va dentro del elemento al
   * que apunta `aria-labelledby`).
   */
  subtitle?: React.ReactNode
  onClose: () => void
  /** Clase de ancho ya existente: 'modal-lg' | 'modal-md' | 'modal-sm' | 'modal-520'… */
  size?: string
  children: React.ReactNode
}) {
  const titleId = useId()
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (abiertos++ === 0) document.body.style.overflow = 'hidden'
    return () => { if (--abiertos === 0) document.body.style.overflow = '' }
  }, [])

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
          <div id={titleId}>
            <h2 className="modal-title">{title}</h2>
            {subtitle && <p className="modal-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
            <X size={20} strokeWidth={2} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
