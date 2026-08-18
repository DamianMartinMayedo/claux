import { notFound, redirect } from 'next/navigation'
import { requireAccesoPagina } from '@/lib/admin-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { listarModulosParaPresupuesto, listarComerciales } from '@/app/actions/presupuestos'
import { cargarParametros } from '@/lib/presupuesto/parametros'
import { getSetting } from '@/app/actions/settings'
import {
  FASES_INSTALACION, etiquetaFase,
  type FormatoDatos, type TarifaTipo,
} from '@/lib/presupuesto/config'
import PresupuestoCalculadora from '../../nuevo/PresupuestoCalculadora'

export const dynamic = 'force-dynamic'

export default async function EditarPresupuestoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const ctx = await requireAccesoPagina('presupuestos')
  const { id } = await params
  const presId = parseInt(id, 10)
  if (Number.isNaN(presId)) notFound()

  const db = createAdminClient()
  const { data: pres } = await db
    .from('presupuestos_instalacion')
    .select('*')
    .eq('id', presId)
    .maybeSingle()
  if (!pres) notFound()

  // Un presupuesto solo es editable mientras es borrador: 'aprobado' se congela (es la prueba
  // de lo pactado que se le enseñó al cliente) e 'instalado' ya tiene horas reales. Si no está
  // en 'guardado', de vuelta a la lista —el botón de editar ni siquiera aparece en esos
  // estados, esto es el candado por si se llega por URL directa.
  if (pres.estado !== 'guardado') redirect('/admin/presupuestos')

  const [modulos, comerciales, parametros] = await Promise.all([
    listarModulosParaPresupuesto(),
    listarComerciales(),
    cargarParametros(),
  ])

  const descuentoAnualPct = parseInt(await getSetting('descuento_anual_pct', '10'), 10) || 0

  // `fases_excluidas` no se guarda como columna: se deduce del propio `desglose`, que solo
  // contiene las fases INCLUIDAS (una fase fuera desaparece del desglose, no se pinta a cero).
  // Es la fuente fiel de lo que se guardó, sin necesidad de un campo extra.
  const etiquetasEnDesglose = new Set(
    (Array.isArray(pres.desglose) ? pres.desglose : []).map((d: { fase?: string }) => d.fase),
  )
  const fasesExcluidas = FASES_INSTALACION
    .map(f => f.num)
    .filter(n => !etiquetasEnDesglose.has(etiquetaFase(n)))

  const mig = (pres.migracion ?? {}) as {
    desea?: boolean; desde?: string | null; hasta?: string | null
    volumen?: number | null; horasManual?: number | null
  }
  const tarifa: TarifaTipo = pres.tarifa === 'fundador' ? 'fundador' : 'estandar'

  return (
    <PresupuestoCalculadora
      modulos={modulos}
      comerciales={comerciales}
      // El comercial guardado manda como valor del selector; si ya no está activo, la
      // calculadora lo conserva como opción para no perderlo.
      comercialEmailDefault={pres.comercial_email || ctx.email}
      tarifaSugerida={tarifa}
      parametros={parametros}
      descuentoAnualPct={descuentoAnualPct}
      editarId={presId}
      prefill={{
        diagnosticoId:     pres.diagnostico_id ?? null,
        clientId:          pres.client_id ?? null,
        nombreNegocio:     pres.nombre_negocio ?? '',
        nombreResponsable: pres.nombre_responsable ?? '',
        contacto:          pres.contacto ?? '',
        modulos:           Array.isArray(pres.modulos) ? pres.modulos : [],
        tarifa,
        formato:           (pres.formato_datos ?? 'cero') as FormatoDatos,
        volumenes:         (pres.volumenes ?? {}) as Record<string, number>,
        tarifaHora:        Number(pres.tarifa_hora_usd ?? parametros.tarifaHora),
        descuentoPct:      Number(pres.descuento_pct ?? 0),
        descuentoMotivo:   pres.descuento_motivo ?? '',
        fasesExcluidas,
        migracion: {
          desea:       !!mig.desea,
          desde:       mig.desde ?? null,
          hasta:       mig.hasta ?? null,
          volumen:     mig.volumen ?? null,
          horasManual: mig.horasManual ?? null,
        },
      }}
    />
  )
}
