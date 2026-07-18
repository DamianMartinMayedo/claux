'use server'

import { requirePermiso } from '@/lib/admin-guard'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { logActividad } from '@/lib/audit'
import { toDateStr } from '@/lib/date-utils'
import { getSetting } from '@/app/actions/settings'
import { diasCiclo, importeCiclo } from '@/lib/billing'
import { renderPlantilla } from '@/lib/email/render'
import { enviarEmail, tipoEmailActivo } from '@/lib/email/enviar'
import { notificarPagoConfirmado } from '@/lib/notificaciones/eventos'

function fmtFechaEs(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Datos por defecto para pre-rellenar el formulario de pago ────────
// Modelo base + módulos: el importe sugerido sale del precio_mensual_usd del cliente y su ciclo
// (mensual = precio; anual = precio × 12 con descuento). La duración del período la marca el ciclo.
// fecha_inicio = día siguiente a la fecha_expiracion actual (o hoy si no hay).
export async function obtenerDatosPagoDefecto(clientId: string) {
  await requirePermiso('pagos')
  const supabase = await createClient()

  const { data: cliente } = await supabase
    .from('clients')
    .select('precio_mensual_usd, ciclo_facturacion, fecha_expiracion')
    .eq('client_id', clientId)
    .single()

  if (!cliente) return { ok: false as const, error: 'Cliente no encontrado.' }

  const ciclo        = cliente.ciclo_facturacion ?? 'mensual'
  const duracionDias = diasCiclo(ciclo)
  const descuento    = parseInt(await getSetting('descuento_anual_pct', '10'), 10) || 0
  const montoSugerido = importeCiclo(Number(cliente.precio_mensual_usd ?? 0), ciclo, descuento)

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

  // Último pago de suscripción — para el cálculo pro-rata
  const { data: ultimoPago } = await supabase
    .from('payments')
    .select('monto_usd, fecha_inicio_periodo, fecha_fin_periodo')
    .eq('client_id', clientId)
    .eq('concepto', 'suscripcion')
    .not('fecha_fin_periodo', 'is', null)
    .order('fecha_fin_periodo', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    ok:                      true as const,
    monto_sugerido:          montoSugerido,
    fecha_inicio:            toDateStr(fechaBase),
    fecha_fin:               toDateStr(fechaFin),
    ciclo,
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
// - Reactiva si estaba VENCIDO, DESACTIVADO, TRIAL o GRACIA
// - Limpia campos de gracia si los había
// - Detecta gap entre expiración actual y inicio del período (advierte pero no bloquea)
// - Cambia plan si viene uno nuevo
export async function registrarPago(formData: FormData) {
  await requirePermiso('pagos')
  const supabase = await createClient()

  const client_id            = formData.get('client_id')            as string
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
    .select('client_id, estado, fecha_expiracion, nombre_empresa, email_admin')
    .eq('client_id', client_id)
    .single()
  if (!cliente) return { ok: false as const, error: 'Cliente no encontrado.' }

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

  // ── Registrar pago (suscripción) ─────────────────────────────────
  const { error: errorPago } = await supabase.from('payments').insert({
    pago_id,
    client_id,
    concepto:            'suscripcion',
    estado:              'confirmado',
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
  const estadosReactivar = ['VENCIDO', 'DESACTIVADO', 'TRIAL', 'GRACIA']
  const seReactiva = estadosReactivar.includes(cliente.estado)
  const nuevoEstado = seReactiva ? 'ACTIVO' : cliente.estado

  await supabase
    .from('clients')
    .update({
      fecha_expiracion: fecha_fin_periodo,
      estado:           nuevoEstado,
      // Limpiar campos de gracia si los tenía (igual que el original)
      fecha_fin_gracia: null,
      motivo_gracia:    null,
      notas_gracia:     null,
    })
    .eq('client_id', client_id)

  // Aviso en la campana del portal del cliente. Fuera del `if (email_admin)`:
  // un negocio sin correo puesto debe enterarse igual al entrar al portal.
  after(async () => {
    await notificarPagoConfirmado({
      clientId: client_id, montoUsd: monto_usd, fechaExpiracion: fecha_fin_periodo,
    })
  })

  // after(): envío garantizado tras la respuesta (un `void` suelto se pierde en
  // Vercel). Un fallo de Resend no debe romper el registro del pago.
  if (cliente.email_admin) {
    after(async () => {
      if (await tipoEmailActivo('confirmacion_pago')) {
        const { asunto, html } = await renderPlantilla('confirmacion_pago', {
          empresa: cliente.nombre_empresa,
          monto: monto_usd.toFixed(2),
          fecha_expiracion: fmtFechaEs(fecha_fin_periodo),
        })
        await enviarEmail({
          to: cliente.email_admin, subject: asunto, html, tipo: 'confirmacion_pago', clientId: client_id,
        })
      }
      if (seReactiva && await tipoEmailActivo('reactivacion')) {
        const reactivado = await renderPlantilla('reactivacion', { empresa: cliente.nombre_empresa })
        await enviarEmail({
          to: cliente.email_admin, subject: reactivado.asunto, html: reactivado.html, tipo: 'reactivacion', clientId: client_id,
        })
      }
    })
  }

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

// ── Confirmar pago (por_confirmar → confirmado) ──────────────────────
// Marca como cobrado un pago pendiente (p. ej. los pre-creados al dar de alta).
// Solo entonces cuenta como ingreso. No cambia fechas del cliente (la vigencia se fija
// al crear/cobrar); confirmar es el reconocimiento contable de que el dinero entró.
export async function confirmarPago(pagoId: string) {
  await requirePermiso('pagos')
  const supabase = await createClient()

  const { data: pago } = await supabase
    .from('payments')
    .select('client_id, concepto, monto_usd, estado, fecha_fin_periodo')
    .eq('pago_id', pagoId)
    .single()
  if (!pago) return { ok: false as const, error: 'Pago no encontrado.' }
  if (pago.estado === 'confirmado') return { ok: true as const, yaConfirmado: true }

  const { error } = await supabase
    .from('payments')
    .update({ estado: 'confirmado' })
    .eq('pago_id', pagoId)
  if (error) return { ok: false as const, error: error.message }

  // Si es pago de suscripción y el cliente está DESACTIVADO (pendiente del primer cobro),
  // activarlo y sincronizar fecha_expiracion con el período confirmado.
  let seReactivo = false
  if (pago.concepto === 'suscripcion' && pago.fecha_fin_periodo) {
    const { data: clienteActual } = await supabase
      .from('clients')
      .select('estado')
      .eq('client_id', pago.client_id)
      .single()
    if (clienteActual?.estado === 'DESACTIVADO') {
      seReactivo = true
      await supabase
        .from('clients')
        .update({ estado: 'ACTIVO', fecha_expiracion: pago.fecha_fin_periodo })
        .eq('client_id', pago.client_id)
    }
  }

  // after(): envío garantizado tras la respuesta (un `void` suelto se pierde en
  // Vercel). Un fallo de Resend no debe romper la confirmación del pago.
  after(async () => {
    const { data: cliente } = await supabase
      .from('clients')
      .select('nombre_empresa, email_admin, fecha_expiracion')
      .eq('client_id', pago.client_id)
      .maybeSingle()
    if (!cliente?.email_admin) return
    if (await tipoEmailActivo('confirmacion_pago')) {
      const { asunto, html } = await renderPlantilla('confirmacion_pago', {
        empresa: cliente.nombre_empresa,
        monto: Number(pago.monto_usd).toFixed(2),
        fecha_expiracion: cliente.fecha_expiracion ? fmtFechaEs(cliente.fecha_expiracion) : '—',
      })
      await enviarEmail({
        to: cliente.email_admin, subject: asunto, html, tipo: 'confirmacion_pago', clientId: pago.client_id,
      })
    }
    if (seReactivo && await tipoEmailActivo('reactivacion')) {
      const reactivado = await renderPlantilla('reactivacion', { empresa: cliente.nombre_empresa })
      await enviarEmail({
        to: cliente.email_admin, subject: reactivado.asunto, html: reactivado.html, tipo: 'reactivacion', clientId: pago.client_id,
      })
    }
  })

  const { data: { user } } = await supabase.auth.getUser()
  await logActividad(supabase, {
    user_email:  user?.email ?? 'sistema',
    entity:      'pago',
    entity_id:   pagoId,
    action:      'confirmar',
    description: `Confirmó pago ${pagoId} (${pago.concepto}) — Cliente: ${pago.client_id} — $${Number(pago.monto_usd).toFixed(2)}`,
  })

  revalidatePath('/admin/pagos')
  revalidatePath('/admin/clientes')
  revalidatePath(`/admin/clientes/${pago.client_id}`)
  revalidatePath('/admin/dashboard')
  return { ok: true as const }
}

// ── Editar pago ──────────────────────────────────────────────────────
// Suscripción: actualiza importe/método/período; si es el pago más reciente,
// sincroniza fecha_expiracion del cliente.
// Configuración (pago único): solo importe/método/notas, sin período ni expiración.
export async function editarPago(formData: FormData) {
  await requirePermiso('pagos')
  const supabase = await createClient()

  const pago_id              = formData.get('pago_id')              as string
  const monto_usd            = parseFloat(formData.get('monto_usd') as string)
  const metodo               = formData.get('metodo')               as string
  const fecha_inicio_periodo = formData.get('fecha_inicio_periodo') as string
  const fecha_fin_periodo    = formData.get('fecha_fin_periodo')    as string
  const notas                = ((formData.get('notas') as string) ?? '').trim() || null

  if (!pago_id || !metodo)
    return { ok: false as const, error: 'Campos obligatorios requeridos.' }
  if (isNaN(monto_usd) || monto_usd <= 0)
    return { ok: false as const, error: 'El monto debe ser un número positivo.' }
  if (!['tropipay', 'transferencia', 'efectivo'].includes(metodo))
    return { ok: false as const, error: 'Método de pago no válido.' }

  // Obtener el pago original (concepto decide la rama)
  const { data: pago } = await supabase
    .from('payments')
    .select('client_id, concepto')
    .eq('pago_id', pago_id)
    .single()
  if (!pago) return { ok: false as const, error: 'Pago no encontrado.' }

  const esConfiguracion = pago.concepto === 'configuracion'

  // ── Pago de configuración: sin período ni sincronización de expiración ──
  if (esConfiguracion) {
    const { error: errPago } = await supabase
      .from('payments')
      .update({ monto_usd, metodo, notas })
      .eq('pago_id', pago_id)
    if (errPago) return { ok: false as const, error: errPago.message }

    const { data: { user: upc } } = await supabase.auth.getUser()
    await logActividad(supabase, {
      user_email:  upc?.email ?? 'sistema',
      entity:      'pago',
      entity_id:   pago_id,
      action:      'editar',
      description: `Editó pago de configuración ${pago_id} — $${monto_usd}`,
    })

    revalidatePath('/admin/pagos')
    revalidatePath('/admin/clientes')
    revalidatePath(`/admin/clientes/${pago.client_id}`)
    revalidatePath('/admin/dashboard')
    return { ok: true as const, esUltimo: false }
  }

  // ── Pago de suscripción: requiere período ──
  if (!fecha_inicio_periodo || !fecha_fin_periodo)
    return { ok: false as const, error: 'El período es obligatorio.' }
  const dInicio = new Date(fecha_inicio_periodo)
  const dFin    = new Date(fecha_fin_periodo)
  if (isNaN(dInicio.getTime()) || isNaN(dFin.getTime()))
    return { ok: false as const, error: 'Las fechas del período no son válidas.' }
  if (dFin <= dInicio)
    return { ok: false as const, error: 'La fecha de fin debe ser posterior a la de inicio.' }

  // ¿Es el más reciente de este cliente?
  const { data: ultimo } = await supabase
    .from('payments')
    .select('pago_id')
    .eq('client_id', pago.client_id)
    .eq('concepto', 'suscripcion')
    .order('fecha_fin_periodo', { ascending: false })
    .limit(1)
    .single()
  const esUltimo = ultimo?.pago_id === pago_id

  const { error: errPago } = await supabase
    .from('payments')
    .update({ monto_usd, metodo, fecha_inicio_periodo, fecha_fin_periodo, notas })
    .eq('pago_id', pago_id)
  if (errPago) return { ok: false as const, error: errPago.message }

  // Si es el último pago, sincronizar fecha_expiracion
  if (esUltimo) {
    await supabase.from('clients')
      .update({ fecha_expiracion: fecha_fin_periodo })
      .eq('client_id', pago.client_id)
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
// Suscripción: solo el pago más reciente; revierte fecha_expiracion al anterior.
// Configuración (pago único): se puede eliminar siempre, sin tocar la expiración.
export async function eliminarPago(pagoId: string) {
  await requirePermiso('pagos')
  const supabase = await createClient()

  const { data: pago } = await supabase
    .from('payments')
    .select('client_id, concepto, fecha_fin_periodo')
    .eq('pago_id', pagoId)
    .single()
  if (!pago) return { ok: false as const, error: 'Pago no encontrado.' }

  const esConfiguracion = pago.concepto === 'configuracion'

  if (esConfiguracion) {
    // Pago único: borrar sin restricciones y sin tocar la suscripción
    const { error: errDel } = await supabase
      .from('payments').delete().eq('pago_id', pagoId)
    if (errDel) return { ok: false as const, error: errDel.message }

    const { data: { user: upc } } = await supabase.auth.getUser()
    await logActividad(supabase, {
      user_email:  upc?.email ?? 'sistema',
      entity:      'pago',
      entity_id:   pagoId,
      action:      'eliminar',
      description: `Eliminó pago de configuración ${pagoId} — Cliente: ${pago.client_id}`,
    })

    revalidatePath('/admin/pagos')
    revalidatePath('/admin/clientes')
    revalidatePath(`/admin/clientes/${pago.client_id}`)
    revalidatePath('/admin/dashboard')
    return { ok: true as const }
  }

  // Verificar que sea el más reciente (entre los de suscripción)
  const { data: ultimo } = await supabase
    .from('payments')
    .select('pago_id')
    .eq('client_id', pago.client_id)
    .eq('concepto', 'suscripcion')
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

  // Revertir fecha_expiracion al pago de suscripción anterior (si existe)
  const { data: anterior } = await supabase
    .from('payments')
    .select('fecha_fin_periodo')
    .eq('client_id', pago.client_id)
    .eq('concepto', 'suscripcion')
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
