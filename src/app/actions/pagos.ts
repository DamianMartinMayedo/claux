'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logActividad } from '@/lib/audit'

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

// ── Datos por defecto para pre-rellenar el formulario de pago ────────
// Lógica: fecha_inicio = día siguiente a la fecha_expiracion actual (o hoy si no hay)
// fecha_fin = fecha_inicio + plan.duracion_dias
export async function obtenerDatosPagoDefecto(clientId: string) {
  const supabase = await createClient()

  const { data: cliente } = await supabase
    .from('clients')
    .select('plan_id, fecha_expiracion')
    .eq('client_id', clientId)
    .single()

  if (!cliente) return { ok: false as const, error: 'Cliente no encontrado.' }

  const { data: plan } = await supabase
    .from('plans')
    .select('plan_id, nombre, precio_usd, duracion_dias')
    .eq('plan_id', cliente.plan_id)
    .single()

  if (!plan) return { ok: false as const, error: 'Plan no encontrado.' }

  const duracionDias = plan.duracion_dias ?? 30

  // fecha_inicio = día siguiente a la expiración actual (o hoy si no hay expiración)
  let fechaBase: Date
  if (cliente.fecha_expiracion) {
    const expDate = new Date(cliente.fecha_expiracion)
    expDate.setHours(0, 0, 0, 0)
    fechaBase = new Date(expDate)
    fechaBase.setDate(fechaBase.getDate() + 1)   // día SIGUIENTE
  } else {
    fechaBase = new Date()
    fechaBase.setHours(0, 0, 0, 0)
  }

  const fechaFin = new Date(fechaBase)
  fechaFin.setDate(fechaFin.getDate() + duracionDias)

  // Último pago — para el cálculo pro-rata en cambios de plan
  const { data: ultimoPago } = await supabase
    .from('payments')
    .select('monto_usd, fecha_inicio_periodo, fecha_fin_periodo')
    .eq('client_id', clientId)
    .order('fecha_fin_periodo', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    ok:                      true as const,
    monto_sugerido:          plan.precio_usd,
    fecha_inicio:            toDateStr(fechaBase),
    fecha_fin:               toDateStr(fechaFin),
    plan_id:                 plan.plan_id,
    plan_nombre:             plan.nombre,
    duracion_dias:           duracionDias,
    fecha_expiracion_actual: cliente.fecha_expiracion ?? null,
    ultimo_pago:             ultimoPago
      ? {
          monto_usd:    ultimoPago.monto_usd    as number,
          fecha_inicio: ultimoPago.fecha_inicio_periodo as string,
          fecha_fin:    ultimoPago.fecha_fin_periodo    as string,
        }
      : null,
  }
}

