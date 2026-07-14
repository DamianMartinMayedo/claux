'use server'

import { requirePermiso } from '@/lib/admin-guard'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { logActividad } from '@/lib/audit'
import { addDays, toDateStr } from '@/lib/date-utils'
import { getSetting } from '@/app/actions/settings'
import { diasCiclo, importeCiclo } from '@/lib/billing'
import { renderPlantilla } from '@/lib/email/render'
import { enviarEmail, enviarAvisoInterno, tipoEmailActivo } from '@/lib/email/enviar'

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


// ── Helper: precio mensual a partir de los módulos activos ───────────
// Suma los módulos/funcionalidades activos según la tarifa. Precios desde modulos_catalogo
// (nunca hardcodeados). Todos los módulos son opcionales, incluida la contabilidad ('base').
async function calcularPrecioMensual(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  modulosActivos: string[],
  tarifa: string,
): Promise<number> {
  const { data: catalogo } = await supabase
    .from('modulos_catalogo')
    .select('clave, precio_fundador_usd, precio_estandar_usd, activo')
    .eq('activo', true)
  const campo = tarifa === 'fundador' ? 'precio_fundador_usd' : 'precio_estandar_usd'
  return (catalogo ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((m: any) => modulosActivos.includes(m.clave))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .reduce((sum: number, m: any) => sum + Number(m[campo] ?? 0), 0)
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
  const tarifa          = (formData.get('tarifa') as string ?? 'estandar').trim()
  const ciclo           = (formData.get('ciclo_facturacion') as string ?? 'mensual').trim()
  const sector          = (formData.get('sector') as string ?? '').trim() || null
  const pagoSetupRaw    = parseFloat(formData.get('pago_setup_usd') as string ?? '0')
  const pago_setup_usd  = isNaN(pagoSetupRaw) ? 0 : pagoSetupRaw

  if (!nombre_empresa || !email_admin) {
    return { ok: false, error: 'Nombre de empresa y email son obligatorios.' }
  }
  if (!['fundador', 'estandar'].includes(tarifa)) return { ok: false, error: 'Tarifa inválida.' }
  if (!['mensual', 'anual'].includes(ciclo))      return { ok: false, error: 'Ciclo de facturación inválido.' }

  // Verificar email único
  const { data: emailExiste } = await supabase
    .from('clients')
    .select('client_id')
    .eq('email_admin', email_admin)
    .maybeSingle()
  if (emailExiste) return { ok: false, error: 'Ya existe un cliente con ese email.' }

  // Módulos seleccionados (la contabilidad 'base' es opcional, como cualquier
  // módulo) y precio mensual resultante.
  const modulos_activos = formData.getAll('modulos') as string[]
  const precio_mensual_usd = await calcularPrecioMensual(supabase, modulos_activos, tarifa)

  // Estado y vigencia: trial → TRIAL por días configurables; sin trial → DESACTIVADO hasta que
  // se confirme el primer pago de suscripción (confirmarPago lo pasa a ACTIVO).
  const estadoInicial = es_trial ? 'TRIAL' : 'DESACTIVADO'
  const diasVigencia  = es_trial
    ? (parseInt(await getSetting('dias_trial_default', '15'), 10) || 15)
    : diasCiclo(ciclo)

  // Generar client_id secuencial
  const { count } = await supabase.from('clients').select('*', { count: 'exact', head: true })
  const client_id = `CLI-${String((count ?? 0) + 1).padStart(4, '0')}`

  const hoy = new Date()
  const fechaExpiracion = addDays(hoy, diasVigencia)

  const { error: errorCliente } = await supabase.from('clients').insert({
    client_id,
    nombre_empresa,
    nombre_contacto: nombre_contacto || null,
    email_admin,
    sector,
    modulos_activos,
    tarifa,
    ciclo_facturacion: ciclo,
    precio_mensual_usd,
    fecha_inicio:     toDateStr(hoy),
    fecha_expiracion: toDateStr(fechaExpiracion),
    estado:           estadoInicial,
    notas,
  })

  if (errorCliente) return { ok: false, error: errorCliente.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'cliente',
    entity_id:   client_id,
    action:      'crear',
    description: `Creó cliente ${nombre_empresa} (${client_id}) — ${modulos_activos.length} módulo(s) · tarifa ${tarifa}/${ciclo} · $${precio_mensual_usd.toFixed(2)}/mes — Estado: ${estadoInicial}`,
  })

  // ── Pre-crear los cobros esperados como "por confirmar" ──────────────
  // Configuración (pago único, si > 0) + primera suscripción (si no es trial).
  // Se confirman cuando el cliente paga de verdad; solo entonces cuentan como ingreso.
  const descuentoAnual   = parseInt(await getSetting('descuento_anual_pct', '10'), 10) || 0
  const montoSuscripcion = es_trial ? 0 : importeCiclo(precio_mensual_usd, ciclo, descuentoAnual)

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
  if (pago_setup_usd > 0) {
    pagosPre.push({
      pago_id:  nuevoPagoId(),
      client_id,
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
    email:               email_admin,
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
      usuario: email_admin,
      password_temporal: passwordTemporal,
      link_portal: LINK_PORTAL,
    })
    await enviarEmail({
      to: email_admin,
      subject: asunto,
      html,
      tipo: 'bienvenida',
      clientId: client_id,
    })
  })

  after(() => enviarAvisoInterno({
    tipo: 'aviso_cliente',
    asunto: `Nuevo cliente creado: ${nombre_empresa}`,
    cuerpo: `Se creó el cliente ${nombre_empresa} (${client_id}).\n\nContacto: ${nombre_contacto || '—'}\nEmail: ${email_admin}\nTarifa: ${tarifa}/${ciclo}\nMódulos: ${modulos_activos.join(', ') || '—'}\nEstado inicial: ${estadoInicial}`,
    clientId: client_id,
  }))

  // Si el alta viene de un presupuesto aprobado, enlazamos el cliente creado al
  // presupuesto (cierra el embudo ventas → cliente y evita duplicar el alta).
  const presupuestoId = parseInt((formData.get('presupuesto_id') as string ?? '').trim(), 10)
  if (Number.isFinite(presupuestoId) && presupuestoId > 0) {
    await supabase
      .from('presupuestos_instalacion')
      .update({ client_id })
      .eq('id', presupuestoId)
    revalidatePath('/admin/presupuestos')
  }

  revalidatePath('/admin/clientes')
  revalidatePath('/admin/dashboard')
  revalidatePath('/admin/pagos')
  return { ok: true, client_id, passwordTemporal, estado: estadoInicial }
}

