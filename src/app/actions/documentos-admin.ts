'use server'

// ── Documentos legales, lado admin ──
//
// Lo que Claudia necesita desde la ficha del cliente: descargar el PDF firmado
// (bucket privado → URL firmada temporal) y reenviar un recordatorio al cliente
// que aún no ha firmado (email + notificación interna del portal, ambas con
// enlace a la página de firma).

import { requirePermiso }    from '@/lib/admin-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { enviarEmail }       from '@/lib/email/enviar'
import { envolverEmail, textoAHtml } from '@/lib/email/layout'
import { crearNotificacion } from '@/lib/notificaciones/crear'
import { logActividad }      from '@/lib/audit'

const BUCKET = 'documentos-firmados'

export interface FirmaClienteRow {
  tipo:               string
  version:            string
  firmado_at:         string
  firmado_por_nombre: string
  firmado_por_email:  string
  tiene_pdf:          boolean
}

/** Firmas de un cliente, para la tarjeta de su ficha. */
export async function listarFirmasCliente(clientId: string): Promise<FirmaClienteRow[]> {
  await requirePermiso('clientes')
  const db = createAdminClient()
  const { data } = await db
    .from('firmas_documentos')
    .select('tipo, version, firmado_at, firmado_por_nombre, firmado_por_email, pdf_path')
    .eq('client_id', clientId)
    .order('firmado_at', { ascending: false })
  return ((data ?? []) as Record<string, unknown>[]).map(f => ({
    tipo:               f.tipo as string,
    version:            f.version as string,
    firmado_at:         f.firmado_at as string,
    firmado_por_nombre: f.firmado_por_nombre as string,
    firmado_por_email:  f.firmado_por_email as string,
    tiene_pdf:          !!f.pdf_path,
  }))
}

/** URL firmada (10 min) para descargar el PDF de una firma concreta. */
export async function urlPdfFirmado(clientId: string, tipo: string, version: string): Promise<string | null> {
  await requirePermiso('clientes')
  const db = createAdminClient()
  const { data: fila } = await db
    .from('firmas_documentos')
    .select('pdf_path')
    .eq('client_id', clientId).eq('tipo', tipo).eq('version', version)
    .maybeSingle()
  const path = (fila as { pdf_path?: string } | null)?.pdf_path
  if (!path) return null
  const { data } = await db.storage.from(BUCKET).createSignedUrl(path, 600)
  return data?.signedUrl ?? null
}

const PORTAL_URL = `${(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://claux.es').replace(/\/$/, '')}/portal/perfil`

/**
 * Reenvía al cliente el recordatorio de que tiene documentos por firmar: email
 * al administrador de la empresa + notificación interna del portal, ambos con
 * enlace a la página de firma. No bloqueante: si el email falla, no rompe.
 */
export async function enviarRecordatorioDocumentos(clientId: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePermiso('clientes')
  const db = createAdminClient()

  const { data: cliente } = await db
    .from('clients')
    .select('nombre_empresa, nombre_contacto, email_admin')
    .eq('client_id', clientId)
    .maybeSingle()
  if (!cliente) return { ok: false, error: 'Cliente no encontrado.' }
  if (!cliente.email_admin) return { ok: false, error: 'El cliente no tiene email de administrador.' }

  const nombre = cliente.nombre_contacto || cliente.nombre_empresa
  const cuerpo =
    `Hola ${nombre},\n\n`
    + 'Te recordamos que tienes documentos pendientes de firmar en tu cuenta de CLAUX: el acuerdo '
    + 'de confidencialidad (NDA), el contrato de servicio y el presupuesto.\n\n'
    + `Puedes revisarlos y firmarlos desde tu perfil: ${PORTAL_URL}\n\n`
    + 'La firma es electrónica y solo te llevará un momento.'

  const emailRes = await enviarEmail({
    to:       cliente.email_admin,
    from:     'CLAUX <contacto@claux.es>',
    subject:  'Tienes documentos pendientes de firmar en CLAUX',
    html:     envolverEmail(textoAHtml(cuerpo)),
    tipo:     'recordatorio_firma',
    clientId,
  })

  // Notificación interna del portal (la ve el admin de la empresa en su bandeja).
  await crearNotificacion({
    clientId,
    tipo:   'documentos_firma_pendiente',
    titulo: 'Tienes documentos pendientes de firmar',
    cuerpo: 'Revisa y firma tu NDA, contrato y presupuesto desde tu perfil.',
    enlace: '/portal/perfil',
  })

  await logActividad(db, {
    user_email: ctx.email,
    entity: 'firma',
    entity_id: clientId,
    action: 'recordatorio_firma',
    description: `Envió recordatorio de firma de documentos a ${cliente.nombre_empresa}.`,
  })

  if (!emailRes.ok) {
    return { ok: false, error: 'La notificación interna se creó, pero el email no pudo enviarse.' }
  }
  return { ok: true }
}
