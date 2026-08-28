// Avisos del admin POR TIEMPO (cron diario).
//
// Lo llama /api/cron/recordatorios al final, después de los correos y de las
// notificaciones del portal. Regla de escala igual que en el portal: UNA query por
// área para TODOS los clientes, nunca una query por cliente — el panel es uno, el
// equipo es uno, y aquí no hay tenant que iterar.
//
// Cada escáner hace dos cosas: crear lo que toca hoy y RESOLVER lo que ya no
// aplica (lead contactado, soporte respondido). Sin lo segundo la bandeja sigue
// pidiendo atender algo ya atendido.

import { createAdminClient } from '@/lib/supabase/admin'
import { fmtFechaEs } from '@/lib/date-utils'
import { hoyEnTz } from '@/lib/fecha-tz'
import { enviarAvisoInterno } from '@/lib/email/enviar'
import { esSocioHoy } from '@/lib/billing'
import { umbralAdminParaFecha } from './catalogo'
import {
  crearAvisoAdmin, cargarPrefsAdmin, resolverAvisosAdmin,
  type PreferenciaAdmin,
} from './crear'

type Db = ReturnType<typeof createAdminClient>
type Prefs = Map<string, PreferenciaAdmin>

export interface ResumenAvisosAdmin {
  creados:  number
  purgados: number
}

/** Igual que en el portal: lo atendido no aporta nada meses después. */
const DIAS_RETENCION = 90

/** Horas que un lead puede quedarse en «nuevo» antes de que sea un problema. */
const HORAS_LEAD = 48
/**
 * Y a partir de aquí ya no. Un lead de hace más de un mes sin contactar no es un
 * pendiente, es historia: nadie va a llamar a quien pidió información en mayo, y
 * avisar de ellos llena la bandeja con veinte filas que solo se cierran de golpe
 * (fue exactamente lo que pasó al enchufar esto con los leads acumulados).
 */
const DIAS_LEAD_MAX = 30
/** Horas que un mensaje de soporte puede quedarse sin respuesta. */
const HORAS_SOPORTE = 24
/** Días sin que NADIE del negocio entre al portal = riesgo de baja. */
const DIAS_INACTIVIDAD = 30

/** Días enteros de `fecha` (YYYY-MM-DD) hasta hoy. Negativo = ya pasó. */
function diasHasta(fecha: string, hoy: string): number {
  return Math.round((new Date(fecha).getTime() - new Date(hoy).getTime()) / 86_400_000)
}

function haceHoras(horas: number): string {
  return new Date(Date.now() - horas * 3_600_000).toISOString()
}

export async function generarAvisosAdmin(): Promise<ResumenAvisosAdmin> {
  const db    = createAdminClient()
  // El «hoy» de los avisos es el del NEGOCIO. Hoy este generador solo lo llama
  // el cron de las 08:00 UTC —las 03:00 o 04:00 en Cuba, mismo día—, así que en
  // UTC salía lo mismo por casualidad. Bastaría un disparo manual por la tarde,
  // o un botón «enviar ahora», para que «faltan 3 días» pasara a decir 2.
  const hoy   = hoyEnTz()
  const prefs = await cargarPrefsAdmin(db)

  let creados = 0
  creados += await escanearLeads(db, prefs)
  creados += await escanearSoporte(db, prefs)
  creados += await escanearClientes(db, prefs, hoy)
  creados += await escanearSocios(db, prefs, hoy)
  creados += await escanearInactividad(db, prefs)
  creados += await escanearCorreos(db, prefs, hoy)

  const purgados = await purgarAntiguos(db)
  return { creados, purgados }
}

// ── Ventas: leads que llevan demasiado en «nuevo» ─────────────────────────────

