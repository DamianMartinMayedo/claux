import { requireAccesoPagina } from '@/lib/admin-guard'
import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/app/actions/settings'
import { listarPresupuestos } from '@/app/actions/presupuestos'
import PresupuestosView from './PresupuestosView'

export const dynamic = 'force-dynamic'

export default async function PresupuestosPage() {
  const ctx = await requireAccesoPagina('presupuestos')
  const supabase = await createClient()

  const [presupuestos, { data: catalogo }, { data: plantillas }] = await Promise.all([
    listarPresupuestos(),
    supabase
      .from('modulos_catalogo')
      .select('clave, nombre, descripcion, precio_fundador_usd, precio_estandar_usd, es_base, tipo')
      .eq('activo', true)
      .order('orden'),
    supabase
      .from('plantillas_sector')
      .select('sector, nombre, modulos, etiquetas')
      .eq('activa', true)
      .order('orden'),
  ])

  const setupDefault   = parseFloat(await getSetting('pago_setup_usd_default', '1000')) || 0
  const descuentoAnual = parseInt(await getSetting('descuento_anual_pct', '10'), 10) || 0

  return (
    <PresupuestosView
      presupuestos={presupuestos}
      rol={ctx.rol}
      permisos={ctx.permisos}
      catalogo={catalogo ?? []}
      plantillas={plantillas ?? []}
      setupDefault={setupDefault}
      descuentoAnualPct={descuentoAnual}
    />
  )
}
