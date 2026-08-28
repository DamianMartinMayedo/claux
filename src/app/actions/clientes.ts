'use server'

import { requirePermiso } from '@/lib/admin-guard'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { logActividad } from '@/lib/audit'
import { addDays, toDateStr, fmtFechaEs } from '@/lib/date-utils'
import { getSetting } from '@/app/actions/settings'
import { diasCiclo, importeCiclo, esSocioHoy } from '@/lib/billing'
import { normalizarNivel, nombreNivel, sumarModulos, type ModuloPrecios } from '@/lib/niveles'
import { DIMENSIONES, usoDeLimites } from '@/lib/limites'
import { renderPlantilla } from '@/lib/email/render'
import { enviarEmail, enviarAvisoInterno, tipoEmailActivo } from '@/lib/email/enviar'
import { avisarClienteNuevo } from '@/lib/notificaciones/admin/eventos'
import { notificarGraciaActivada } from '@/lib/notificaciones/eventos'
import { esMigracionEstado, MIGRACION_ESTADOS_ALTA, type MigracionEstado } from '@/lib/migracion'
import { COLUMNAS_EXENCION, desactivable, estadoAlRetirarGracia, socioMalSuspendido } from '@/lib/clientes/ciclo-vida'
import { hoyEnTz } from '@/lib/fecha-tz'

const LINK_PORTAL = 'https://claux.es/portal/login'