async function escanearLeads(db: Db, prefs: Prefs): Promise<number> {
  const [{ data }, { data: pendientes }] = await Promise.all([
    db.from('diagnosticos')
      .select('id, nombre, telefono, sector, created_at, contacto_solicitado_at')
      .eq('estado', 'nuevo')
      .lt('created_at', haceHoras(HORAS_LEAD))
      .gt('created_at', haceHoras(DIAS_LEAD_MAX * 24))
      .order('created_at', { ascending: true })
      .limit(200),
    // Para RESOLVER se piden todos los que siguen en «nuevo» dentro de la ventana,
    // sin el filtro de horas ni el límite: si se usara la lista de arriba, un lead
    // pendiente que cae fuera del límite perdería su aviso como si lo hubieran
    // atendido. Los que salen de la ventana sí se archivan: dejaron de ser
    // accionables, y así la bandeja se limpia sola.
    db.from('diagnosticos').select('id')
      .eq('estado', 'nuevo')
      .gt('created_at', haceHoras(DIAS_LEAD_MAX * 24)),
  ])

  const leads = data ?? []

  // Los que ya NO están en «nuevo» dejan de ser un pendiente: se archivan sus
  // avisos de "sin contactar" (los de "lead nuevo" se quedan, son historial).
  await resolverAvisosAdmin(db, ['lead_sin_contactar'], 'lead',
    (pendientes ?? []).map(l => String(l.id)))

  let creados = 0
  for (const l of leads) {
    const dias = Math.floor((Date.now() - new Date(l.created_at as string).getTime()) / 86_400_000)
    const ok = await crearAvisoAdmin({
      tipo:   'lead_sin_contactar',
      titulo: `${l.nombre} lleva ${dias} día${dias === 1 ? '' : 's'} sin contactar`,
      cuerpo: [
        l.sector as string,
        `Teléfono: ${l.telefono}`,
        l.contacto_solicitado_at ? 'Y encima pidió que le llamemos.' : null,
      ].filter(Boolean).join(' · '),
      enlace:      '/admin/solicitudes',
      entidadTipo: 'lead',
      entidadId:   String(l.id),
    }, prefs)
    if (ok) creados++
  }
  return creados
}

// ── Soporte: mensajes sin responder ───────────────────────────────────────────

async function escanearSoporte(db: Db, prefs: Prefs): Promise<number> {
  const [{ data }, { data: pendientes }] = await Promise.all([
    db.from('soporte_mensajes')
      .select('id, client_id, asunto, created_at, modulo_clave')
      .eq('estado', 'NUEVO')
      .lt('created_at', haceHoras(HORAS_SOPORTE))
      .order('created_at', { ascending: true })
      .limit(200),
    // Igual que con los leads: los que siguen en NUEVO conservan su aviso.
    db.from('soporte_mensajes').select('id').eq('estado', 'NUEVO'),
  ])

  // Los pedidos de módulo (`modulo_clave`) NO son incidencias de soporte: entran
  // por la misma tabla pero su aviso es `ampliacion_solicitada`, y meterlos aquí
  // haría que una oportunidad de venta apareciera como soporte sin responder.
  const mensajes = (data ?? []).filter(m => !m.modulo_clave)

  await resolverAvisosAdmin(db, ['soporte_sin_responder'], 'soporte',
    (pendientes ?? []).map(m => String(m.id)))

  const empresas = await nombresEmpresa(db, mensajes.map(m => m.client_id as string))

  let creados = 0
  for (const m of mensajes) {
    const horas = Math.floor((Date.now() - new Date(m.created_at as string).getTime()) / 3_600_000)
    const ok = await crearAvisoAdmin({
      tipo:   'soporte_sin_responder',
      titulo: `Sin responder desde hace ${horas} h — ${empresas.get(m.client_id as string) ?? m.client_id}`,
      cuerpo: m.asunto as string,
      enlace:      '/admin/soporte',
      clientId:    m.client_id as string,
      entidadTipo: 'soporte',
      entidadId:   String(m.id),
    }, prefs)
    if (ok) creados++
  }
  return creados
}