// ── Regenerar contraseña de un usuario del cliente ───────────────────
// Las contraseñas son hash de una vía (no se recuperan), pero SÍ se regeneran.
// Resuelve el huevo-y-la-gallina: si el admin principal del tenant pierde su
// clave, aquí (panel admin) se le genera una temporal. must_change_password:true
// → el cliente definirá su propia contraseña en el primer acceso.
// Reutilizable como base de un futuro auto-servicio por email (no construido aún).
export async function regenerarPasswordCliente(
  user_id: string,
  client_id: string,
): Promise<{ ok: boolean; passwordTemporal?: string; error?: string }> {
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

  // after(): garantiza el envío tras la respuesta (un `void` suelto se pierde en
  // Vercel). Un fallo de Resend no debe romper la regeneración.
  after(async () => {
    if (!(await tipoEmailActivo('password_reset'))) return
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
    await enviarEmail({
      to: usuario.email,
      subject: asunto,
      html,
      tipo: 'password_reset',
      clientId: client_id,
    })
  })

  revalidatePath(`/admin/clientes/${client_id}`)
  return { ok: true, passwordTemporal }
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
    .from('clients').select('nombre_empresa, estado').eq('client_id', client_id).maybeSingle()
  if (!cliente) return { ok: false, error: 'Cliente no encontrado.' }

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

  const fechaGracia = addDays(new Date(), dias)

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
  const tarifa    = (formData.get('tarifa')    as string ?? 'estandar').trim()
  const ciclo     = (formData.get('ciclo_facturacion') as string ?? 'mensual').trim()

  if (!client_id) return { ok: false, error: 'client_id requerido.' }
  if (!['fundador', 'estandar'].includes(tarifa)) return { ok: false, error: 'Tarifa inválida.' }
  if (!['mensual', 'anual'].includes(ciclo))      return { ok: false, error: 'Ciclo de facturación inválido.' }

  // Los módulos activos vienen como checkboxes: múltiples values con name="modulos".
  // La contabilidad 'base' es opcional, como cualquier módulo (no se fuerza).
  const modulos_activos = formData.getAll('modulos') as string[]

  // precio = Σ módulos activos según tarifa (siempre desde el catálogo)
  const precio_mensual_usd = await calcularPrecioMensual(supabase, modulos_activos, tarifa)

  const { error } = await supabase
    .from('clients')
    .update({ modulos_activos, tarifa, ciclo_facturacion: ciclo, precio_mensual_usd })
    .eq('client_id', client_id)

  if (error) return { ok: false, error: error.message }

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'cliente',
    entity_id:   client_id,
    action:      'modulos',
    description: `Actualizó módulos del cliente ${client_id} — tarifa ${tarifa}/${ciclo} · $${precio_mensual_usd.toFixed(2)}/mes — módulos: [${modulos_activos.join(', ')}]`,
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

  const { error } = await supabase
    .from('clients')
    .update({ nombre_empresa, nombre_contacto, email_admin, notas })
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
  const hoy = toDateStr(new Date())

  // 1. Clientes con GRACIA vencida → DESACTIVADO
  const { data: graciaVencidos, error: errGracia } = await supabase
    .from('clients')
    .select('client_id, nombre_empresa')
    .eq('estado', 'GRACIA')
    .lt('fecha_fin_gracia', hoy)

  if (!errGracia && graciaVencidos && graciaVencidos.length > 0) {
    const clientIds = graciaVencidos.map(c => c.client_id)
    await supabase
      .from('clients')
      .update({
        estado:           'DESACTIVADO',
        fecha_fin_gracia: null,
        motivo_gracia:    null,
        notas_gracia:     null,
      })
      .in('client_id', clientIds)

    // Log de auditoría
    const { data: { user } } = await supabase.auth.getUser()
    for (const c of graciaVencidos) {
      await logActividad(supabase, {
        user_email:  user?.email ?? 'sistema',
        entity:      'cliente',
        entity_id:   c.client_id,
        action:      'suspender',
        description: `Desactivó automáticamente al cliente ${c.client_id} (${c.nombre_empresa}) — período de gracia vencido`,
      })
    }
  }

  // 2. Clientes con ACTIVO/TRIAL y fecha_expiracion < hoy → DESACTIVADO
  const { data: expVencidos, error: errExp } = await supabase
    .from('clients')
    .select('client_id, nombre_empresa')
    .in('estado', ['ACTIVO', 'TRIAL'])
    .lt('fecha_expiracion', hoy)

  if (!errExp && expVencidos && expVencidos.length > 0) {
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

  const totalSuspendidos = (graciaVencidos?.length ?? 0) + (expVencidos?.length ?? 0)

  // Revalidar paths si hubo cambios
  if (totalSuspendidos > 0) {
    revalidatePath('/admin/clientes')
    revalidatePath('/admin/dashboard')
  }

  return { ok: true, suspendidos: totalSuspendidos }
}
