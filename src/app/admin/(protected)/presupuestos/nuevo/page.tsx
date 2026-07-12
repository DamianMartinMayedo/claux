import { requireAccesoPagina } from '@/lib/admin-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { listarModulosParaPresupuesto, listarComerciales } from '@/app/actions/presupuestos'
import { LIMITE_FUNDADOR } from '@/lib/presupuesto/config'
import VentasTabs from '@/components/admin/VentasTabs'
import PresupuestoCalculadora from './PresupuestoCalculadora'

export const dynamic = 'force-dynamic'

export default async function NuevoPresupuestoPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string }>
}) {
  const ctx = await requireAccesoPagina('presupuestos')
  const { lead } = await searchParams

  const [modulos, comerciales] = await Promise.all([
    listarModulosParaPresupuesto(),
    listarComerciales(),
  ])

  const db = createAdminClient()

  // Prefill desde un lead de diagnóstico (opcional).
  let prefill = { diagnosticoId: null as number | null, nombreNegocio: '', contacto: '', modulos: [] as string[] }
  if (lead) {
    const id = parseInt(lead, 10)
    if (!Number.isNaN(id)) {
      const { data } = await db
        .from('diagnosticos')
        .select('id, nombre, telefono, email, modulos_rec')
        .eq('id', id)
        .maybeSingle()
      if (data) {
        const rec = (data.modulos_rec ?? []).filter((c: string) => modulos.some(m => m.clave === c))
        prefill = {
          diagnosticoId: data.id,
          nombreNegocio: data.nombre ?? '',
          contacto:      data.telefono || data.email || '',
          modulos:       rec,
        }
      }
    }
  }

  // Sugerencia de tarifa: fundador si aún estamos dentro de los primeros N clientes.
  const { count } = await db.from('clients').select('*', { count: 'exact', head: true })
  const tarifaSugerida: 'fundador' | 'estandar' = (count ?? 0) < LIMITE_FUNDADOR ? 'fundador' : 'estandar'

  return (
    <>
      <VentasTabs rol={ctx.rol} permisos={ctx.permisos} />
      <PresupuestoCalculadora
        modulos={modulos}
        comerciales={comerciales}
        comercialEmailDefault={ctx.email}
        tarifaSugerida={tarifaSugerida}
        prefill={prefill}
      />
    </>
  )
}