// ── Utilidades de seguridad ──────────────────────────────────────────
async function hashPassword(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + salt)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function generatePassword(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function generateSalt(): string {
  return crypto.randomUUID()
}

/**
 * `ana@gmail.com` + `CLI-0005` → `ana+cli0005@gmail.com` (plus-addressing).
 *
 * Sirve para dar de alta varios clientes de PRUEBA con el mismo buzón: el correo
 * sigue llegando a la misma bandeja, pero la dirección es única y no rompe el
 * login (ver la nota de «Email único» en `crearCliente`).
 *
 * El sufijo se corta del local-part antes de añadir el nuevo: si no, recrear un
 * cliente iría encadenando `ana+cli0005+cli0006@…`. Y sale del client_id, que ya
 * es único, así que el resultado tampoco puede chocar.
 */
function emailConSufijo(email: string, client_id: string): string {
  const arroba = email.lastIndexOf('@')
  if (arroba < 1) return email                       // sin @ no hay nada que sufijar
  const local   = email.slice(0, arroba).split('+')[0]
  const dominio = email.slice(arroba + 1)
  return `${local}+${client_id.toLowerCase().replace(/-/g, '')}@${dominio}`
}


// ── Helper: precio mensual a partir de los módulos activos ───────────
// Suma los módulos/funcionalidades activos por la columna de su NIVEL. Precios
// desde modulos_catalogo (nunca hardcodeados). Todos los módulos son opcionales,
// incluida la contabilidad ('base').
//
// Devuelve el precio de CATÁLOGO, sin descuento ni condición de socio: eso lo
// resuelve `precioMensualEfectivo` al leer, porque tiene fecha de caducidad y un
// número cacheado no caduca solo (§`lib/billing.ts`).
async function calcularPrecioMensual(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  modulosActivos: string[],
  nivel: string,
): Promise<number> {
  const { data: catalogo } = await supabase
    .from('modulos_catalogo')
    .select('clave, precio_inicial_usd, precio_empresa_usd, precio_pro_usd, activo')
    .eq('activo', true)
  return sumarModulos((catalogo ?? []) as ModuloPrecios[], modulosActivos, nivel)
}

// ── Crear cliente ────────────────────────────────────────────────────
export async function crearCliente(formData: FormData) {
  await requirePermiso('clientes')
  const supabase = await createClient()

  const nombre_empresa  = (formData.get('nombre_empresa')  as string ?? '').trim()
  const nombre_contacto = (formData.get('nombre_contacto') as string ?? '').trim()
  const email_admin     = (formData.get('email_admin')     as string ?? '').trim().toLowerCase()
  const notas           = (formData.get('notas')           as string ?? '').trim() || null
  const es_trial        = formData.get('es_trial') === 'true'
  const es_prueba       = formData.get('es_prueba') === 'true'
  const nivel           = normalizarNivel(formData.get('nivel') ?? formData.get('tarifa'))
  const ciclo           = (formData.get('ciclo_facturacion') as string ?? 'mensual').trim()
  const sector          = (formData.get('sector') as string ?? '').trim() || null
  const pagoSetupRaw    = parseFloat(formData.get('pago_setup_usd') as string ?? '0')
  const pago_setup_usd  = isNaN(pagoSetupRaw) ? 0 : pagoSetupRaw
  // El presupuesto del que sale el alta (si viene de uno). Se lee aquí arriba
  // porque no solo enlaza el cliente al final: es también de donde sale el cobro
  // de configuración, y ese vínculo es lo que le permite seguir al presupuesto
  // cuando se edita o se re-aprueba (mig. 204).
  const presupuestoIdRaw = parseInt((formData.get('presupuesto_id') as string ?? '').trim(), 10)
  const presupuesto_id   = Number.isFinite(presupuestoIdRaw) && presupuestoIdRaw > 0 ? presupuestoIdRaw : null
  // Situación de migración de datos elegida en el alta (§5 importador de autoservicio).
  // El alta NO ofrece `completada` (se alcanza al terminar): fuera de la lista → cero.
  const migRaw          = (formData.get('migracion_estado') as string ?? '').trim()
  const migracion_estado: MigracionEstado =
    (MIGRACION_ESTADOS_ALTA as string[]).includes(migRaw) ? (migRaw as MigracionEstado) : 'sin_datos_previos'

  if (!nombre_empresa || !email_admin) {
    return { ok: false, error: 'Nombre de empresa y email son obligatorios.' }
  }
  if (!['mensual', 'anual'].includes(ciclo))      return { ok: false, error: 'Ciclo de facturación inválido.' }

  // Generar client_id secuencial. Va antes que la resolución del email porque el
  // sufijo de los clientes de prueba se construye con él.
  const { count } = await supabase.from('clients').select('*', { count: 'exact', head: true })
  const client_id = `CLI-${String((count ?? 0) + 1).padStart(4, '0')}`

  // ── Email único ──
  // No es una formalidad: `loginCliente` busca al usuario SOLO por email, sin
  // client_id, y no hay índice único en client_users.email. Dos clientes con el
  // mismo correo hacen que el `maybeSingle()` del login devuelva error con dos
  // filas → los DOS se quedan fuera, con un «Credenciales incorrectas» que no
  // explica nada. El correo es la identidad de login, global entre tenants.
  //
  // Para los clientes de PRUEBA, que se crean a puñados con el mismo correo de
  // siempre, en vez de rechazar se desambigua con plus-addressing: el buzón es el
  // mismo (Gmail y compañía entregan igual) pero la dirección es única, así que el
  // login sigue funcionando.
  let email_final = email_admin
  const { data: emailExiste } = await supabase
    .from('clients')
    .select('client_id')
    .eq('email_admin', email_admin)
    .maybeSingle()
  if (emailExiste) {
    if (!es_prueba) return { ok: false, error: 'Ya existe un cliente con ese email.' }
    email_final = emailConSufijo(email_admin, client_id)
  }

  // Módulos seleccionados (la contabilidad 'base' es opcional, como cualquier
  // módulo) y precio mensual resultante. Se normalizan igual que en el toggle:
  // el alta también compone un conjunto y lo convierte en la primera cuota.
  const modulos_activos = formData.getAll('modulos') as string[]
  const precio_mensual_usd = await calcularPrecioMensual(supabase, modulos_activos, nivel)

  // Estado y vigencia: trial → TRIAL por días configurables; sin trial → DESACTIVADO hasta que
  // se confirme el primer pago de suscripción (confirmarPago lo pasa a ACTIVO).
  //
  // El cliente de PRUEBA es la excepción, porque no es una venta: es un entorno
  // interno nuestro, de por vida. Es TRIAL siempre —nunca DESACTIVADO, que lo
  // bloquearía, ni ACTIVO, que lo haría pasar por cliente de pago— y sin fecha de
  // expiración: un trial que no caduca. Los botones de cobro y suspensión no se le
  // ofrecen (ver AccionesHeader).
  const estadoInicial = (es_prueba || es_trial) ? 'TRIAL' : 'DESACTIVADO'
  const diasVigencia  = es_trial
    ? (parseInt(await getSetting('dias_trial_default', '15'), 10) || 15)
    : diasCiclo(ciclo)

  const hoy = new Date()
  const fechaExpiracion = addDays(hoy, diasVigencia)

  const { error: errorCliente } = await supabase.from('clients').insert({
    client_id,
    nombre_empresa,
    nombre_contacto: nombre_contacto || null,
    email_admin: email_final,
    sector,
    modulos_activos,
    nivel,
    ciclo_facturacion: ciclo,
    precio_mensual_usd,
    fecha_inicio:     toDateStr(hoy),
    fecha_expiracion: es_prueba ? null : toDateStr(fechaExpiracion),
    estado:           estadoInicial,
    es_prueba,
    notas,
    migracion_estado,
  })

  if (errorCliente) return { ok: false, error: errorCliente.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'cliente',
    entity_id:   client_id,
    action:      'crear',
    description: `Creó cliente ${nombre_empresa} (${client_id}) — ${modulos_activos.length} módulo(s) · nivel ${nivel}/${ciclo} · $${precio_mensual_usd.toFixed(2)}/mes — Estado: ${estadoInicial}`,
  })

  // ── Pre-crear los cobros esperados como "por confirmar" ──────────────
  // Configuración (pago único, si > 0) + primera suscripción (si no es trial).
  // Se confirman cuando el cliente paga de verdad; solo entonces cuentan como ingreso.
  // Al cliente de PRUEBA no se le cobra nada, así que no se le crea ningún cobro:
  // si no, saldría en cuentas por cobrar como una deuda que nadie va a pagar jamás
  // y que habría que ir marcando a mano cada ciclo.
  const descuentoAnual   = parseInt(await getSetting('descuento_anual_pct', '10'), 10) || 0
  const montoSuscripcion = (es_prueba || es_trial) ? 0 : importeCiclo(precio_mensual_usd, ciclo, descuentoAnual)

  // Numerador correlativo de pago_id (puede crear hasta 2 pagos)
  const { data: ultPago } = await supabase
    .from('payments').select('pago_id').order('pago_id', { ascending: false }).limit(1).maybeSingle()
  let pagoNum = 1
  if (ultPago?.pago_id) {
    const mm = ultPago.pago_id.match(/PAG-(\d+)/)
    if (mm) pagoNum = parseInt(mm[1], 10) + 1
  }
  const nuevoPagoId = () => `PAG-${String(pagoNum++).padStart(4, '0')}`

  const pagosPre: Record<string, unknown>[] = []
  if (!es_prueba && pago_setup_usd > 0) {
    pagosPre.push({
      pago_id:  nuevoPagoId(),
      client_id,
      presupuesto_id,
      monto_usd: pago_setup_usd,
      metodo:    'transferencia',
      concepto:  'configuracion',
      estado:    'por_confirmar',
      fecha:     toDateStr(hoy),
      notas:     'Pago único de configuración inicial',
    })
  }
  if (montoSuscripcion > 0) {
    pagosPre.push({
      pago_id:  nuevoPagoId(),
      client_id,
      monto_usd: montoSuscripcion,
      metodo:    'transferencia',
      concepto:  'suscripcion',
      estado:    'por_confirmar',
      fecha:     toDateStr(hoy),
      fecha_inicio_periodo: toDateStr(hoy),
      fecha_fin_periodo:    toDateStr(fechaExpiracion),
      notas:     `Primer cobro de suscripción (${ciclo})`,
    })
  }
  if (pagosPre.length > 0) {
    await supabase.from('payments').insert(pagosPre)
    for (const p of pagosPre) {
      await logActividad(supabase, {
        user_email:  user?.email ?? 'sistema',
        entity:      'pago',
        entity_id:   p.pago_id as string,
        action:      'registrar',
        description: `Pre-creó pago ${p.pago_id} (${p.concepto}, por confirmar) — Cliente: ${client_id} — $${Number(p.monto_usd).toFixed(2)}`,
      })
    }
  }

  // Crear usuario admin inicial del cliente
  const passwordTemporal = generatePassword()
  const salt             = generateSalt()
  const password_hash    = await hashPassword(passwordTemporal, salt)
  const user_id          = `${client_id}-U001`

  await supabase.from('client_users').insert({
    user_id,
    client_id,
    nombre:              nombre_contacto || nombre_empresa,
    email:               email_final,
    password_hash,
    salt,
    rol:                 'admin_empresa',
    must_change_password: true,
    estado:              'ACTIVO',
  })

  // after(): el envío corre TRAS la respuesta pero garantizado (a diferencia de un
  // `void` suelto, que Vercel descarta al congelar la función). Un fallo de Resend
  // no rompe la creación del cliente.
  after(async () => {
    if (!(await tipoEmailActivo('bienvenida'))) return
    const { asunto, html } = await renderPlantilla('bienvenida', {
      nombre: nombre_contacto || nombre_empresa,
      empresa: nombre_empresa,
      usuario: email_final,
      password_temporal: passwordTemporal,
      link_portal: LINK_PORTAL,
    })
    await enviarEmail({
      to: email_final,
      subject: asunto,
      html,
      tipo: 'bienvenida',
      clientId: client_id,
    })
  })

  // Bandeja del equipo (info, sin popup): quien no dio el alta se entera igual, y
  // el aviso enlaza a la ficha del cliente recién creado.
  after(() => avisarClienteNuevo({
    clientId: client_id,
    empresa:  nombre_empresa,
    nivel,
    ciclo,
  }))

  after(() => enviarAvisoInterno({
    tipo: 'aviso_cliente',
    asunto: `Nuevo cliente creado: ${nombre_empresa}`,
    cuerpo: `Se creó el cliente ${nombre_empresa} (${client_id}).\n\nContacto: ${nombre_contacto || '—'}\nEmail: ${email_final}\nNivel: ${nombreNivel(nivel)}/${ciclo}\nMódulos: ${modulos_activos.join(', ') || '—'}\nEstado inicial: ${estadoInicial}`,
    clientId: client_id,
  }))

  // Si el alta viene de un presupuesto aprobado, enlazamos el cliente creado al
  // presupuesto (cierra el embudo ventas → cliente y evita duplicar el alta).
  if (presupuesto_id) {
    await supabase
      .from('presupuestos_instalacion')
      .update({ client_id })
      .eq('id', presupuesto_id)
    revalidatePath('/admin/presupuestos')
  }

  revalidatePath('/admin/clientes')
  revalidatePath('/admin/dashboard')
  revalidatePath('/admin/pagos')
  // `email_final` viaja de vuelta porque puede NO ser el que se tecleó (ver
  // «Email único»): si se le sufijó, el modal tiene que enseñar el de verdad —es
  // con el que se inicia sesión— y no el que escribió quien lo creó.
  return { ok: true, client_id, passwordTemporal, estado: estadoInicial, email: email_final }
}

