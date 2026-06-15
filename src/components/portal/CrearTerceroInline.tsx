'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TerceroFormModal } from '@/app/portal/(app)/terceros/_TerceroFormModal'

// Enlace reutilizable para crear un cliente/proveedor sin salir del flujo actual
// (facturas, ofertas, gastos/cobros…). Abre el formulario de Terceros con la
// empresa y el tipo prefijados; al guardar refresca los datos y, si se indica,
// autoselecciona el recién creado.
export default function CrearTerceroInline({
  empresas, defaultTipo, label, onCreated,
}: {
  empresas:     { empresa_id: string; nombre: string }[]
  defaultTipo?: 'CLIENTE' | 'PROVEEDOR' | 'AMBOS'
  label:        string
  onCreated?:   (terceroId?: string) => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className="crear-tercero-link" onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        {label}
      </button>
      {open && (
        <TerceroFormModal
          tercero={null}
          empresas={empresas}
          defaultTipo={defaultTipo}
          onClose={() => setOpen(false)}
          onSaved={(id) => { setOpen(false); onCreated?.(id); router.refresh() }}
        />
      )}
    </>
  )
}
