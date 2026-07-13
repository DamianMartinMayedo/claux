'use client'

import { Plus } from 'lucide-react'
import { useState } from 'react'
import ClienteFormModal, { type ModuloCatalogo, type PlantillaSector } from './ClienteFormModal'

type Props = {
  catalogo:          ModuloCatalogo[]
  plantillas:        PlantillaSector[]
  setupDefault:      number
  descuentoAnualPct: number
}

// Alta manual de cliente: botón + modal en blanco. La lógica del formulario vive
// en ClienteFormModal (compartido con "crear cliente desde presupuesto").
export default function NuevoClienteModal(props: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        <Plus size={16} />
        Nuevo cliente
      </button>
      <ClienteFormModal {...props} open={open} onClose={() => setOpen(false)} />
    </>
  )
}
