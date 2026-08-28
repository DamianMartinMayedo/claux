import { createAdminClient } from '@/lib/supabase/admin'
import { envolverEmail, textoAHtml } from './layout'
import { PLANTILLAS_VARS, type TipoEmail } from './variables'

// Plantillas por defecto en código: red de seguridad si la fila en BD falta o
// está inactiva (p. ej. justo tras un `npm install` en un entorno sin seed).
const DEFAULT_ASUNTO: Record<TipoEmail, string> = {
  diagnostico_cita:  '¡Gracias por tu diagnóstico, {{nombre}}!',
  bienvenida:        'Bienvenido a CLAUX, {{empresa}}',
  password_reset:    'Nueva contraseña para tu cuenta de CLAUX',
  password_reset_link: 'Restablece tu contraseña de CLAUX',
  respuesta_soporte: 'Respuesta a tu mensaje de soporte',
  confirmacion_pago: 'Confirmamos tu pago — CLAUX',
  reactivacion:      'Tu cuenta de CLAUX está activa de nuevo',
  recordatorio_pago: 'Tu suscripción de CLAUX vence pronto',
  fin_prueba:        'Tu prueba gratuita de CLAUX está por terminar',
  suspension:        'Tu cuenta de CLAUX fue suspendida',
  periodo_gracia:    'Ampliamos tu acceso a CLAUX hasta el {{fecha_fin}}',
  limite_alcanzado:  'Llegaste al tope de {{concepto}} de tu nivel {{nivel}}',
  socio_ampliado:    'Sigues como Socio CLAUX hasta el {{fecha_fin}}',
}
const DEFAULT_CUERPO: Record<TipoEmail, string> = {
  diagnostico_cita:  'Hola {{nombre}},\n\nGracias por tu diagnóstico. Agenda tu cita aquí: {{link_agenda}}',
  bienvenida:        'Hola {{nombre}},\n\nTu cuenta de {{empresa}} ya está lista.\nUsuario: {{usuario}}\nContraseña temporal: {{password_temporal}}\n\nEntra aquí: {{link_portal}}',
  password_reset:    'Hola {{nombre}},\n\nNueva contraseña temporal para {{empresa}}.\nUsuario: {{usuario}}\nContraseña temporal: {{password_temporal}}\n\nEntra aquí: {{link_portal}}',
  password_reset_link: 'Hola,\n\nRecibimos una solicitud para restablecer la contraseña de {{usuario}}.\n\nAbre este enlace y define tu nueva contraseña: {{link_reset}}\n\nEl enlace caduca en {{minutos}} minutos y solo puede usarse una vez.\n\nSi no lo pediste, tu contraseña actual sigue funcionando.',
  respuesta_soporte: 'Hola {{nombre}},\n\nSobre tu mensaje "{{asunto}}":\n\n{{mensaje_admin}}',
  confirmacion_pago: 'Confirmamos tu pago de ${{monto}} para {{empresa}}. Suscripción activa hasta {{fecha_expiracion}}.',
  reactivacion:      'Tu cuenta de {{empresa}} está activa de nuevo.',
  recordatorio_pago: 'La suscripción de {{empresa}} vence en {{dias}} días ({{fecha_expiracion}}).',
  fin_prueba:        'La prueba gratuita de {{empresa}} termina el {{fecha_expiracion}}.',
  suspension:        'La suscripción de {{empresa}} venció y la cuenta quedó suspendida.',
  periodo_gracia:    'Hola,\n\nLa suscripción de {{empresa}} venció el {{fecha_expiracion}}. Hemos ampliado tu acceso hasta el {{fecha_fin}} para que no interrumpas tu trabajo.\n\nSi necesitas más tiempo o quieres que veamos otra forma de pago, escríbenos.\n\nEl equipo de CLAUX',
  limite_alcanzado:  'Hola,\n\n{{empresa}} llegó a {{limite}} {{concepto}}, que es lo que incluye el nivel {{nivel}}.\n\nNo se ha cortado nada: sigues trabajando con todo lo que tienes. Lo único que no puedes es añadir más {{concepto}} hasta que archives algunos o pasemos a un nivel mayor.\n\nSi te hace falta más sitio, respóndenos a este correo y lo vemos.\n\nEl equipo de CLAUX',
  socio_ampliado:    'Hola,\n\nSeguimos: {{empresa}} continúa como Socio CLAUX hasta el {{fecha_fin}}. Tu portal no cambia en nada y no se te genera ningún cobro.\n\nEl equipo de CLAUX',
}

function interpolar(texto: string, vars: Record<string, string>): string {
  return texto.replace(/\{\{(\w+)\}\}/g, (match, clave) =>
    Object.prototype.hasOwnProperty.call(vars, clave) ? vars[clave] : match,
  )
}

export interface PlantillaRenderizada {
  asunto: string
  html:   string
}

// Carga la plantilla activa desde `email_plantillas` (o el default en código si
// falta/está inactiva), interpola {{variables}} con escape de HTML y envuelve
// con el layout de marca. `vars` debe traer SOLO las claves válidas para `tipo`
// (ver PLANTILLAS_VARS) — el resto se ignora.
export async function renderPlantilla(
  tipo: TipoEmail,
  vars: Record<string, string>,
): Promise<PlantillaRenderizada> {
  const db = createAdminClient()
  const { data } = await db
    .from('email_plantillas')
    .select('asunto, cuerpo, activo')
    .eq('tipo', tipo)
    .maybeSingle()

  const asuntoFuente = data?.activo ? data.asunto : DEFAULT_ASUNTO[tipo]
  const cuerpoFuente = data?.activo ? data.cuerpo : DEFAULT_CUERPO[tipo]

  // Solo se interpolan las claves declaradas para este tipo (evita fugas de datos
  // si `vars` trae algo de más) y se escapan como texto plano antes de HTML.
  const clavesValidas = new Set(PLANTILLAS_VARS[tipo].map(v => v.clave))
  const varsSeguras: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars)) {
    if (clavesValidas.has(k)) varsSeguras[k] = v
  }

  const asunto = interpolar(asuntoFuente, varsSeguras)
  const cuerpoTexto = interpolar(cuerpoFuente, varsSeguras)
  const html = envolverEmail(textoAHtml(cuerpoTexto))

  return { asunto, html }
}
