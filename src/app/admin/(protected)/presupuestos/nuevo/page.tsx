import { requireAccesoPagina } from '@/lib/admin-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { listarModulosParaPresupuesto, listarComerciales } from '@/app/actions/presupuestos'
import { LIMITE_FUNDADOR } from '@/lib/presupuesto/config'
import { cargarParametros } from '@/lib/presupuesto/parametros'
import PresupuestoCalculadora from './PresupuestoCalculadora'

export const dynamic = 'force-dynamic'

export default async function NuevoPresupuestoPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string; cliente?: string }>
}) {
  const ctx = await requireAccesoPagina('presupuestos')
  const { lead, cliente } = await searchParams

  // Los precios se cargan AQUÍ y viajan enteros a la calculadora, que se los pasa al
  // cálculo. La misma tanda llega luego a la acción de guardar, para que la vista previa y
  // el recálculo autoritativo no puedan partir de números distintos.
  const [modulos, comerciales, parametros] = await Promise.all([
    listarModulosParaPresupuesto(),
    listarComerciales(),
    cargarParametros(),
  ])

  const db = createAdminClient()

  // Prefill desde un lead de diagnóstico o desde un CLIENTE QUE YA EXISTE (opcionales).
  let prefill = {
    diagnosticoId: null as number | null,
    clientId: null as string | null,
    nombreNegocio: '', contacto: '', modulos: [] as string[],
  }

  // Presupuesto para un cliente en marcha: es el caso de la ampliación —contrata inventario
  // seis meses después y hay que configurarlo y migrar—, que hasta ahora no se podía cotizar
  // aunque la acción ya aceptara el `clientId`. Se precargan sus módulos actuales para que el
  // comercial marque solo lo que se añade.
  if (cliente) {
    const { data } = await db
      .from('clients')
      .select('client_id, nombre_empresa, nombre_contacto, email_admin, telefono, modulos_activos, tarifa')
      .eq('client_id', cliente)
      .maybeSingle()
    if (data) {
      prefill = {
        diagnosticoId: null,
        clientId:      data.client_id,
        nombreNegocio: data.nombre_empresa ?? '',
        contacto:      data.telefono || data.email_admin || '',
        modulos:       Array.isArray(data.modulos_activos)
          ? data.modulos_activos.filter((c: string) => modulos.some(m => m.clave === c))
          : [],
      }
    }
  }

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
          clientId:      null,
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
    <PresupuestoCalculadora
      modulos={modulos}
      comerciales={comerciales}
      comercialEmailDefault={ctx.email}
      tarifaSugerida={tarifaSugerida}
      parametros={parametros}
      prefill={prefill}
    />
  )
}