// ── Regenerar contraseña de un usuario del cliente ───────────────────
// Las contraseñas son hash de una vía (no se recuperan), pero SÍ se regeneran.
// Resuelve el huevo-y-la-gallina: si el admin principal del tenant pierde su
// clave, aquí (panel admin) se le genera una temporal. must_change_password:true
// → el cliente definirá su propia contraseña en el primer acceso.
// El mismo correo `password_reset` que manda el portal sale también desde aquí, y
// se espera la respuesta de Resend para poder decirle al admin si llegó o no
// (mismo criterio que el reset del portal): saber si tiene que dictar la
// contraseña por otra vía es justo lo que necesita en ese momento.
export async function regenerarPasswordCliente(
  user_id: string,
  client_id: string,
): Promise<{ ok: boolean; passwordTemporal?: string; emailEnviado?: boolean; error?: string }> {
  await requirePermiso('clientes')
  const supabase = await createClient()

  if (!user_id || !client_id) return { ok: false, error: 'Datos inválidos.' }

  // Verificar que el usuario pertenece a ese cliente antes de tocar nada
  const { data: usuario } = await supabase
    .from('client_users')
    .select('user_id, email, nombre')
    .eq('user_id', user_id)
    .eq('client_id', client_id)
    .maybeSingle()

  if (!usuario) return { ok: false, error: 'Usuario no encontrado para este cliente.' }

  const passwordTemporal = generatePassword()
  const salt             = generateSalt()
  const password_hash    = await hashPassword(passwordTemporal, salt)

  const { error } = await supabase
    .from('client_users')
    .update({ password_hash, salt, must_change_password: true })
    .eq('user_id', user_id)
    .eq('client_id', client_id)

  if (error) return { ok: false, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'cliente',
    entity_id:   client_id,
    action:      'reset_password',
    description: `Regeneró la contraseña del usuario ${usuario.email} (${user_id}) del cliente ${client_id}`,
  })

  // El envío va esperado (no en after()) para poder devolver `emailEnviado`: la
  // contraseña temporal ya está puesta, así que un fallo de Resend no rompe nada
  // —solo cambia lo que el modal le dice al admin—. `enviarEmail` nunca lanza;
  // deja el motivo en emails_log.
  let emailEnviado = false
  if (await tipoEmailActivo('password_reset')) {
    const { data: cliente } = await supabase
      .from('clients')
      .select('nombre_empresa')
      .eq('client_id', client_id)
      .maybeSingle()
    const { asunto, html } = await renderPlantilla('password_reset', {
      nombre: usuario.nombre,
      empresa: cliente?.nombre_empresa ?? client_id,
      usuario: usuario.email,
      password_temporal: passwordTemporal,
      link_portal: LINK_PORTAL,
    })
    const envio = await enviarEmail({
      to: usuario.email,
      subject: asunto,
      html,
      tipo: 'password_reset',
      clientId: client_id,
    })
    emailEnviado = envio.ok
  }

  revalidatePath(`/admin/clientes/${client_id}`)
  return { ok: true, passwordTemporal, emailEnviado }
}

