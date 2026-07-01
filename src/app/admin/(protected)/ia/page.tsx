import { createClient } from '@/lib/supabase/server'
import IaAdminClient, { type ModeloIa, type ConsumoCliente } from './IaAdminClient'

export const dynamic = 'force-dynamic'

function periodoActual(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Havana', year: 'numeric', month: '2-digit' })
    .format(new Date()).slice(0, 7)
}

export default async function AdminIaPage() {
  const supabase = await createClient()
  const periodo = periodoActual()

  const [{ data: modelosRaw }, { data: settingsRaw }, { data: clientesRaw }] = await Promise.all([
    supabase.from('ia_modelos').select('*').order('orden'),
    supabase.from('settings').select('key, value')
      .in('key', ['ia_model', 'ia_modelo_fallback_gratis', 'ia_cupo_conversaciones', 'ia_nombre_agente', 'ia_tono']),
    supabase.from('clients').select('client_id, nombre_empresa, ia_config')
      .contains('modulos_activos', ['asistente_ia']),
  ])

  const modelos = (modelosRaw ?? []) as ModeloIa[]
  const S = Object.fromEntries((settingsRaw ?? []).map(r => [r.key, r.value]))
  const principal      = S.ia_model || 'deepseek-v4-flash-free'
  const fallbackGratis = S.ia_modelo_fallback_gratis || 'deepseek-v4-flash-free'
  const cupoGlobal     = parseInt(S.ia_cupo_conversaciones ?? '500', 10) || 500
  const nombreAgente   = S.ia_nombre_agente || 'Claux'
  const tono           = S.ia_tono || 'cercano y directo, como un asesor de confianza'
  const principalGratis = modelos.find(m => m.id === principal)?.gratis ?? false

  // Consumo del mes por cliente con IA contratada.
  const clientes = clientesRaw ?? []
  const ids = clientes.map(c => c.client_id as string)
  const { data: usoRaw } = ids.length
    ? await supabase.from('ia_uso').select('client_id, conversaciones, tokens_in, tokens_out')
        .eq('periodo', periodo).in('client_id', ids)
    : { data: [] }
  const usoMap = Object.fromEntries((usoRaw ?? []).map(u => [u.client_id as string, u]))

  const consumo: ConsumoCliente[] = clientes.map(c => {
    const cfg = (c.ia_config && typeof c.ia_config === 'object') ? c.ia_config as Record<string, unknown> : {}
    const override = Number(cfg.cupo)
    const cupo = Number.isFinite(override) && override > 0 ? Math.floor(override) : cupoGlobal
    const u = usoMap[c.client_id as string]
    const conversaciones = Number(u?.conversaciones) || 0
    const tokens = (Number(u?.tokens_in) || 0) + (Number(u?.tokens_out) || 0)
    const superado = !principalGratis && conversaciones >= cupo
    return {
      client_id: c.client_id as string,
      nombre: (c.nombre_empresa as string) ?? (c.client_id as string),
      conversaciones, tokens, cupo,
      cupoPropio: Number.isFinite(override) && override > 0,
      modeloActual: superado ? fallbackGratis : principal,
    }
  }).sort((a, b) => b.conversaciones - a.conversaciones)

  return (
    <IaAdminClient
      modelos={modelos}
      principal={principal}
      fallbackGratis={fallbackGratis}
      cupoGlobal={cupoGlobal}
      nombreAgente={nombreAgente}
      tono={tono}
      periodo={periodo}
      consumo={consumo}
    />
  )
}
