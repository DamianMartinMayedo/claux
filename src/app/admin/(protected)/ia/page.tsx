import { requireAccesoPagina } from '@/lib/admin-guard'
import { createClient } from '@/lib/supabase/server'
import { DOCUMENTOS_IA } from '@/lib/ia/documentos'
import { normalizarNivel } from '@/lib/niveles'
import { elegirUltimoRecurso } from '@/lib/ia/modelo'
import IaAdminClient, { type ModeloIa, type ConsumoCliente, type DocumentoUi } from './IaAdminClient'
import { obtenerUsoInternoMes } from '@/lib/ia/uso'
import { interpretarInterruptores, CLAVES_INTERRUPTORES } from '@/lib/ia/interruptores'
import { tarifaDe } from '@/lib/ia/coste'
import { mesEnTz } from '@/lib/fecha-tz'
import { TOPE_VER_MAS } from '@/lib/listados'

export const dynamic = 'force-dynamic'

export default async function AdminIaPage() {
  await requireAccesoPagina('ia')
  const supabase = await createClient()
  const periodo = mesEnTz()

  const [{ data: modelosRaw }, { data: settingsRaw }, { data: docsRaw }, { data: clientesRaw }] = await Promise.all([
    // Orden FIJO: los de pago, luego el resto de activos y al final los apagados.
    // `orden` solo desempata dentro de cada grupo y `nombre` cierra el desempate:
    // sin ese último criterio dos modelos con el mismo `orden` (todos los nuevos
    // nacen con 100) quedaban al albur del orden físico de Postgres, que cambia
    // con cada UPDATE — la tabla se reordenaba sola al encender un interruptor.
    supabase.from('ia_modelos').select('*')
      .order('activo', { ascending: false }).order('gratis').order('orden').order('nombre'),
    supabase.from('settings').select('key, value')
      .in('key', ['ia_model', 'ia_modelo_fallback_gratis', 'ia_cupo_conversaciones', 'ia_nombre_agente', 'ia_tono',
                  'ia_model_interno', 'ia_cupo_interno_mes', ...CLAVES_INTERRUPTORES]),
    supabase.from('settings').select('key, value').in('key', DOCUMENTOS_IA.map(d => d.key)),
    // Techo explícito: esta lista es la tabla de consumo de IA, y una fila que falte
    // es un cliente gastando sin aparecer en el reparto.
    supabase.from('clients').select('client_id, nombre_empresa, ia_config, nivel')
      .contains('modulos_activos', ['asistente_ia'])
      .limit(TOPE_VER_MAS),
  ])

  // El cupo base de cada cliente sale de su NIVEL. Se leen las tres filas de una
  // vez (son tres) en vez de una consulta por cliente.
  const { data: limitesIa } = await supabase.from('nivel_limites')
    .select('nivel, base').eq('dimension', 'ia_conversaciones')
  const cupoPorNivel = Object.fromEntries(
    (limitesIa ?? [])
      .filter((f: { base: number | null }) => f.base !== null)
      .map((f: { nivel: string; base: number | null }) => [f.nivel, Math.floor(Number(f.base))]),
  ) as Record<string, number>

  const modelos = (modelosRaw ?? []) as ModeloIa[]
  const S = Object.fromEntries((settingsRaw ?? []).map(r => [r.key, r.value]))
  // Lo que esta pantalla enseña tiene que ser lo que el motor va a usar de verdad,
  // así que se resuelve igual que `resolverModelo`: el id de `settings` si sigue
  // ACTIVO en el catálogo y, si no, el último recurso del propio catálogo. Antes
  // caía en un id escrito a mano —`deepseek-v4-flash-free`, borrado hace tiempo—, y
  // un id que no está entre los activos no existe como `<option>`: el desplegable
  // mostraba el primero de la lista mientras el estado guardaba el fantasma, así que
  // guardar sin tocar nada escribía en `settings` un modelo que nadie había elegido.
  const ultimo = elegirUltimoRecurso(modelos)
  const activo = (id: string) => modelos.some(m => m.id === id && m.activo)
  const principal      = activo(S.ia_model) ? S.ia_model : (ultimo?.id ?? '')
  const fallbackGratis = activo(S.ia_modelo_fallback_gratis) ? S.ia_modelo_fallback_gratis : (ultimo?.id ?? '')
  const cupoGlobal     = parseInt(S.ia_cupo_conversaciones ?? '500', 10) || 500
  // El interno vacío es un valor con significado («el mismo que el principal»), así
  // que NO se resuelve al último recurso como los otros dos: se deja vacío y el
  // desplegable lo dice con todas las letras.
  const modeloInterno  = activo(S.ia_model_interno) ? S.ia_model_interno : ''
  const nombreAgente   = S.ia_nombre_agente || 'Claux'
  const tono           = S.ia_tono || 'profesional y directo, como un analista que conoce el negocio'
  const principalGratis = modelos.find(m => m.id === principal)?.gratis ?? false

  // Documentos de IA (personalidad + prompts por sección), con su valor efectivo.
  const DV = Object.fromEntries((docsRaw ?? []).map(r => [r.key, r.value]))
  const documentos: DocumentoUi[] = DOCUMENTOS_IA.map(d => ({
    key: d.key,
    label: d.label,
    descripcion: d.descripcion,
    valor: (DV[d.key] || '').trim() || d.valorDefault,
    esPersonalidad: d.grupo === 'personalidad',
  }))

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
    // Mismo orden que `cupoEfectivo` (lib/ia/modelo.ts): excepción del cliente →
    // nivel → global. Si esta tabla enseñara otro número, el admin estaría viendo
    // un cupo que el motor no aplica.
    const cupo = Number.isFinite(override) && override > 0
      ? Math.floor(override)
      : cupoPorNivel[normalizarNivel(c.nivel)] ?? cupoGlobal
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

  // La bolsa interna: lo que gastamos NOSOTROS este mes, por origen (mig. 235).
  const interno = await obtenerUsoInternoMes()

  // Los interruptores (mig. 236) y la tarifa con la que se pone en dinero lo que ya
  // medimos en tokens. El modelo con el que se estima es el de HOY: `ia_uso_interno`
  // guarda tokens, no con qué modelo se gastaron, así que un cambio de modelo a
  // mitad de mes recalcula el mes entero. Por eso el panel dice «estimado» y con
  // qué modelo, en vez de dar una cifra a secas que parecería una factura.
  const { activa: iaActiva, apagadas: funcionesOff } = interpretarInterruptores(S)
  const mInterno = modelos.find(m => m.id === (modeloInterno || principal))
  const tarifaInterna = tarifaDe(mInterno)

  return (
    <IaAdminClient
      modelos={modelos}
      principal={principal}
      fallbackGratis={fallbackGratis}
      cupoGlobal={cupoGlobal}
      nombreAgente={nombreAgente}
      tono={tono}
      documentos={documentos}
      periodo={periodo}
      consumo={consumo}
      modeloInterno={modeloInterno}
      interno={interno}
      iaActiva={iaActiva}
      funcionesOff={funcionesOff}
      tarifaInterna={tarifaInterna}
      modeloInternoNombre={mInterno?.nombre ?? 'sin modelo'}
    />
  )
}