// ── Desactivar cliente ───────────────────────────────────────────────
export async function cambiarEstadoCliente(formData: FormData) {
  await requirePermiso('clientes')
  const supabase = await createClient()

  const client_id    = formData.get('client_id') as string
  const nuevo_estado = formData.get('estado')    as string

  if (!client_id || nuevo_estado !== 'DESACTIVADO') {
    return { ok: false, error: 'Datos inválidos.' }
  }

  // A un Socio CLAUX vigente no se le suspende por aquí, y no es una regla de
  // cortesía: el guardia del portal lo deja entrar igual (mira la bandera, no el
  // estado) y el barrido lo devuelve a ACTIVO en el siguiente refresco del admin.
  // Sin este corte el botón parecía funcionar, la ficha decía DESACTIVADO, y al
  // rato volvía solo — con una línea en la auditoría que nadie había pedido.
  // Para cortarle a un socio hay que quitarle la bandera o ponerle fecha de fin,
  // que es la decisión que sí dice lo que quiere decir.
  const { data: previo } = await supabase
    .from('clients')
    .select(COLUMNAS_EXENCION)
    .eq('client_id', client_id)
    .maybeSingle()
  if (previo && esSocioHoy(previo)) {
    return {
      ok: false,
      error: 'Es Socio CLAUX vigente: retírale la condición de socio (o ponle fecha de fin) en «Condiciones comerciales» antes de suspenderlo.',
    }
  }

  const { error } = await supabase
    .from('clients')
    .update({ estado: nuevo_estado })
    .eq('client_id', client_id)

  if (error) return { ok: false, error: error.message }

  const { data: { user: u3 } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  u3?.email ?? 'sistema',
    entity:      'cliente',
    entity_id:   client_id,
    action:      'suspender',
    description: `Desactivó manualmente al cliente ${client_id}`,
  })

  revalidatePath('/admin/clientes')
  revalidatePath(`/admin/clientes/${client_id}`)
  revalidatePath('/admin/dashboard')
  return { ok: true as const }
}

// ── Archivar / desarchivar cliente (soft-delete reversible) ──────────
// Para clientes que SÍ tienen historial contable: los saca de las listas
// activas sin borrar nada. Reversible. Nunca se pierde facturación.
export async function archivarCliente(client_id: string): Promise<{ ok: boolean; error?: string }> {
  await requirePermiso('clientes')
  const supabase = await createClient()
  if (!client_id) return { ok: false, error: 'client_id requerido.' }

  const { data: cliente } = await supabase
    .from('clients').select('nombre_empresa').eq('client_id', client_id).maybeSingle()
  if (!cliente) return { ok: false, error: 'Cliente no encontrado.' }

  const { error } = await supabase
    .from('clients').update({ archivado_at: new Date().toISOString() }).eq('client_id', client_id)
  if (error) return { ok: false, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'cliente',
    entity_id:   client_id,
    action:      'archivar',
    description: `Archivó al cliente ${cliente.nombre_empresa} (${client_id})`,
  })

  revalidatePath('/admin/clientes')
  revalidatePath(`/admin/clientes/${client_id}`)
  return { ok: true }
}

export async function desarchivarCliente(client_id: string): Promise<{ ok: boolean; error?: string }> {
  await requirePermiso('clientes')
  const supabase = await createClient()
  if (!client_id) return { ok: false, error: 'client_id requerido.' }

  const { error } = await supabase
    .from('clients').update({ archivado_at: null }).eq('client_id', client_id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/admin/clientes')
  revalidatePath(`/admin/clientes/${client_id}`)
  return { ok: true }
}

// ── Borrado seguro (purga total, irreversible) ───────────────────────
// Solo para clientes de prueba: exige estar SUSPENDIDO, SIN pagos confirmados
// (salvaguarda contable, también forzada en la función SQL) y confirmación
// escribiendo el nombre. Purga las ~54 tablas del tenant vía RPC atómica.
export async function eliminarCliente(
  client_id: string,
  confirmacion: string,
): Promise<{ ok: boolean; error?: string }> {
  await requirePermiso('clientes')
  const supabase = await createClient()
  if (!client_id) return { ok: false, error: 'client_id requerido.' }

  const { data: cliente } = await supabase
    .from('clients').select('nombre_empresa, estado, es_prueba').eq('client_id', client_id).maybeSingle()
  if (!cliente) return { ok: false, error: 'Cliente no encontrado.' }

  // Los dos candados de abajo protegen la facturación de un cliente real: obligan a
  // suspenderlo primero (para que borrar sea deliberado) y prohíben destruir pagos
  // cobrados. A un cliente de PRUEBA no le aplican: no se le cobra, está fuera de
  // todas las estadísticas y su razón de ser es crearlo y tirarlo. Obligarle a pasar
  // por «suspender» solo para poder borrarlo era fricción sin nada que proteger.
  // La confirmación por nombre sí se le exige: contra el borrado accidental, no
  // contra la pérdida de dinero.
  if (!cliente.es_prueba) {
    if (cliente.estado !== 'DESACTIVADO') {
      return { ok: false, error: 'Suspende el cliente antes de borrarlo.' }
    }

    const { count } = await supabase
      .from('payments')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client_id)
      .eq('estado', 'confirmado')
    if ((count ?? 0) > 0) {
      return { ok: false, error: 'Tiene pagos confirmados: no se puede borrar (usa Archivar para no perder facturación).' }
    }
  }

  if ((confirmacion ?? '').trim() !== cliente.nombre_empresa.trim()) {
    return { ok: false, error: 'El nombre no coincide. Escríbelo exactamente para confirmar.' }
  }

  const { error } = await supabase.rpc('eliminar_cliente', { p_client_id: client_id })
  if (error) return { ok: false, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'cliente',
    entity_id:   client_id,
    action:      'eliminar',
    description: `Borró (purga total) al cliente ${cliente.nombre_empresa} (${client_id})`,
  })

  revalidatePath('/admin/clientes')
  revalidatePath('/admin/dashboard')
  return { ok: true }
}

// ── Aplicar período especial (GRACIA) ────────────────────────────────
/**
 * Retira el período especial de un cliente y lo devuelve al estado que le toque.
 *
 * No es «deshacer»: `aplicarGracia` no guarda de dónde venía, así que el estado de
 * vuelta se DEDUCE (ver `estadoAlRetirarGracia`). En el caso corriente —un cliente
 * cuya fecha pagada ya pasó— retirarla lo deja DESACTIVADO hoy mismo, sin
 * transición y sin poder volver atrás salvo aplicando otro período. Por eso el
 * modal que llama aquí enseña el estado resultante ANTES de pulsar, y por eso el
 * estado se recalcula aquí en servidor en lugar de aceptar el que mande el
 * navegador: lo que se enseña es un aviso, no la fuente de la verdad.
 */