// ── Registrar pago ───────────────────────────────────────────────────
// Lógica del original:
// - Actualiza fecha_expiracion del cliente a fecha_fin_periodo
// - Reactiva si estaba VENCIDO, SUSPENDIDO, TRIAL o GRACIA
// - Limpia campos de gracia si los había
// - Detecta gap entre expiración actual y inicio del período (advierte pero no bloquea)
// - Cambia plan si viene uno nuevo
export async function registrarPago(formData: FormData) {
  const supabase = await createClient()

  const client_id            = formData.get('client_id')            as string
  const plan_id              = (formData.get('plan_id') as string)?.trim() || null
  const monto_usd            = parseFloat(formData.get('monto_usd') as string)
  const metodo               = formData.get('metodo')               as string
  const fecha_inicio_periodo = formData.get('fecha_inicio_periodo') as string
  const fecha_fin_periodo    = formData.get('fecha_fin_periodo')    as string
  const notas                = ((formData.get('notas') as string) ?? '').trim() || null

  // ── Validaciones obligatorias ────────────────────────────────────
  if (!client_id || !metodo || !fecha_inicio_periodo || !fecha_fin_periodo) {
    return { ok: false as const, error: 'Todos los campos obligatorios son requeridos.' }
  }
  if (isNaN(monto_usd) || monto_usd <= 0) {
    return { ok: false as const, error: 'El monto debe ser un número positivo.' }
  }
  if (!['tropipay', 'transferencia', 'efectivo'].includes(metodo)) {
    return { ok: false as const, error: 'Método de pago no válido. Usa: TropiPay, transferencia o efectivo.' }
  }

  // Validar que la fecha de fin sea posterior a la de inicio
  const dInicio = new Date(fecha_inicio_periodo)
  const dFin    = new Date(fecha_fin_periodo)
  if (isNaN(dInicio.getTime()) || isNaN(dFin.getTime())) {
    return { ok: false as const, error: 'Las fechas del período no son válidas.' }
  }
  if (dFin <= dInicio) {
    return { ok: false as const, error: 'La fecha de fin del período debe ser posterior a la fecha de inicio.' }
  }

  // ── Verificar cliente ────────────────────────────────────────────
  const { data: cliente } = await supabase
    .from('clients')
    .select('client_id, estado, plan_id, fecha_expiracion')
    .eq('client_id', client_id)
    .single()
  if (!cliente) return { ok: false as const, error: 'Cliente no encontrado.' }

  // ── Validar nuevo plan si se incluye ────────────────────────────
  if (plan_id && plan_id !== cliente.plan_id) {
    const { data: planNuevo } = await supabase
      .from('plans')
      .select('plan_id')
      .eq('plan_id', plan_id)
      .single()
    if (!planNuevo) {
      return { ok: false as const, error: `Plan "${plan_id}" no válido.` }
    }
  }

  // ── Detectar gap entre expiración actual y nueva fecha de inicio ─
  let advertencia_gap: string | null = null
  if (cliente.fecha_expiracion && fecha_inicio_periodo) {
    const expActual = new Date(cliente.fecha_expiracion)
    const diasGap   = Math.round((dInicio.getTime() - expActual.getTime()) / 86_400_000)
    if (diasGap > 1) {
      advertencia_gap = `Gap de ${diasGap} días sin cobertura entre ${
        expActual.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
      } y ${
        dInicio.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
      }.`
    }
  }

  // ── Generar pago_id secuencial ───────────────────────────────────
  // Buscar el último pago_id existente y generar el siguiente
  const { data: ultimoPago } = await supabase
    .from('payments')
    .select('pago_id')
    .order('pago_id', { ascending: false })
    .limit(1)
    .maybeSingle()

  let nextNum = 1
  if (ultimoPago?.pago_id) {
    const match = ultimoPago.pago_id.match(/PAG-(\d+)/)
    if (match) {
      nextNum = parseInt(match[1], 10) + 1
    }
  }
  const pago_id = `PAG-${String(nextNum).padStart(4, '0')}`

  // ── Registrar pago ───────────────────────────────────────────────
  const { error: errorPago } = await supabase.from('payments').insert({
    pago_id,
    client_id,
    plan_id:             plan_id || cliente.plan_id,
    monto_usd,
    metodo,
    fecha:               toDateStr(new Date()),
    fecha_inicio_periodo,
    fecha_fin_periodo,
    notas,
  })
  if (errorPago) return { ok: false as const, error: errorPago.message }

  // ── Actualizar cliente ───────────────────────────────────────────
  // Reactivar si estaba en cualquier estado no-activo (igual que el original)
  const estadosReactivar = ['VENCIDO', 'SUSPENDIDO', 'TRIAL', 'GRACIA']
  const nuevoEstado = estadosReactivar.includes(cliente.estado) ? 'ACTIVO' : cliente.estado

  const planFinal = plan_id || cliente.plan_id

  await supabase
    .from('clients')
    .update({
      plan_id:          planFinal,
      fecha_expiracion: fecha_fin_periodo,
      estado:           nuevoEstado,
      // Limpiar campos de gracia si los tenía (igual que el original)
      fecha_fin_gracia: null,
      motivo_gracia:    null,
      notas_gracia:     null,
    })
    .eq('client_id', client_id)

  const { data: { user: up1 } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  up1?.email ?? 'sistema',
    entity:      'pago',
    entity_id:   pago_id,
    action:      'registrar',
    description: `Registró pago ${pago_id} — Cliente: ${client_id} — $${monto_usd} (${metodo}) — hasta ${fecha_fin_periodo}`,
  })

  revalidatePath('/admin/pagos')
  revalidatePath('/admin/clientes')
  revalidatePath(`/admin/clientes/${client_id}`)
  revalidatePath('/admin/dashboard')

  return {
    ok:              true as const,
    pago_id,
    nueva_expiracion: fecha_fin_periodo,
    advertencia_gap,
  }
}

