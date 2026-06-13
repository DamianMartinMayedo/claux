'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logActividad } from '@/lib/audit'
import { addDays, toDateStr } from '@/lib/date-utils'
import { getSetting } from '@/app/actions/settings'
import { diasCiclo } from '@/lib/billing'

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
// Suma base + módulos/funcionalidades activos según la tarifa. Precios desde modulos_catalogo
// (nunca hardcodeados). 'base' debe venir ya incluida en modulosActivos.
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
  const supabase = await createClient()

  const nombre_empresa  = (formData.get('nombre_empresa')  as string ?? '').trim()
  const nombre_contacto = (formData.get('nombre_contacto') as string ?? '').trim()
  const email_admin     = (formData.get('email_admin')     as string ?? '').trim().toLowerCase()
  const notas           = (formData.get('notas')           as string ?? '').trim() || null
  const es_trial        = formData.get('es_trial') === 'true'
  const tarifa          = (formData.get('tarifa') as string ?? 'estandar').trim()
  const ciclo           = (formData.get('ciclo_facturacion') as string ?? 'mensual').trim()
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

  // Módulos seleccionados (base siempre incluida) y precio mensual resultante
  const modulosRaw = formData.getAll('modulos') as string[]
  const modulos_activos = modulosRaw.includes('base') ? modulosRaw : ['base', ...modulosRaw]
  const precio_mensual_usd = await calcularPrecioMensual(supabase, modulos_activos, tarifa)

  // Estado y vigencia: trial → días configurables; activo → duración del ciclo
  const estadoInicial = es_trial ? 'TRIAL' : 'ACTIVO'
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

  // Pago único de configuración (opcional, relevante a nivel contable)
  if (pago_setup_usd > 0) {
    const { data: ultimoPago } = await supabase
      .from('payments').select('pago_id').order('pago_id', { ascending: false }).limit(1).maybeSingle()
    let nextNum = 1
    if (ultimoPago?.pago_id) {
      const match = ultimoPago.pago_id.match(/PAG-(\d+)/)
      if (match) nextNum = parseInt(match[1], 10) + 1
    }
    const pago_id = `PAG-${String(nextNum).padStart(4, '0')}`
    await supabase.from('payments').insert({
      pago_id,
      client_id,
      monto_usd: pago_setup_usd,
      metodo:    'transferencia',
      concepto:  'configuracion',
      fecha:     toDateStr(hoy),
      notas:     'Pago único de configuración inicial',
    })
    await logActividad(supabase, {
      user_email:  user?.email ?? 'sistema',
      entity:      'pago',
      entity_id:   pago_id,
      action:      'registrar',
      description: `Registró pago de configuración ${pago_id} — Cliente: ${client_id} — $${pago_setup_usd.toFixed(2)}`,
    })
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

  revalidatePath('/admin/clientes')
  revalidatePath('/admin/dashboard')
  revalidatePath('/admin/pagos')
  return { ok: true, client_id, passwordTemporal }
}

// ── Cambiar estado (ACTIVO ↔ SUSPENDIDO) ────────────────────────────
export async function cambiarEstadoCliente(formData: FormData) {
  const supabase = await createClient()

  const client_id    = formData.get('client_id') as string
  const nuevo_estado = formData.get('estado')    as string

  if (!client_id || !['ACTIVO', 'SUSPENDIDO'].includes(nuevo_estado)) {
    return { ok: false, error: 'Datos inválidos.' }
  }

  // Leer fecha_expiracion actual para generar advertencia al reactivar
  const { data: clienteActual } = await supabase
    .from('clients')
    .select('fecha_expiracion')
    .eq('client_id', client_id)
    .single()

  const { error } = await supabase
    .from('clients')
    .update({ estado: nuevo_estado })
    .eq('client_id', client_id)

  if (error) return { ok: false, error: error.message }

  // Advertencia: reactivado pero la fecha de expiración ya venció
  let advertencia: string | null = null
  if (nuevo_estado === 'ACTIVO' && clienteActual?.fecha_expiracion) {
    const exp = new Date(clienteActual.fecha_expiracion)
    if (exp < new Date()) {
      advertencia = 'El cliente fue reactivado pero su fecha de expiración ya venció. Registra un pago para renovarla.'
    }
  }

  const { data: { user: u3 } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  u3?.email ?? 'sistema',
    entity:      'cliente',
    entity_id:   client_id,
    action:      'cambiar_estado',
    description: `Cambió estado del cliente ${client_id} a ${nuevo_estado}`,
  })

  revalidatePath('/admin/clientes')
  revalidatePath(`/admin/clientes/${client_id}`)
  revalidatePath('/admin/dashboard')
  return { ok: true as const, advertencia }
}

// ── Aplicar período especial (GRACIA) ────────────────────────────────
export async function aplicarGracia(formData: FormData) {
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
  const supabase = await createClient()

  const client_id = (formData.get('client_id') as string ?? '').trim()
  const tarifa    = (formData.get('tarifa')    as string ?? 'estandar').trim()
  const ciclo     = (formData.get('ciclo_facturacion') as string ?? 'mensual').trim()

  if (!client_id) return { ok: false, error: 'client_id requerido.' }
  if (!['fundador', 'estandar'].includes(tarifa)) return { ok: false, error: 'Tarifa inválida.' }
  if (!['mensual', 'anual'].includes(ciclo))      return { ok: false, error: 'Ciclo de facturación inválido.' }

  // Los módulos activos vienen como checkboxes: múltiples values con name="modulos"
  const modulosRaw = formData.getAll('modulos') as string[]
  // 'base' siempre activo — garantizarlo aquí
  const modulos_activos = modulosRaw.includes('base') ? modulosRaw : ['base', ...modulosRaw]

  // precio = base + Σ módulos activos según tarifa (siempre desde el catálogo)
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