export async function retirarGracia(client_id: string) {
  await requirePermiso('clientes')
  const supabase = await createClient()

  const { data: cliente, error: errLeer } = await supabase
    .from('clients')
    .select(`estado, fecha_expiracion, ${COLUMNAS_EXENCION}`)
    .eq('client_id', client_id)
    .maybeSingle()

  if (errLeer)  return { ok: false as const, error: errLeer.message }
  if (!cliente) return { ok: false as const, error: 'No se encontró el cliente.' }
  if (cliente.estado !== 'GRACIA') {
    return { ok: false as const, error: 'Este cliente no tiene un período especial activo.' }
  }

  const nuevoEstado = estadoAlRetirarGracia(cliente, hoyEnTz())

  const { error } = await supabase
    .from('clients')
    .update({
      estado:           nuevoEstado,
      fecha_fin_gracia: null,
      motivo_gracia:    null,
      notas_gracia:     null,
    })
    .eq('client_id', client_id)

  if (error) return { ok: false as const, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'cliente',
    entity_id:   client_id,
    action:      'gracia',
    description: `Retiró el período especial del cliente ${client_id} — queda en ${nuevoEstado}`,
  })

  revalidatePath('/admin/clientes')
  revalidatePath(`/admin/clientes/${client_id}`)
  revalidatePath('/admin/dashboard')
  return { ok: true as const, estado: nuevoEstado }
}

export async function aplicarGracia(formData: FormData) {
  await requirePermiso('clientes')
  const supabase = await createClient()

  const client_id = formData.get('client_id') as string
  const dias      = parseInt(formData.get('dias') as string)
  const motivo    = (formData.get('motivo') as string ?? '').trim()
  const notas     = (formData.get('notas')  as string ?? '').trim() || null

  if (!client_id || isNaN(dias) || dias < 1 || dias > 180) {
    return { ok: false, error: 'Los días deben estar entre 1 y 180.' }
  }
  if (!motivo) {
    return { ok: false, error: 'El motivo es obligatorio.' }
  }

  // Los días se cuentan desde el hoy del NEGOCIO: con `new Date()` a secas, una
  // gracia aplicada de noche en Cuba (ya día siguiente en UTC) terminaba una
  // jornada antes de la que se le había dicho al cliente.
  const fechaGracia = addDays(new Date(`${hoyEnTz()}T12:00:00`), dias)

  const { error } = await supabase
    .from('clients')
    .update({
      estado:           'GRACIA',
      fecha_fin_gracia:  toDateStr(fechaGracia),
      motivo_gracia:     motivo,
      notas_gracia:      notas,
    })
    .eq('client_id', client_id)

  if (error) return { ok: false, error: error.message }

  const { data: { user: u4 } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  u4?.email ?? 'sistema',
    entity:      'cliente',
    entity_id:   client_id,
    action:      'gracia',
    description: `Aplicó período especial al cliente ${client_id} — ${dias} días — Motivo: ${motivo}`,
  })

  // Aviso en la campana del portal del cliente: sin esto, lo único que ve es el
  // "tu suscripción venció" del cron del día siguiente, sin ninguna pista de que
  // ya tiene acceso extendido.
  after(async () => {
    await notificarGraciaActivada({ clientId: client_id, fechaFinGracia: toDateStr(fechaGracia) })
  })

  // Y por correo, en un after() aparte para que un fallo de Resend no se lleve el
  // aviso de la campana: esa solo la ve quien entra, y justo ahora el dueño cree
  // que le cortaron el acceso, así que puede pasar días sin abrir el portal.
  // El texto NO nombra el motivo (cortesía, liquidez, promoción...): ese campo es
  // nota interna del equipo y al cliente solo se le dice hasta cuándo tiene acceso.
  after(async () => {
    if (!(await tipoEmailActivo('periodo_gracia'))) return
    const { data: cli } = await createAdminClient()
      .from('clients')
      .select('nombre_empresa, email_admin, fecha_expiracion')
      .eq('client_id', client_id)
      .maybeSingle()
    // Mismo guard que el cron de recordatorios: sin correo no hay a quién escribir,
    // y sin fecha de vencimiento la primera frase se queda en «venció el {{...}}».
    if (!cli?.email_admin || !cli.fecha_expiracion) return
    const { asunto, html } = await renderPlantilla('periodo_gracia', {
      empresa:          cli.nombre_empresa,
      fecha_fin:        fmtFechaEs(toDateStr(fechaGracia)),
      fecha_expiracion: fmtFechaEs(cli.fecha_expiracion),
      dias:             String(dias),
    })
    await enviarEmail({
      to:       cli.email_admin,
      subject:  asunto,
      html,
      tipo:     'periodo_gracia',
      clientId: client_id,
      // Deja en el log a qué período corresponde el envío: dos ampliaciones
      // seguidas son dos correos distintos, no un duplicado.
      meta:     { fecha_fin_gracia: toDateStr(fechaGracia) },
    })
  })

  revalidatePath('/admin/clientes')
  revalidatePath(`/admin/clientes/${client_id}`)
  revalidatePath('/admin/dashboard')
  return { ok: true as const, hasta: toDateStr(fechaGracia) }
}

