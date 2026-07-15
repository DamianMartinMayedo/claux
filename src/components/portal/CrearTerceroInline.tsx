'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { TerceroFormModal } from '@/app/portal/(app)/terceros/_TerceroFormModal'

// Enlace reutilizable para crear un cliente/proveedor sin salir del flujo actual
// (facturas, ofertas, gastos/cobros…). Abre el formulario de Terceros con la
// empresa y el tipo prefijados; al guardar refresca los datos y, si se indica,
// autoselecciona el recién creado.
export default function CrearTerceroInline({
  empresas, monedas, defaultTipo, label, onCreated,
}: {
  empresas:     { empresa_id: string; nombre: string }[]
  /** Códigos de las monedas del cliente, tal como los cargan estas vistas. */
  monedas:      string[]
  defaultTipo?: 'CLIENTE' | 'PROVEEDOR' | 'AMBOS'
  label:        string
  onCreated?:   (terceroId?: string) => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className="crear-tercero-link" onClick={() => setOpen(true)}>
        <Plus size={13} strokeWidth={2.5} />
        {label}
      </button>
      {open && (
        <TerceroFormModal
          tercero={null}
          empresas={empresas}
          monedas={monedas.map(codigo => ({ codigo }))}
          defaultTipo={defaultTipo}
          onClose={() => setOpen(false)}
          onSaved={(id) => { setOpen(false); onCreated?.(id); router.refresh() }}
        />
      )}
    </>
  )
}
