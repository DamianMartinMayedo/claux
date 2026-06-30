// ── Medición de consumo de IA por tenant (CONTEXTO §7) ──
// Registra tokens/conversaciones por cliente y mes (tabla ia_uso) y expone un
// tope blando: avisa al acercarse, nunca corta en mitad de una conversación.

import { createAdminClient } from '@/lib/supabase/admin'
import type { IaUsage } from './provider'

// Tope orientativo de conversaciones/mes del addon (CONTEXTO §7: ~500).
export const CUPO_CONVERSACIONES = 500
const AVISO_PCT = 0.9

export interface UsoMes {
  periodo: string
  conversaciones: number
  tokensIn: number
  tokensOut: number
  cupo: number
  cercaDelTope: boolean
}

function periodoActual(): string {
  // America/Havana; coincide con el cálculo de la RPC ia_uso_hit.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Havana', year: 'numeric', month: '2-digit',
  }).format(new Date()).slice(0, 7)
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
  const periodo = periodoActual()
  const { data } = await db
    .from('ia_uso')
    .select('conversaciones, tokens_in, tokens_out')
    .eq('client_id', clientId).eq('periodo', periodo).maybeSingle()

  const conversaciones = Number(data?.conversaciones) || 0
  return {
    periodo,
    conversaciones,
    tokensIn:  Number(data?.tokens_in)  || 0,
    tokensOut: Number(data?.tokens_out) || 0,
    cupo: CUPO_CONVERSACIONES,
    cercaDelTope: conversaciones >= CUPO_CONVERSACIONES * AVISO_PCT,
  }
}