// ── Clientes: vencimientos, prueba que acaba y vencidos ───────────────────────

interface FilaCliente {
  client_id:        string
  nombre_empresa:   string
  estado:           string
  es_prueba:        boolean
  fecha_expiracion: string | null
  es_socio:         boolean | null
  socio_hasta:      string | null
}

async function escanearClientes(db: Db, prefs: Prefs, hoy: string): Promise<number> {
  const { data } = await db
    .from('clients')
    .select('client_id, nombre_empresa, estado, es_prueba, fecha_expiracion, es_socio, socio_hasta')
    .eq('es_prueba', false)
    .not('fecha_expiracion', 'is', null)
    .is('archivado_at', null)

  let creados = 0
  for (const c of (data ?? []) as FilaCliente[]) {
    // El socio vigente tiene su propio escáner (`escanearSocios`) y su propio
    // reloj. Su `fecha_expiracion` es la del último ciclo que pagó y se queda
    // atrás para siempre, así que sin este corte la bandeja diría «Punto y Aparte
    // está vencido» de un cliente que no debe nada, todos los días.
    if (esSocioHoy(c)) continue
    const fecha = c.fecha_expiracion!
    const dias  = diasHasta(fecha, hoy)
    // La entidad lleva la FECHA del ciclo: al renovar cambia y el aviso del ciclo
    // siguiente vuelve a ser elegible sin tocar nada. Con solo el client_id, un
    // cliente recibiría un único aviso en toda su vida.
    const entidadId = `${c.client_id}:${fecha}`

    if (dias < 0) {
      // Vencido de verdad: el estado lo confirma (el barrido ya corrió antes).
      if (c.estado !== 'DESACTIVADO' && c.estado !== 'GRACIA') continue
      const ok = await crearAvisoAdmin({
        tipo:   'cliente_vencido',
        titulo: `${c.nombre_empresa} está vencido`,
        cuerpo: `Venció el ${fmtFechaEs(fecha)} y quedó ${c.estado === 'GRACIA' ? 'en gracia' : 'desactivado'}.`,
        enlace:      `/admin/clientes/${c.client_id}`,
        clientId:    c.client_id,
        entidadTipo: 'suscripcion',
        entidadId,
        umbral:      'vencido',
        sustituyeA:  ['cliente_por_vencer', 'prueba_termina'],
      }, prefs)
      if (ok) creados++
      continue
    }

    // TRIAL y ACTIVO son historias distintas: al de prueba se le vende, al activo
    // se le cobra. Mismo escalado, mensaje y tipo distintos.
    const esTrial = c.estado === 'TRIAL'
    if (!esTrial && c.estado !== 'ACTIVO') continue

    const tipo   = esTrial ? 'prueba_termina' as const : 'cliente_por_vencer' as const
    const umbral = umbralAdminParaFecha(tipo, dias)
    if (!umbral) continue

    const cuando = dias === 0 ? 'hoy' : `en ${dias} día${dias === 1 ? '' : 's'}`
    const ok = await crearAvisoAdmin({
      tipo,
      titulo: esTrial
        ? `La prueba de ${c.nombre_empresa} acaba ${cuando}`
        : `${c.nombre_empresa} vence ${cuando}`,
      cuerpo: esTrial
        ? `Termina el ${fmtFechaEs(fecha)}. Es el momento de cerrar la venta.`
        : `Su suscripción vence el ${fmtFechaEs(fecha)}.`,
      enlace:      `/admin/clientes/${c.client_id}`,
      clientId:    c.client_id,
      entidadTipo: 'suscripcion',
      entidadId,
      umbral,
      sustituyeA:  [tipo],
    }, prefs)
    if (ok) creados++
  }
  return creados
}

