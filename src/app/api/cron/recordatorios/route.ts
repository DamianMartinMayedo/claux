import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { leerSetting } from '@/lib/settings'
import { renderPlantilla } from '@/lib/email/render'
import { enviarEmail, tipoEmailActivo } from '@/lib/email/enviar'
import { barrerVencidos } from '@/lib/clientes/vencimientos'
import { toDateStr, addDays, fmtFechaEs } from '@/lib/date-utils'
// Los 3 tipos que dispara el cron (subconjunto de TipoEmail).
type TipoCron = 'recordatorio_pago' | 'fin_prueba' | 'suspension'

// Cron diario (ver vercel.json). Envía los correos POR TIEMPO:
//  · recordatorio_pago — ACTIVO que vence dentro de N días (setting `dias_aviso`)
//  · fin_prueba        — TRIAL que termina dentro de N días
//  · suspension        — cliente recién expirado (tras el barrido de estado)
// Cada tipo respeta su toggle (pestaña "Alertas" del admin) y es idempotente:
// un cliente recibe UN aviso por vencimiento, deduplicado por meta.fecha_expiracion
// en `emails_log`. Si renueva (nueva fecha_expiracion) vuelve a ser elegible.

export const dynamic = 'force-dynamic'
// Puede enviar varios correos secuencialmente; ampliamos el límite serverless.
export const maxDuration = 60

// Ventana de "recién expirado" para el aviso de suspensión: cubre algún día de
// cron perdido sin reavivar suspensiones antiguas (además del guard de idempotencia).
const DIAS_LOOKBACK_SUSPENSION = 3

interface ClienteVenc {
  client_id:        string
  nombre_empresa:   string
  email_admin:      string | null
  fecha_expiracion: string | null
}

// ¿Ya se envió (con éxito) este tipo a este cliente por este vencimiento?
async function yaAvisado(
  db: ReturnType<typeof createAdminClient>,
  tipo: TipoCron,
  clientId: string,
  fechaExp: string,
): Promise<boolean> {
  const { data } = await db
    .from('emails_log')
    .select('id')
    .eq('client_id', clientId)
    .eq('tipo', tipo)
    .eq('estado', 'enviado')
    .eq('meta->>fecha_expiracion', fechaExp)
    .limit(1)
  return !!(data && data.length > 0)
}

export async function GET(req: NextRequest) {
  // Auth: Vercel Cron añade `Authorization: Bearer <CRON_SECRET>` automáticamente
  // cuando la env var CRON_SECRET está definida. La invocación manual debe usar el
  // mismo header. Sin secreto configurado, no se ejecuta (evita endpoint abierto).
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })
  }

  const db = createAdminClient()
  const hoy = toDateStr(new Date())

  // 0. Sincronizar estados (GRACIA/ACTIVO/TRIAL vencidos → DESACTIVADO) para que
  //    los que expiran hoy no cuenten como "próximos a vencer".
  const { suspendidos } = await barrerVencidos()

  const diasAviso = parseInt(await leerSetting('dias_aviso', '5'), 10) || 5
  const limite = toDateStr(addDays(new Date(), diasAviso))

  const resumen = { suspendidos, recordatorio_pago: 0, fin_prueba: 0, suspension: 0 }

  // Envía un aviso por vencimiento, respetando toggle + idempotencia.
  async function avisar(tipo: TipoCron, c: ClienteVenc, vars: Record<string, string>) {
    if (!c.email_admin || !c.fecha_expiracion) return
    if (await yaAvisado(db, tipo, c.client_id, c.fecha_expiracion)) return
    const { asunto, html } = await renderPlantilla(tipo, vars)
    const r = await enviarEmail({
      to: c.email_admin, subject: asunto, html, tipo, clientId: c.client_id,
      meta: { fecha_expiracion: c.fecha_expiracion },
    })
    if (r.ok) resumen[tipo] += 1
  }

  // 1. recordatorio_pago — ACTIVO que vence en [hoy, hoy+N]
  if (await tipoEmailActivo('recordatorio_pago')) {
    const { data } = await db
      .from('clients')
      .select('client_id, nombre_empresa, email_admin, fecha_expiracion')
      .eq('estado', 'ACTIVO')
      .eq('es_prueba', false)
      .gte('fecha_expiracion', hoy)
      .lte('fecha_expiracion', limite)
    for (const c of (data ?? []) as ClienteVenc[]) {
      const dias = Math.max(0, Math.round(
        (new Date(c.fecha_expiracion!).getTime() - new Date(hoy).getTime()) / 86_400_000,
      ))
      await avisar('recordatorio_pago', c, {
        empresa: c.nombre_empresa,
        dias: String(dias),
        fecha_expiracion: fmtFechaEs(c.fecha_expiracion!),
      })
    }
  }

  // 2. fin_prueba — TRIAL que termina en [hoy, hoy+N]
  if (await tipoEmailActivo('fin_prueba')) {
    const { data } = await db
      .from('clients')
      .select('client_id, nombre_empresa, email_admin, fecha_expiracion')
      .eq('estado', 'TRIAL')
      .eq('es_prueba', false)
      .gte('fecha_expiracion', hoy)
      .lte('fecha_expiracion', limite)
    for (const c of (data ?? []) as ClienteVenc[]) {
      await avisar('fin_prueba', c, {
        empresa: c.nombre_empresa,
        fecha_expiracion: fmtFechaEs(c.fecha_expiracion!),
      })
    }
  }

  // 3. suspension — recién expirados (DESACTIVADO con fecha_expiracion en la
  //    ventana de lookback). Captura tanto a los que barrió este cron como a los
  //    que ya hubiera desactivado el admin al abrir el panel; el dedup evita dobles.
  if (await tipoEmailActivo('suspension')) {
    const desde = toDateStr(addDays(new Date(), -DIAS_LOOKBACK_SUSPENSION))
    const { data } = await db
      .from('clients')
      .select('client_id, nombre_empresa, email_admin, fecha_expiracion')
      .eq('estado', 'DESACTIVADO')
      .eq('es_prueba', false)
      .gte('fecha_expiracion', desde)
      .lt('fecha_expiracion', hoy)
    for (const c of (data ?? []) as ClienteVenc[]) {
      await avisar('suspension', c, { empresa: c.nombre_empresa })
    }
  }

  return NextResponse.json({ ok: true, ...resumen })
}