// ── Módulos à la carte: activar/desactivar y recalcular precio ───────
export async function setModulosCliente(formData: FormData) {
  await requirePermiso('clientes')
  const supabase = await createClient()

  const client_id = (formData.get('client_id') as string ?? '').trim()
  const nivel     = normalizarNivel(formData.get('nivel') ?? formData.get('tarifa'))
  const ciclo     = (formData.get('ciclo_facturacion') as string ?? 'mensual').trim()

  if (!client_id) return { ok: false, error: 'client_id requerido.' }
  if (!['mensual', 'anual'].includes(ciclo))      return { ok: false, error: 'Ciclo de facturación inválido.' }

  // Los módulos activos vienen como checkboxes: múltiples values con name="modulos".
  // La contabilidad 'base' es opcional, como cualquier módulo (no se fuerza).
  // Se quita lo que otra pieza ya incluye (Inventario absorbe a Servicios) antes de
  // calcular el precio, o se cobraría dos veces la misma página. En silencio y no
  // con un error: el admin marcó lo que quería y un error solo le obligaría a
  // desmarcar a mano. El camino inverso (bajar de Inventario a Servicios) no borra
  // NADA: los físicos, almacenes y movimientos se quedan y dejan de mostrarse.
  const modulos_activos = formData.getAll('modulos') as string[]

  // precio = Σ módulos activos por la columna del nivel (siempre desde el catálogo)
  const precio_mensual_usd = await calcularPrecioMensual(supabase, modulos_activos, nivel)

  const { error } = await supabase
    .from('clients')
    .update({ modulos_activos, nivel, ciclo_facturacion: ciclo, precio_mensual_usd })
    .eq('client_id', client_id)

  if (error) return { ok: false, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'cliente',
    entity_id:   client_id,
    action:      'modulos',
    description: `Actualizó módulos del cliente ${client_id} — nivel ${nivel}/${ciclo} · $${precio_mensual_usd.toFixed(2)}/mes — módulos: [${modulos_activos.join(', ')}]`,
  })

  revalidatePath(`/admin/clientes/${client_id}`)
  revalidatePath('/admin/clientes')
  revalidatePath('/admin/dashboard')
  return { ok: true as const, precio_mensual_usd }
}

// ── Editar datos del cliente ──────────────────────────────────────────
export async function editarCliente(formData: FormData) {
  await requirePermiso('clientes')
  const supabase = await createClient()

  const client_id       = (formData.get('client_id')       as string ?? '').trim()
  const nombre_empresa  = (formData.get('nombre_empresa')  as string ?? '').trim()
  const nombre_contacto = (formData.get('nombre_contacto') as string ?? '').trim() || null
  const email_admin     = (formData.get('email_admin')     as string ?? '').trim().toLowerCase()
  const notas           = (formData.get('notas')           as string ?? '').trim() || null
  const es_prueba       = formData.get('es_prueba') === 'true'
  // Interruptor de emergencia del autoservicio + situación de migración (§5). El
  // checkbox siempre viaja desde la ficha: ausente = desmarcado = false.
  const autoimport_activo = formData.get('autoimport_activo') === 'true'
  const migRaw            = (formData.get('migracion_estado') as string ?? '').trim()

  if (!client_id || !nombre_empresa || !email_admin) {
    return { ok: false, error: 'Nombre de empresa y email son obligatorios.' }
  }

  // Verificar que el email no lo use otro cliente
  const { data: otro } = await supabase
    .from('clients')
    .select('client_id')
    .eq('email_admin', email_admin)
    .neq('client_id', client_id)
    .maybeSingle()
  if (otro) return { ok: false, error: 'Ese email ya está en uso por otro cliente.' }

  // `migracion_estado` solo se toca si llega un valor válido: así un formulario sin
  // el campo (o manipulado) nunca borra el estado que ya tenía el cliente.
  const patch: Record<string, unknown> = { nombre_empresa, nombre_contacto, email_admin, notas, es_prueba, autoimport_activo }
  if (esMigracionEstado(migRaw)) patch.migracion_estado = migRaw

  const { error } = await supabase
    .from('clients')
    .update(patch)
    .eq('client_id', client_id)

  if (error) return { ok: false, error: error.message }

  const { data: { user: u5 } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  u5?.email ?? 'sistema',
    entity:      'cliente',
    entity_id:   client_id,
    action:      'editar',
    description: `Editó datos del cliente ${client_id} — Empresa: ${nombre_empresa}`,
  })

  revalidatePath('/admin/clientes')
  revalidatePath(`/admin/clientes/${client_id}`)
  return { ok: true as const }
}