// ── Socios: se les acaba el período gratuito ──────────────────────────────────
//
// Un socio no tiene factura que renovar, tiene una relación que se acaba: hay que
// decidir si se prorroga, si pasa a pagar o si se cierra. Por eso este escáner es
// aparte del de suscripciones y empieza a los 30 días.
//
// Va también POR CORREO, y no solo a la campana, porque el aviso solo sirve si
// llega: la bandeja del panel se ve al entrar al panel, y a un socio se le acaba
// el plazo tanto si esa semana entras como si no. El correo se manda SOLO cuando
// `crearAvisoAdmin` devuelve true —es decir, cuando de verdad ha creado un aviso
// nuevo—, así que sale uno por escalón y no uno al día durante un mes. La
// idempotencia la garantiza el índice único de la BD, no este código.

interface FilaSocio {
  client_id:      string
  nombre_empresa: string
  socio_hasta:    string | null
  socio_motivo:   string | null
}

async function escanearSocios(db: Db, prefs: Prefs, hoy: string): Promise<number> {
  const { data } = await db
    .from('clients')
    .select('client_id, nombre_empresa, socio_hasta, socio_motivo')
    .eq('es_socio', true)
    // Sin fecha es socio indefinido: no se acaba, así que no hay nada que avisar.
    .not('socio_hasta', 'is', null)
    .eq('es_prueba', false)
    .is('archivado_at', null)

  let creados = 0
  for (const c of (data ?? []) as FilaSocio[]) {
    const fecha = c.socio_hasta!
    const dias  = diasHasta(fecha, hoy)
    const umbral = umbralAdminParaFecha('socio_termina', dias)
    if (!umbral) continue

    const vencido = dias < 0
    const cuando  = dias === 0 ? 'hoy' : `en ${dias} día${dias === 1 ? '' : 's'}`
    const titulo  = vencido
      ? `${c.nombre_empresa} ya no es Socio CLAUX`
      : `${c.nombre_empresa} deja de ser Socio CLAUX ${cuando}`
    const cuerpo = vencido
      ? `Su condición de socio terminó el ${fmtFechaEs(fecha)}. Vuelve al flujo normal: `
        + 'se le empieza a facturar la cuota de su nivel y se le puede cortar por fecha. '
        + 'Si sigue siendo socio, prorroga la fecha en su ficha.'
      : `Termina el ${fmtFechaEs(fecha)}${c.socio_motivo ? ` (${c.socio_motivo})` : ''}. `
        + 'Toca decidir: prorrogar, pasarlo a cliente de pago o cerrar la relación. '
        + 'Ese día vuelve a facturársele la cuota de su nivel.'

    const ok = await crearAvisoAdmin({
      tipo:   'socio_termina',
      titulo,
      cuerpo,
      enlace:      `/admin/clientes/${c.client_id}?tab=cuota`,
      clientId:    c.client_id,
      entidadTipo: 'socio',
      // La fecha va en la entidad: al prorrogar cambia, y la nueva cuenta atrás
      // vuelve a ser elegible sola. Con solo el client_id, un socio al que se le
      // prorroga tres veces avisaría una única vez en su vida.
      entidadId:   `${c.client_id}:${fecha}`,
      umbral,
      sustituyeA:  ['socio_termina'],
    }, prefs)

    if (!ok) continue
    creados++
    await enviarAvisoInterno({
      tipo:     'socio_termina',
      asunto:   titulo,
      cuerpo:   `${cuerpo}\n\nFicha del cliente: /admin/clientes/${c.client_id}`,
      clientId: c.client_id,
    })
  }
  return creados
}

// ── Clientes: nadie entra al portal ───────────────────────────────────────────

