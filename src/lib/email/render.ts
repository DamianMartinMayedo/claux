import { createAdminClient } from '@/lib/supabase/admin'
import { envolverEmail, textoAHtml } from './layout'
import { PLANTILLAS_VARS, type TipoEmail } from './variables'

// Plantillas por defecto en código: red de seguridad si la fila en BD falta o
// está inactiva (p. ej. justo tras un `npm install` en un entorno sin seed).
const DEFAULT_ASUNTO: Record<TipoEmail, string> = {
  diagnostico_cita:  'Diagnóstico recibido — CLAUX',
  bienvenida:        'Acceso a CLAUX — {{empresa}}',
  password_reset:    'Nueva contraseña de acceso a CLAUX',
  password_reset_link: 'Restablecer la contraseña de CLAUX',
  respuesta_soporte: 'Respuesta a su mensaje de soporte',
  confirmacion_pago: 'Pago registrado — CLAUX',
  reactivacion:      'Cuenta de CLAUX reactivada',
  recordatorio_pago: 'La suscripción de CLAUX vence pronto',
  fin_prueba:        'La prueba gratuita de CLAUX termina pronto',
  suspension:        'Cuenta de CLAUX suspendida',
  periodo_gracia:    'Acceso a CLAUX ampliado hasta el {{fecha_fin}}',
  limite_alcanzado:  'Tope de {{concepto}} alcanzado en el nivel {{nivel}}',
  socio_ampliado:    'Socio CLAUX hasta el {{fecha_fin}}',
}
const DEFAULT_CUERPO: Record<TipoEmail, string> = {
  diagnostico_cita:  'Diagnóstico recibido.\n\nLa cita se agenda aquí: {{link_agenda}}\n\nEl equipo de CLAUX',
  bienvenida:        'La cuenta de {{empresa}} ya está activa.\n\nUsuario: {{usuario}}\nContraseña temporal: {{password_temporal}}\n\nAcceso: {{link_portal}}\n\nEl equipo de CLAUX',
  password_reset:    'Nueva contraseña temporal para {{empresa}}.\n\nUsuario: {{usuario}}\nContraseña temporal: {{password_temporal}}\n\nAcceso: {{link_portal}}\n\nEl equipo de CLAUX',
  password_reset_link: 'Se ha solicitado restablecer la contraseña de {{usuario}}.\n\nEnlace para definir una nueva: {{link_reset}}\n\nCaduca en {{minutos}} minutos y solo puede usarse una vez. Si la solicitud no fue suya, la contraseña actual sigue siendo válida.\n\nEl equipo de CLAUX',
  respuesta_soporte: 'Hola {{nombre}}:\n\nSobre su mensaje «{{asunto}}»:\n\n{{mensaje_admin}}\n\nEl equipo de CLAUX',
  confirmacion_pago: 'Pago de ${{monto}} registrado para {{empresa}}. Suscripción activa hasta {{fecha_expiracion}}.\n\nEl equipo de CLAUX',
  reactivacion:      'La cuenta de {{empresa}} está activa de nuevo.\n\nEl equipo de CLAUX',
  recordatorio_pago: 'La suscripción de {{empresa}} vence en {{dias}} días ({{fecha_expiracion}}).\n\nEl equipo de CLAUX',
  fin_prueba:        'La prueba gratuita de {{empresa}} termina el {{fecha_expiracion}}.\n\nEl equipo de CLAUX',
  suspension:        'La suscripción de {{empresa}} venció y la cuenta ha quedado suspendida.\n\nEl equipo de CLAUX',
  periodo_gracia:    'La suscripción de {{empresa}} venció el {{fecha_expiracion}}. El acceso queda ampliado hasta el {{fecha_fin}} para no interrumpir el trabajo.\n\nPara acordar otra forma de pago, basta con responder a este correo.\n\nEl equipo de CLAUX',
  limite_alcanzado:  '{{empresa}} ha llegado a {{limite}} {{concepto}}, el tope del nivel {{nivel}}.\n\nNo se ha interrumpido nada: todo lo registrado sigue disponible. Solo queda bloqueado añadir más {{concepto}} hasta archivar algunos o subir de nivel.\n\nPara ampliar el nivel, basta con responder a este correo.\n\nEl equipo de CLAUX',
  socio_ampliado:    '{{empresa}} continúa como Socio CLAUX hasta el {{fecha_fin}}. El portal no cambia y no se genera ningún cobro.\n\nEl equipo de CLAUX',
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