// ── Editar pago ──────────────────────────────────────────────────────
// Actualiza todos los campos del pago. Si es el más reciente del cliente
// (por fecha_fin_periodo), también sincroniza fecha_expiracion y plan_id
// del cliente.
export async function editarPago(formData: FormData) {
  const supabase = await createClient()

  const pago_id              = formData.get('pago_id')              as string
  const plan_id              = (formData.get('plan_id') as string)?.trim() || null
  const monto_usd            = parseFloat(formData.get('monto_usd') as string)
  const metodo               = formData.get('metodo')               as string
  const fecha_inicio_periodo = formData.get('fecha_inicio_periodo') as string
  const fecha_fin_periodo    = formData.get('fecha_fin_periodo')    as string
  const notas                = ((formData.get('notas') as string) ?? '').trim() || null

  if (!pago_id || !metodo || !fecha_inicio_periodo || !fecha_fin_periodo)
    return { ok: false as const, error: 'Campos obligatorios requeridos.' }
  if (isNaN(monto_usd) || monto_usd <= 0)
    return { ok: false as const, error: 'El monto debe ser un número positivo.' }
  if (!['tropipay', 'transferencia', 'efectivo'].includes(metodo))
    return { ok: false as const, error: 'Método de pago no válido.' }

  const dInicio = new Date(fecha_inicio_periodo)
  const dFin    = new Date(fecha_fin_periodo)
  if (isNaN(dInicio.getTime()) || isNaN(dFin.getTime()))
    return { ok: false as const, error: 'Las fechas del período no son válidas.' }
  if (dFin <= dInicio)
    return { ok: false as const, error: 'La fecha de fin debe ser posterior a la de inicio.' }

  // Obtener el pago original
  const { data: pago } = await supabase
    .from('payments')
    .select('client_id, plan_id')
    .eq('pago_id', pago_id)
    .single()
  if (!pago) return { ok: false as const, error: 'Pago no encontrado.' }

  // ¿Es el más reciente de este cliente?
  const { data: ultimo } = await supabase
    .from('payments')
    .select('pago_id')
    .eq('client_id', pago.client_id)
    .order('fecha_fin_periodo', { ascending: false })
    .limit(1)
    .single()
  const esUltimo = ultimo?.pago_id === pago_id

  // Actualizar el registro de pago
  const { error: errPago } = await supabase
    .from('payments')
    .update({
      plan_id:             plan_id ?? pago.plan_id,
      monto_usd,
      metodo,
      fecha_inicio_periodo,
      fecha_fin_periodo,
      notas,
    })
    .eq('pago_id', pago_id)
  if (errPago) return { ok: false as const, error: errPago.message }

  // Si es el último pago, sincronizar fecha_expiracion (y plan si cambió)
  if (esUltimo) {
    const updateCliente: Record<string, unknown> = { fecha_expiracion: fecha_fin_periodo }
    if (plan_id && plan_id !== pago.plan_id) updateCliente.plan_id = plan_id
    await supabase.from('clients').update(updateCliente).eq('client_id', pago.client_id)
  }

  const { data: { user: up2 } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  up2?.email ?? 'sistema',
    entity:      'pago',
    entity_id:   pago_id,
    action:      'editar',
    description: `Editó pago ${pago_id} — $${monto_usd} — período ${fecha_inicio_periodo} → ${fecha_fin_periodo}`,
  })

  revalidatePath('/admin/pagos')
  revalidatePath('/admin/clientes')
  revalidatePath(`/admin/clientes/${pago.client_id}`)
  revalidatePath('/admin/dashboard')

  return { ok: true as const, esUltimo }
}

// ── Eliminar pago ────────────────────────────────────────────────────
// Solo permite eliminar el pago más reciente del cliente.
// Al hacerlo revierte fecha_expiracion al período anterior (o null).
export async function eliminarPago(pagoId: string) {
  const supabase = await createClient()

  const { data: pago } = await supabase
    .from('payments')
    .select('client_id, fecha_fin_periodo')
    .eq('pago_id', pagoId)
    .single()
  if (!pago) return { ok: false as const, error: 'Pago no encontrado.' }

  // Verificar que sea el más reciente
  const { data: ultimo } = await supabase
    .from('payments')
    .select('pago_id')
    .eq('client_id', pago.client_id)
    .order('fecha_fin_periodo', { ascending: false })
    .limit(1)
    .single()

  if (ultimo?.pago_id !== pagoId) {
    return {
      ok: false as const,
      error: 'Solo se puede eliminar el último pago registrado. Para corregir uno anterior, usa la opción de editar.',
    }
  }

  // Eliminar
  const { error: errDel } = await supabase
    .from('payments').delete().eq('pago_id', pagoId)
  if (errDel) return { ok: false as const, error: errDel.message }

  // Revertir fecha_expiracion al pago anterior (si existe)
  const { data: anterior } = await supabase
    .from('payments')
    .select('fecha_fin_periodo')
    .eq('client_id', pago.client_id)
    .order('fecha_fin_periodo', { ascending: false })
    .limit(1)
    .maybeSingle()

  await supabase
    .from('clients')
    .update({ fecha_expiracion: anterior?.fecha_fin_periodo ?? null })
    .eq('client_id', pago.client_id)

  const { data: { user: up3 } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  up3?.email ?? 'sistema',
    entity:      'pago',
    entity_id:   pagoId,
    action:      'eliminar',
    description: `Eliminó pago ${pagoId} — Cliente: ${pago.client_id}`,
  })

  revalidatePath('/admin/pagos')
  revalidatePath('/admin/clientes')
  revalidatePath(`/admin/clientes/${pago.client_id}`)
  revalidatePath('/admin/dashboard')

  return { ok: true as const }
}