// ── Desactivar clientes vencidos automáticamente ────────────────────
// Busca clientes con período de gracia vencido o fecha de expiración pasada
// y los suspende automáticamente. Se ejecuta al cargar el admin.
export async function desactivarClientesVencidos(): Promise<{ ok: true; suspendidos: number }> {
  await requirePermiso('clientes')
  const supabase = await createClient()
  // El hoy del NEGOCIO, no el del servidor. Este barrido corre en CADA carga del
  // admin, a cualquier hora: con la fecha UTC, cualquier refresco entre las 20:00
  // y la medianoche cubanas veía ya el día siguiente y suspendía esa misma tarde
  // a quien vencía HOY. Su gemelo del cron usa exactamente el mismo reloj.
  const hoy = hoyEnTz()

  // Campos que dejan de tener sentido cuando la gracia termina.
  const LIMPIAR_GRACIA = { fecha_fin_gracia: null, motivo_gracia: null, notas_gracia: null }

  // 1. Clientes con GRACIA vencida → al estado que los sostenga POR DEBAJO. No a
  // DESACTIVADO por defecto: quien tenía el mes pagado y encima recibió la gracia
  // no pierde el mes porque se acabe el extra. Y el exento (prueba / socio) sale
  // de GRACIA igual, en vez de quedarse ahí para siempre enseñando una fecha de
  // período especial ya pasada. La regla va en JS y no en SQL porque es la MISMA
  // función que usa el botón de la ficha y el barrido del cron: una regla con dos
  // redacciones es una regla que se separa.
  const { data: graciaRaw, error: errGracia } = await supabase
    .from('clients')
    .select(`client_id, nombre_empresa, fecha_expiracion, ${COLUMNAS_EXENCION}`)
    .eq('estado', 'GRACIA')
    .lt('fecha_fin_gracia', hoy)
  const filasGracia = errGracia ? [] : (graciaRaw ?? [])

  if (filasGracia.length > 0) {
    // Agrupadas por destino para no escribir una a una.
    const porDestino = new Map<string, string[]>()
    for (const c of filasGracia) {
      const destino = estadoAlRetirarGracia(c, hoy)
      porDestino.set(destino, [...(porDestino.get(destino) ?? []), c.client_id])
    }
    for (const [estado, ids] of porDestino) {
      await supabase.from('clients').update({ estado, ...LIMPIAR_GRACIA }).in('client_id', ids)
    }

    const { data: { user } } = await supabase.auth.getUser()
    for (const c of filasGracia) {
      const destino = estadoAlRetirarGracia(c, hoy)
      await logActividad(supabase, {
        user_email:  user?.email ?? 'sistema',
        entity:      'cliente',
        entity_id:   c.client_id,
        action:      destino === 'DESACTIVADO' ? 'suspender' : 'gracia',
        description: destino === 'DESACTIVADO'
          ? `Desactivó automáticamente al cliente ${c.client_id} (${c.nombre_empresa}) — período de gracia vencido`
          : `Cerró el período especial vencido del cliente ${c.client_id} (${c.nombre_empresa}) — queda en ${destino}`,
      })
    }
  }
  const graciaVencidos = filasGracia.filter(c => estadoAlRetirarGracia(c, hoy) === 'DESACTIVADO')
  const graciaExentos  = filasGracia.length - graciaVencidos.length

  // 2. Clientes con ACTIVO/TRIAL y fecha_expiracion < hoy → DESACTIVADO
  const { data: expRaw, error: errExp } = await supabase
    .from('clients')
    .select(`client_id, nombre_empresa, ${COLUMNAS_EXENCION}`)
    .in('estado', ['ACTIVO', 'TRIAL'])
    .lt('fecha_expiracion', hoy)
  const expVencidos = errExp ? [] : (expRaw ?? []).filter(desactivable)

  if (expVencidos.length > 0) {
    const clientIds = expVencidos.map(c => c.client_id)
    await supabase
      .from('clients')
      .update({ estado: 'DESACTIVADO' })
      .in('client_id', clientIds)

    // Log de auditoría
    const { data: { user } } = await supabase.auth.getUser()
    for (const c of expVencidos) {
      await logActividad(supabase, {
        user_email:  user?.email ?? 'sistema',
        entity:      'cliente',
        entity_id:   c.client_id,
        action:      'suspender',
        description: `Desactivó automáticamente al cliente ${c.client_id} (${c.nombre_empresa}) — fecha de expiración vencida`,
      })
    }
  }

  // 3. La operación inversa: socio vigente que quedó DESACTIVADO/VENCIDO → ACTIVO.
  // Un barrido que solo sabe suspender deja para siempre la contradicción que él
  // mismo pudo escribir antes de que la exención existiera (así quedó DEUS el
  // 2026-08-28, con producción corriendo todavía el código sin exención). El
  // guardia del portal ya lo deja entrar, pero sin esto la ficha y el dashboard
  // seguirían enseñando «suspendido» a un socio.
  const { data: socioRaw, error: errSocio } = await supabase
    .from('clients')
    .select(`client_id, nombre_empresa, estado, ${COLUMNAS_EXENCION}`)
    .in('estado', ['DESACTIVADO', 'VENCIDO'])
    .eq('es_socio', true)
  const rescatados = errSocio ? [] : (socioRaw ?? []).filter(c => socioMalSuspendido(c, hoy))

  if (rescatados.length > 0) {
    await supabase
      .from('clients')
      .update({ estado: 'ACTIVO' })
      .in('client_id', rescatados.map(c => c.client_id))

    const { data: { user } } = await supabase.auth.getUser()
    for (const c of rescatados) {
      await logActividad(supabase, {
        user_email:  user?.email ?? 'sistema',
        entity:      'cliente',
        entity_id:   c.client_id,
        action:      'reactivar',
        description: `Reactivó al cliente ${c.client_id} (${c.nombre_empresa}) — es Socio CLAUX vigente y estaba en ${c.estado}`,
      })
    }
  }

  const totalSuspendidos = graciaVencidos.length + expVencidos.length

  // Revalidar paths si hubo cambios
  if (totalSuspendidos > 0 || rescatados.length > 0 || graciaExentos > 0) {
    revalidatePath('/admin/clientes')
    revalidatePath('/admin/dashboard')
  }

  return { ok: true, suspendidos: totalSuspendidos }
}

// ── Condiciones comerciales del cliente: descuento y Socio CLAUX ─────
// Plan §7.2 y §10. Son DOS cosas distintas y no se mezclan:
//
//   · **Descuento**: un porcentaje sobre la cuota mensual, con ventana de
//     fechas. No se cachea nunca (`lib/billing.ts`): un número guardado no
//     caduca solo, y este caduca.
//   · **Socio CLAUX**: no paga cuota. Es una BANDERA, no un estado — el cliente
//     sigue ACTIVO y con todo su portal; lo único que no se genera es el cobro.
//     `precio_mensual_usd` se le sigue calculando, que es lo que hace falta
//     saber el día que se negocie la conversión.
//
// Ojo con la palabra «socio»: NO es `admin_users.rol = 'partner'` (mig. 205), que
// es el revendedor externo y es otra cosa.
export async function guardarCondicionesCliente(formData: FormData) {
  await requirePermiso('clientes')
  const supabase = await createClient()

  const client_id = (formData.get('client_id') as string ?? '').trim()
  if (!client_id) return { ok: false as const, error: 'client_id requerido.' }

  const pct = Number(formData.get('descuento_pct') ?? 0) || 0
  if (pct < 0 || pct > 100) return { ok: false as const, error: 'El descuento va de 0 a 100.' }

  const desde = (formData.get('descuento_desde') as string ?? '').trim() || null
  const hasta = (formData.get('descuento_hasta') as string ?? '').trim() || null
  if (desde && hasta && hasta < desde) {
    return { ok: false as const, error: 'El descuento no puede terminar antes de empezar.' }
  }

  const es_socio    = formData.get('es_socio') === 'true'
  const socio_hasta = (formData.get('socio_hasta') as string ?? '').trim() || null

  // Cómo estaba ANTES, para saber si esto es una prórroga o solo un retoque del
  // motivo. Sin esta lectura, cada vez que se guardase la card saldría un correo
  // diciéndole al cliente algo que ya sabía.
  const { data: antes } = await supabase
    .from('clients')
    .select('es_socio, socio_hasta')
    .eq('client_id', client_id)
    .maybeSingle()
  const esProrroga = es_socio && !!socio_hasta
    && (!antes?.es_socio || !antes.socio_hasta || socio_hasta > antes.socio_hasta)

  const update = {
    descuento_pct:    pct,
    descuento_desde:  pct > 0 ? desde : null,
    descuento_hasta:  pct > 0 ? hasta : null,
    descuento_motivo: (formData.get('descuento_motivo') as string ?? '').trim() || null,
    es_socio,
    socio_hasta:      es_socio ? socio_hasta : null,
    socio_motivo:     es_socio ? ((formData.get('socio_motivo') as string ?? '').trim() || null) : null,
  }

  const { error } = await supabase.from('clients').update(update).eq('client_id', client_id)
  if (error) return { ok: false as const, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'cliente',
    entity_id:   client_id,
    action:      'condiciones',
    description: es_socio
      ? `Marcó ${client_id} como Socio CLAUX${socio_hasta ? ` hasta ${socio_hasta}` : ' (indefinido)'} — no se le genera cobro`
      : `Condiciones de ${client_id} — descuento ${pct}%${desde || hasta ? ` (${desde ?? 'ya'} → ${hasta ?? 'indefinido'})` : ''}`,
  })

  // Aviso al cliente de que la condición sigue viva. Solo cuando hay fecha nueva:
  // el asunto es «Sigues como Socio CLAUX hasta el ...», y sin fecha no hay correo
  // que escribir. Un socio indefinido no necesita que le recuerden nada.
  if (esProrroga) {
    after(async () => {
      if (!(await tipoEmailActivo('socio_ampliado'))) return
      const { data: cli } = await createAdminClient()
        .from('clients')
        .select('nombre_empresa, email_admin')
        .eq('client_id', client_id)
        .maybeSingle()
      if (!cli?.email_admin) return
      const { asunto, html } = await renderPlantilla('socio_ampliado', {
        empresa:   cli.nombre_empresa,
        fecha_fin: fmtFechaEs(socio_hasta),
      })
      await enviarEmail({
        to:       cli.email_admin,
        subject:  asunto,
        html,
        tipo:     'socio_ampliado',
        clientId: client_id,
        // Igual que en `aplicarGracia`: deja en el log hasta cuándo llega esta
        // prórroga, para que dos ampliaciones seguidas no parezcan un duplicado.
        meta:     { socio_hasta },
      })
    })
  }

  revalidatePath(`/admin/clientes/${client_id}`)
  revalidatePath('/admin/clientes')
  revalidatePath('/admin/dashboard')
  return { ok: true as const }
}

