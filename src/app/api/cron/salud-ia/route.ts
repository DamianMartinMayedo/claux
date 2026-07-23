import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { probarModelo } from '@/lib/ia/modelo'
import { enviarAvisoInterno } from '@/lib/email/enviar'

// Chequeo diario de salud de los modelos de IA (ver vercel.json, 08:00 UTC ≈ 9-10h
// España / madrugada en Cuba: nadie usando IA y da margen para reaccionar el mismo
// día). Prueba principal + respaldo + resto de activos con una llamada mínima real
// al proveedor. AVISA AL EQUIPO por correo SOLO si el modelo principal está caído
// (y marca URGENTE si el respaldo también lo está); el correo lista qué alternativas
// siguen vivas para poder cambiar. Si el principal responde, no envía nada.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Un reintento antes de dar por caído un modelo crítico: evita falsos positivos por
// un blip puntual de red o del proveedor.
async function probarConReintento(id: string) {
  const r = await probarModelo(id)
  if (r.ok) return r
  return probarModelo(id)
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })
  }

  const db = createAdminClient()
  const [{ data: setRows }, { data: activosRaw }] = await Promise.all([
    db.from('settings').select('key, value').in('key', ['ia_model', 'ia_modelo_fallback_gratis']),
    db.from('ia_modelos').select('id, nombre').eq('activo', true),
  ])
  const S = Object.fromEntries((setRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
  const principalId = S.ia_model || 'deepseek-v4-flash-free'
  const fallbackId  = S.ia_modelo_fallback_gratis || 'deepseek-v4-flash-free'
  const activos = (activosRaw ?? []) as { id: string; nombre: string }[]
  const nombreDe = new Map(activos.map(m => [m.id, m.nombre]))

  // Probar principal, respaldo y el resto de activos (las "alternativas"). Los dos
  // críticos con reintento; el resto una sola vez (solo informan si hace falta cambiar).
  const ids = [...new Set([principalId, fallbackId, ...activos.map(m => m.id)])]
  const resultados = await Promise.all(ids.map(async id => {
    const critico = id === principalId || id === fallbackId
    const r = critico ? await probarConReintento(id) : await probarModelo(id)
    return { id, nombre: nombreDe.get(id) ?? id, ok: r.ok, respondio: r.respondio, ms: r.ms, error: r.error }
  }))
  const byId = new Map(resultados.map(r => [r.id, r]))

  const principal = byId.get(principalId)
  const fallback  = byId.get(fallbackId)
  const principalCaido = !principal?.ok
  const fallbackCaido  = !fallback?.ok

  let avisado = false
  if (principalCaido) {
    const urgente = fallbackCaido
    const vivas = resultados
      .filter(r => r.ok && r.id !== principalId)
      .map(r => `• ${r.nombre} (${r.id})${r.respondio ? '' : ' [responde vacío]'} — ${r.ms} ms`)

    const asunto = urgente
      ? '⚠️ URGENTE: IA sin servicio — principal y respaldo caídos'
      : `⚠️ IA: el modelo principal está caído (${principalId})`

    const cuerpo = [
      urgente
        ? 'El modelo principal Y el de respaldo están caídos: los clientes con IA se están quedando sin servicio.'
        : 'El modelo principal está caído. Los clientes caen automáticamente al respaldo, pero conviene cambiarlo pronto.',
      '',
      `Principal: ${principalId} — CAÍDO (${principal?.error ?? 'sin detalle'})`,
      `Respaldo:  ${fallbackId} — ${fallbackCaido ? `CAÍDO (${fallback?.error ?? 'sin detalle'})` : `OK (${fallback?.ms} ms)`}`,
      '',
      vivas.length
        ? `Alternativas que funcionan ahora mismo:\n${vivas.join('\n')}`
        : 'Ninguna otra alternativa activa responde en este momento.',
      '',
      'Cambia el modelo principal en /admin/ia.',
    ].join('\n')

    await enviarAvisoInterno({ tipo: 'ia_salud', asunto, cuerpo })
    avisado = true
  }

  return NextResponse.json({
    ok: true,
    avisado,
    principal: { id: principalId, ok: !principalCaido },
    fallback:  { id: fallbackId,  ok: !fallbackCaido },
    resultados: resultados.map(r => ({ id: r.id, ok: r.ok, respondio: r.respondio, ms: r.ms })),
  })
}
