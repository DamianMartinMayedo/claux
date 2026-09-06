// ── Medición de consumo de IA (CONTEXTO §7) ──
// Dos bolsas separadas, porque el dinero es de dos bolsillos distintos:
//
//   · POR TENANT (`ia_uso`) — lo que gasta el cliente desde su portal, contra el
//     cupo de su nivel. Tope BLANDO: avisa al acercarse y nunca corta en mitad de
//     una conversación (baja al modelo gratis).
//   · INTERNA (`ia_uso_interno`, mig. 235) — lo que gasta nuestro equipo desde
//     /admin, repartido por ORIGEN (en qué se fue, no quién lo gastó). Tope DURO:
//     es nuestro dinero y al agotarse se corta (lo aplica `lib/ia/interna.ts`).

import { createAdminClient } from '@/lib/supabase/admin'
import type { IaUsage } from './provider'
import { cupoEfectivo, type OrigenIa } from './modelo'
import { mesEnTz } from '@/lib/fecha-tz'

const AVISO_PCT = 0.9
const CUPO_INTERNO_DEFECTO = 300

export interface UsoMes {
  periodo: string
  conversaciones: number
  tokensIn: number
  tokensOut: number
  cupo: number
  cercaDelTope: boolean
}

// Suma el consumo de una invocación. `nuevaConversacion=true` solo en el primer
// turno de una conversación (un insight puntual cuenta como conversación nueva).
export async function registrarUso(clientId: string, usage: IaUsage, nuevaConversacion: boolean): Promise<void> {
  const db = createAdminClient()
  await db.rpc('ia_uso_hit', {
    p_client_id:  clientId,
    p_tokens_in:  usage.tokensIn,
    p_tokens_out: usage.tokensOut,
    p_nueva_conv: nuevaConversacion,
  })
}

export async function obtenerUsoMes(clientId: string): Promise<UsoMes> {
  const db = createAdminClient()
  const periodo = mesEnTz()
  const [{ data }, cupo] = await Promise.all([
    db.from('ia_uso').select('conversaciones, tokens_in, tokens_out')
      .eq('client_id', clientId).eq('periodo', periodo).maybeSingle(),
    cupoEfectivo(clientId),
  ])

  const conversaciones = Number(data?.conversaciones) || 0
  return {
    periodo,
    conversaciones,
    tokensIn:  Number(data?.tokens_in)  || 0,
    tokensOut: Number(data?.tokens_out) || 0,
    cupo,
    cercaDelTope: conversaciones >= cupo * AVISO_PCT,
  }
}


// ── Bolsa interna ──────────────────────────────────────────────────────────────

export interface UsoInternoMes {
  periodo: string
  conversaciones: number
  tokensIn: number
  tokensOut: number
  cupo: number
  cercaDelTope: boolean
  agotado: boolean
  /** El reparto: en qué se fue el mes. Es la pregunta que se hace uno al ver la factura. */
  porOrigen: { origen: OrigenIa; conversaciones: number; tokensIn: number; tokensOut: number }[]
}

/**
 * Conversaciones internas al mes que estamos dispuestos a pagar
 * (`settings.ia_cupo_interno_mes`, editable en /admin).
 *
 * El 0 se respeta: es la forma de apagar la IA interna sin tocar código. Solo un
 * valor ilegible cae al de fábrica — un ajuste mal tecleado no debe abrir la mano.
 */
export async function cupoInterno(): Promise<number> {
  const db = createAdminClient()
  const { data } = await db.from('settings').select('value').eq('key', 'ia_cupo_interno_mes').maybeSingle()
  const n = parseInt(String(data?.value ?? ''), 10)
  return Number.isFinite(n) && n >= 0 ? n : CUPO_INTERNO_DEFECTO
}

/** Suma una invocación interna. Lo llama `chatInterno`, no los consumidores. */
export async function registrarUsoInterno(origen: OrigenIa, usage: IaUsage, nuevaConversacion: boolean): Promise<void> {
  const db = createAdminClient()
  await db.rpc('ia_uso_interno_hit', {
    p_origen:     origen,
    p_tokens_in:  usage.tokensIn,
    p_tokens_out: usage.tokensOut,
    p_nueva_conv: nuevaConversacion,
  })
}

export async function obtenerUsoInternoMes(): Promise<UsoInternoMes> {
  const db = createAdminClient()
  const periodo = mesEnTz()
  const [{ data }, cupo] = await Promise.all([
    db.from('ia_uso_interno').select('origen, conversaciones, tokens_in, tokens_out')
      .eq('periodo', periodo).order('conversaciones', { ascending: false }),
    cupoInterno(),
  ])

  const filas = (data ?? []) as { origen: OrigenIa; conversaciones: number; tokens_in: number; tokens_out: number }[]
  const suma = (campo: 'conversaciones' | 'tokens_in' | 'tokens_out') =>
    filas.reduce((t, f) => t + (Number(f[campo]) || 0), 0)

  const conversaciones = suma('conversaciones')
  return {
    periodo,
    conversaciones,
    tokensIn:  suma('tokens_in'),
    tokensOut: suma('tokens_out'),
    cupo,
    cercaDelTope: conversaciones >= cupo * AVISO_PCT,
    agotado: conversaciones >= cupo,
    porOrigen: filas.map(f => ({
      origen: f.origen,
      conversaciones: Number(f.conversaciones) || 0,
      tokensIn:  Number(f.tokens_in)  || 0,
      tokensOut: Number(f.tokens_out) || 0,
    })),
  }
}