// ── Excepciones de límite de un cliente ──────────────────────────────
// La válvula del salto Inicial→Empresa: quien solo se pasa en UNA dimensión no
// tiene por qué doblar la factura. Gana sobre `nivel_limites`.
export async function guardarLimitesOverride(formData: FormData) {
  await requirePermiso('clientes')
  const supabase = await createClient()

  const client_id = (formData.get('client_id') as string ?? '').trim()
  if (!client_id) return { ok: false as const, error: 'client_id requerido.' }

  let entradas: { dimension: string; valor: number | null; motivo: string }[]
  try {
    entradas = JSON.parse((formData.get('overrides') as string) ?? '[]')
  } catch {
    return { ok: false as const, error: 'No se pudieron leer las excepciones.' }
  }
  if (!Array.isArray(entradas)) return { ok: false as const, error: 'Excepciones inválidas.' }
  // Contra `DIMENSIONES`, no contra `DIMENSIONES_LIMITE`: `ia_conversaciones` tiene
  // fila en `nivel_limites` pero su excepción por cliente vive en `ia_config.cupo`
  // (card «Asistente IA»). Aceptarla aquí crearía un segundo sitio donde tocar lo
  // mismo, y el que se guardase aquí no lo leería nadie.
  if (entradas.some(e => !(e.dimension in DIMENSIONES))) {
    return { ok: false as const, error: 'Hay una dimensión que no existe.' }
  }
  if (entradas.some(e => e.valor !== null && !(Number(e.valor) > 0))) {
    return { ok: false as const, error: 'Una excepción es un número mayor que cero, o nada.' }
  }

  // Solo viajan las que tienen valor: una excepción vacía es una excepción que se
  // retira, y se retira BORRÁNDOLA, no guardando un null que luego hay que
  // interpretar en tres sitios.
  const puestas = entradas.filter(e => e.valor !== null)
  const override: Record<string, unknown> = Object.fromEntries(
    puestas.map(e => [e.dimension, Math.floor(Number(e.valor))]),
  )
  const motivos = Object.fromEntries(
    puestas.filter(e => e.motivo?.trim()).map(e => [e.dimension, e.motivo.trim()]),
  )
  if (Object.keys(motivos).length) override._motivos = motivos

  const { error } = await supabase
    .from('clients')
    .update({ limites_override: override })
    .eq('client_id', client_id)
  if (error) return { ok: false as const, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'cliente',
    entity_id:   client_id,
    action:      'limites',
    description: puestas.length
      ? `Excepciones de límite de ${client_id}: ${puestas.map(e => `${e.dimension}=${e.valor}`).join(', ')}`
      : `Retiró todas las excepciones de límite de ${client_id}`,
  })

  revalidatePath(`/admin/clientes/${client_id}`)
  return { ok: true as const }
}

// ── «¿Y si le subo de nivel?» ────────────────────────────────────────
// Lo que hay que enseñar ANTES de cambiar el nivel: cuánto pasa a costar la
// misma cesta y en qué dimensiones quedaría por encima del límite. Bajar de
// nivel no rompe nada —nadie pierde datos— pero deja de poder añadir, y eso se
// dice antes y no después.
export async function simularNivel(client_id: string, nivel: string) {
  await requirePermiso('clientes')
  const supabase = await createClient()
  const destino = normalizarNivel(nivel)

  const { data: cli } = await supabase
    .from('clients')
    .select('modulos_activos, nivel, precio_mensual_usd')
    .eq('client_id', client_id)
    .maybeSingle()
  if (!cli) return { ok: false as const, error: 'Cliente no encontrado.' }

  const modulos = Array.isArray(cli.modulos_activos) ? cli.modulos_activos as string[] : []
  // El conteo va por el cliente de servicio: las tablas del tenant tienen RLS por
  // `client_id` y la sesión de un admin no las ve. Aquí ya se pasó `requirePermiso`.
  const [cuota, uso] = await Promise.all([
    calcularPrecioMensual(supabase, modulos, destino),
    usoDeLimites(createAdminClient(), client_id, destino),
  ])

  return {
    ok: true as const,
    actual:  Number(cli.precio_mensual_usd ?? 0) || 0,
    cuota,
    excedidas: uso.filter(u => u.excedido).map(u => ({
      etiqueta: u.etiqueta, usado: u.usado, limite: u.limite ?? 0,
    })),
  }
}
