// Avisos del admin POR EVENTO: se disparan dentro de la acción que los provoca,
// no en el cron. Un envoltorio por evento para que el call site sea una línea y el
// texto viva en un solo sitio.
//
// Nunca lanzan (crearAvisoAdmin ya traga sus errores): un aviso que falla no puede
// tumbar el alta del cliente ni el pago que lo originó.
//
// Varios de estos eventos YA mandan correo al equipo (nuevo lead, soporte,
// contratación). No es duplicar por duplicar: el correo es para enterarse con el
// panel cerrado, la bandeja es el registro accionable dentro del panel. Lo que se
// cuida es la severidad — nada de esto es `urgente` (no interrumpe), solo el
// escalado del cron lo es.

import { fmtFechaEs } from '@/lib/date-utils'
import { crearAvisoAdmin, resolverAvisosCliente } from './crear'

/** Alta en `diagnosticos`: alguien completó el diagnóstico público. */
export async function avisarLeadNuevo(params: {
  id:      number
  nombre:  string
  sector:  string
  /** Cómo lo hace hoy, si lo dijo: es el gancho de la llamada. */
  modo?:   string | null
}): Promise<void> {
  await crearAvisoAdmin({
    tipo:        'lead_nuevo',
    titulo:      `Nuevo lead — ${params.nombre}`,
    cuerpo:      [params.sector, params.modo || null].filter(Boolean).join(' · '),
    enlace:      '/admin/solicitudes',
    entidadTipo: 'lead',
    entidadId:   String(params.id),
  })
}

/** El lead pulsó «Quiero que me contacten»: esto ya es una petición explícita. */
export async function avisarLeadPideContacto(params: {
  id:       number
  nombre:   string
  telefono: string
}): Promise<void> {
  await crearAvisoAdmin({
    tipo:        'lead_pide_contacto',
    titulo:      `${params.nombre} pide que le llamemos`,
    cuerpo:      `Teléfono: ${params.telefono}`,
    enlace:      '/admin/solicitudes',
    entidadTipo: 'lead',
    entidadId:   String(params.id),
    // Deja de pedir "contacta al lead" cuando ya avisamos de que lo pidió él.
    sustituyeA:  ['lead_sin_contactar'],
  })
}

/** «Me interesa» del portal: oportunidad de venta sobre un cliente que ya paga. */
export async function avisarAmpliacionSolicitada(params: {
  clientId: string
  empresa:  string
  modulo:   string
  nombreModulo: string
}): Promise<void> {
  await crearAvisoAdmin({
    tipo:        'ampliacion_solicitada',
    titulo:      `${params.empresa} quiere ${params.nombreModulo}`,
    cuerpo:      'Lo pidió desde el panel de su portal.',
    enlace:      '/admin/soporte',
    clientId:    params.clientId,
    entidadTipo: 'ampliacion',
    // Cliente + módulo: dos módulos distintos del mismo cliente son dos avisos.
    entidadId:   `${params.clientId}:${params.modulo}`,
  })
}

/**
 * «Solicitar ayuda» del importador de autoservicio: el cliente pide que el equipo
 * haga su migración de datos (servicio de pago). Cae en el buzón de Solicitudes; el
 * operador la atiende desde la ficha (fija `migracion_estado='a_cargo_equipo'` al
 * aceptar el presupuesto, `completada` al terminar). Un cliente = una solicitud viva.
 */
export async function avisarSolicitudMigracion(params: {
  clientId: string
  empresa:  string
  mensaje?: string | null
}): Promise<void> {
  await crearAvisoAdmin({
    tipo:        'migracion_ayuda',
    titulo:      `${params.empresa} pide ayuda para importar`,
    cuerpo:      params.mensaje?.trim() || 'Quiere que el equipo haga su migración de datos.',
    enlace:      `/admin/clientes/${params.clientId}`,
    clientId:    params.clientId,
    entidadTipo: 'migracion',
    entidadId:   params.clientId,
  })
}

/** Mensaje de soporte entrante desde el portal del cliente. */
export async function avisarSoporteNuevo(params: {
  mensajeId: number
  clientId:  string
  empresa:   string
  asunto:    string
}): Promise<void> {
  await crearAvisoAdmin({
    tipo:        'soporte_mensaje_nuevo',
    titulo:      `Soporte — ${params.empresa}`,
    cuerpo:      params.asunto,
    enlace:      '/admin/soporte',
    clientId:    params.clientId,
    entidadTipo: 'soporte',
    entidadId:   String(params.mensajeId),
  })
}

/** Alta de cliente en la plataforma. */
export async function avisarClienteNuevo(params: {
  clientId: string
  empresa:  string
  tarifa:   string
  ciclo:    string
}): Promise<void> {
  await crearAvisoAdmin({
    tipo:        'cliente_nuevo',
    titulo:      `Cliente nuevo — ${params.empresa}`,
    cuerpo:      `${params.clientId} · ${params.tarifa}/${params.ciclo}`,
    enlace:      `/admin/clientes/${params.clientId}`,
    clientId:    params.clientId,
    entidadTipo: 'cliente',
    entidadId:   params.clientId,
  })
}

/**
 * Pago de suscripción anotado. Además de dejar constancia, CALLA los avisos de
 * vencimiento de ese cliente: si acaba de pagar, la bandeja no puede seguir
 * pidiendo que se le reclame.
 */
export async function avisarPagoRegistrado(params: {
  pagoId:      string
  clientId:    string
  empresa:     string
  montoUsd:    number
  cubreHasta:  string
}): Promise<void> {
  await resolverAvisosCliente(params.clientId, [
    'cliente_por_vencer', 'cliente_vencido', 'prueba_termina',
  ])
  await crearAvisoAdmin({
    tipo:        'pago_registrado',
    titulo:      `Pago de ${params.empresa}`,
    cuerpo:      `${params.montoUsd.toFixed(2)} USD · cubre hasta el ${fmtFechaEs(params.cubreHasta)}`,
    enlace:      `/admin/clientes/${params.clientId}`,
    clientId:    params.clientId,
    entidadTipo: 'pago',
    entidadId:   params.pagoId,
  })
}
