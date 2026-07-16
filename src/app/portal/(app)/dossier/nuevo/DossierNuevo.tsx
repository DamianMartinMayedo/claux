'use client'

import { useRouter } from 'next/navigation'
import type { DossierData } from '@/app/actions/portal/dossier'
import DossierWizard from '../DossierWizard'

// Wrapper de cliente del wizard de creación. Existe solo por los callbacks.
//
// `onCreado` es la pieza que hace falta con varios dossiers: en cuanto el dossier
// nace, hay que irse a SU ruta. Quedarse aquí y refrescar leería el más antiguo y
// el wizard seguiría editando otro. Al llegar a /portal/dossier/<id>, el editor ve
// la serie vacía, vuelve a modo wizard, y `pasoInicial` reanuda en el paso que toca
// — la reanudación ya era derivada del estado, así que no hay nada que sincronizar.
//
// `replace` y no `push`: el paso 1 ya está guardado en la base, así que un "atrás"
// del navegador a un formulario de creación vacío solo llevaría a crear un duplicado.
export default function DossierNuevo({ data }: { data: DossierData }) {
  const router = useRouter()
  return (
    <DossierWizard
      data={data}
      onRefrescar={() => router.refresh()}
      onCreado={id => router.replace(`/portal/dossier/${id}`)}
      onTerminar={() => router.push('/portal/dossier')}
    />
  )
}
