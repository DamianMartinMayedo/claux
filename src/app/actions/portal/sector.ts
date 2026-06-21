'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { etiquetasDe, ETIQUETAS_DEFAULT, type EtiquetasSector } from '@/lib/sector'

// Resuelve las etiquetas del negocio actual según su sector (onboarding).
// Las páginas del portal las usan para rotular "Reservas"/"Citas"/"Clases",
// "Mesa"/"Profesional", etc., sin hornear el vertical en el código.
export async function obtenerEtiquetasNegocio(): Promise<EtiquetasSector> {
  const session = await getPortalSession()
  if (!session) return { ...ETIQUETAS_DEFAULT }

  const db = createAdminClient()
  const { data: cli } = await db.from('clients')
    .select('sector')
    .eq('client_id', session.client_id)
    .single()
  if (!cli?.sector) return { ...ETIQUETAS_DEFAULT }

  const { data: pl } = await db.from('plantillas_sector')
    .select('etiquetas')
    .eq('sector', cli.sector)
    .maybeSingle()
  return etiquetasDe(pl?.etiquetas)
}
