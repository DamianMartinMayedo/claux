import { notFound, redirect } from 'next/navigation'
import { requireAccesoModulo } from '@/app/actions/portal/auth'
import { obtenerDossier }      from '@/app/actions/portal/dossier'
import DossierNuevo            from './DossierNuevo'

export const dynamic = 'force-dynamic'

// Crear un dossier desde cero. Gana a /portal/dossier/[dossierId] porque Next
// resuelve antes los segmentos estáticos que los dinámicos.
//
// El gate real lo pone `crearDossier` en el servidor, no esta página: llegar al
// wizard sin el addon es inofensivo — el botón «Crear dossier» devolverá el aviso
// de que su suscripción permite uno solo, que es además donde el upsell tiene sentido.
export default async function DossierNuevoPage() {
  const { puedeEditar } = await requireAccesoModulo('dossier')
  // Crear es escritura: quien solo puede ver no entra al wizard, vuelve al listado.
  if (!puedeEditar) redirect('/portal/dossier')

  const data = await obtenerDossier()
  if (!data) notFound()

  // El wizard necesita el CONTEXTO del cliente (empresas, monedas, categorías, qué
  // módulos tiene) pero NO un dossier: va a crear uno. Sin vaciarlo arrancaría
  // editando el que ya existe, porque la lectura sin id devuelve el más antiguo.
  return <DossierNuevo data={{ ...data, dossier: null, serie: [], lineas: [], secciones: [] }} />
}