async function escanearInactividad(db: Db, prefs: Prefs): Promise<number> {
  // Último acceso por cliente: se pide TODO y se agrupa en memoria porque
  // PostgREST no hace GROUP BY. Son pocas filas (usuarios de portal, no eventos).
  const [{ data: usuarios }, { data: clientes }] = await Promise.all([
    db.from('client_users').select('client_id, last_login_at').eq('estado', 'ACTIVO'),
    db.from('clients')
      .select('client_id, nombre_empresa')
      .eq('estado', 'ACTIVO').eq('es_prueba', false).is('archivado_at', null),
  ])

  const ultimo = new Map<string, string | null>()
  for (const u of usuarios ?? []) {
    const k   = u.client_id as string
    const val = (u.last_login_at ?? null) as string | null
    const ya  = ultimo.get(k)
    if (ya === undefined || (val && (!ya || val > ya))) ultimo.set(k, val)
  }

  const corte = Date.now() - DIAS_INACTIVIDAD * 86_400_000

  let creados = 0
  for (const c of clientes ?? []) {
    const acceso = ultimo.get(c.client_id as string)
    // Sin fila de usuario activo no hay nada que medir (cliente recién creado o
    // sin acceso dado): eso no es inactividad, es que aún no ha empezado.
    if (acceso === undefined) continue
    if (acceso && new Date(acceso).getTime() > corte) continue

    const dias = acceso ? Math.floor((Date.now() - new Date(acceso).getTime()) / 86_400_000) : null
    const ok = await crearAvisoAdmin({
      tipo:   'cliente_inactivo',
      titulo: `${c.nombre_empresa} no entra al portal`,
      cuerpo: dias === null
        ? 'Nunca ha entrado nadie desde que se le dio acceso.'
        : `Último acceso hace ${dias} días. Riesgo de que no renueve.`,
      enlace:      `/admin/clientes/${c.client_id}`,
      clientId:    c.client_id as string,
      entidadTipo: 'inactividad',
      // La fecha del último acceso entra en la entidad: si el cliente vuelve y se
      // queda quieto otra vez, es una racha nueva y vuelve a avisar.
      entidadId:   `${c.client_id}:${acceso ? acceso.slice(0, 10) : 'nunca'}`,
    }, prefs)
    if (ok) creados++
  }
  return creados
}

// ── Plataforma: correos que no salieron ───────────────────────────────────────

async function escanearCorreos(db: Db, prefs: Prefs, hoy: string): Promise<number> {
  const { data } = await db
    .from('emails_log')
    .select('id, tipo, error')
    .eq('estado', 'error')
    .gte('created_at', haceHoras(24))
    .limit(100)

  const fallos = data ?? []
  if (fallos.length === 0) return 0

  // UN aviso por día, no uno por correo: si la clave de Resend está mal, fallan
  // todos a la vez y la bandeja se llenaría de veinte filas del mismo problema.
  const tipos = [...new Set(fallos.map(f => f.tipo as string))].join(', ')
  const ok = await crearAvisoAdmin({
    tipo:   'email_fallido',
    titulo: `${fallos.length} correo${fallos.length === 1 ? '' : 's'} sin salir`,
    cuerpo: `${tipos}. Último error: ${(fallos[0].error as string | null) ?? 'sin detalle'}`,
    enlace:      '/admin/notificaciones',
    entidadTipo: 'emails_dia',
    entidadId:   hoy,
  }, prefs)
  return ok ? 1 : 0
}

// ── Utilidades ────────────────────────────────────────────────────────────────

async function nombresEmpresa(db: Db, clientIds: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(clientIds.filter(Boolean))]
  if (unicos.length === 0) return new Map()
  const { data } = await db
    .from('clients')
    .select('client_id, nombre_empresa')
    .in('client_id', unicos)
  return new Map((data ?? []).map(c => [c.client_id as string, c.nombre_empresa as string]))
}

async function purgarAntiguos(db: Db): Promise<number> {
  const corte = new Date(Date.now() - DIAS_RETENCION * 86_400_000).toISOString()
  const { data, error } = await db
    .from('admin_notificaciones')
    .delete()
    .in('estado', ['leida', 'archivada'])
    .lt('created_at', corte)
    .select('id')

  if (error) {
    console.error('[avisos-admin] purga fallida', error.message)
    return 0
  }
  return data?.length ?? 0
}
