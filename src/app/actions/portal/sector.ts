'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession }  from './auth'
import { etiquetasCliente, ETIQUETAS_DEFAULT, type EtiquetasSector } from '@/lib/sector'

// Resuelve las etiquetas del negocio actual: **override del cliente → sector →
// genérico** (mig. 164). Las páginas del portal las usan para rotular
// "Reservas"/"Citas"/"Clases", "Mesa"/"Profesional", "Membresías"/"Bonos", etc., sin
// hornear el vertical en el código.
export async function obtenerEtiquetasNegocio(): Promise<EtiquetasSector> {
  const session = await getPortalSession()
  if (!session) return { ...ETIQUETAS_DEFAULT }

  const db = createAdminClient()
  const { data: cli } = await db.from('clients')
    .select('sector, etiquetas')
    .eq('client_id', session.client_id)
    .single()
  if (!cli) return { ...ETIQUETAS_DEFAULT }

  const { data: pl } = cli.sector
    ? await db.from('plantillas_sector').select('etiquetas').eq('sector', cli.sector).maybeSingle()
    : { data: null }
  return etiquetasCliente(pl?.etiquetas, cli.etiquetas)
}
