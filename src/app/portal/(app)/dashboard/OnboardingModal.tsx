'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import ModalShell from '@/components/portal/ModalShell'
import type { FormPaso } from '@/lib/onboarding/pasos'
import { obtenerMonedasActivas } from '@/app/actions/portal/monedas'
import { obtenerEmpresas, type Empresa } from '@/app/actions/portal/empresas'

// Los pasos de la puesta en marcha se resuelven aquí, en el dashboard, abriendo EL
// MISMO modal que su página. No una versión reducida: el de empresa trae su color,
// su logo, su moneda funcional y su letra. Un formulario recortado deja la ficha a
// medias y obliga a volver a ella, que es justo la navegación que esto viene a
// ahorrar —y en una conexión cubana, cada navegación son segundos en blanco.
//
// Los dos modales se cargan BAJO DEMANDA (`next/dynamic`): el dashboard no arrastra
// dos formularios grandes que solo se abren una vez en la vida del cliente.
//
// `letra` no tiene modal propio: es un campo de la ficha de empresa, así que abre
// ese mismo modal en edición.

const MonedaModal  = dynamic(() => import('../monedas/_MonedaModal'))
const EmpresaModal = dynamic(() => import('../empresas/_EmpresaModal'))

const TITULOS: Record<FormPaso, string> = {
  moneda:  'Moneda',
  empresa: 'Nueva empresa',
  letra:   'Letra de facturación',
}

type Datos = {
  monedas:  { codigo: string; nombre: string; simbolo: string }[]
  empresas: Empresa[]
}

export default function OnboardingModal({
  form, onClose, onSaved,
}: {
  form:    FormPaso
  onClose: () => void
  onSaved: () => void
}) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const necesitaEmpresas = form !== 'moneda'

  useEffect(() => {
    if (!necesitaEmpresas) return
    let vivo = true
    Promise.all([obtenerMonedasActivas(), obtenerEmpresas()]).then(([ms, es]) => {
      if (!vivo) return
      setDatos({
        // `simbolo` es opcional en `MonedaOpcion` (una moneda vieja puede no
        // tenerlo) y el selector lo pinta entre paréntesis: vacío antes que
        // «undefined» a la vista.
        monedas: ms.map(m => ({ codigo: m.codigo, nombre: m.nombre ?? m.codigo, simbolo: m.simbolo ?? '' })),
        empresas: es,
      })
    })
    return () => { vivo = false }
  }, [necesitaEmpresas])

  if (form === 'moneda') {
    // La página de Monedas arranca en USD porque allí se añade una SEGUNDA y el
    // peso ya suele estar. Esta es la primera moneda de un negocio cubano.
    return <MonedaModal moneda={null} catalogoInicial="CUP"
      onClose={onClose} onSaved={onSaved} onPedirEliminar={onClose} />
  }

  // Cascarón de carga: en Cuba el dato tarda, y un modal vacío parece roto.
  if (!datos) {
    return (
      <ModalShell title={TITULOS[form]} onClose={onClose} size="modal-sm">
        <div className="modal-body onb-modal-cargando"><span className="spinner" /></div>
      </ModalShell>
    )
  }

  // La letra se asigna en EDICIÓN sobre la primera empresa que no la tenga, que es
  // la que dispara el paso: así el dueño la pone viendo el resto de la ficha, no a
  // ciegas. Sin empresas no hay nada que editar (y ese paso ni se ofrece todavía).
  const aEditar = form === 'letra'
    ? datos.empresas.find(e => !e.letra_facturacion) ?? datos.empresas[0] ?? null
    : null
  if (form === 'letra' && !aEditar) return null

  return <EmpresaModal
    state={{ open: true, empresa: aEditar }}
    monedas={datos.monedas} empresas={datos.empresas}
    // Desde el paso de la letra se llega a un formulario ya lleno: sin señalar el
    // campo, el dueño no sabe qué venía a tocar. Se le lleva a él y ahí sí es
    // obligatorio, que es lo único que ha venido a hacer.
    enfocar={form === 'letra' ? 'letra' : undefined}
    onClose={onClose} onSaved={onSaved} />
}
