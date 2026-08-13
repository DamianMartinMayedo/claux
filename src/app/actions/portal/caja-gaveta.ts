'use server'

// ── La bandeja: clasificar lo que salió de la gaveta del TPV ─────────────────
//
// Cierra la mitad pendiente de la Fase 5 del clasificador
// (docs/planes/clasificador-cuentas-feedback.md). El porqué del diseño —y por qué
// NO se tipó la operación en el móvil, que es lo que pedía el §10.4— está en la
// cabecera de la mig. 193.
//
// Resumen: el dependiente saca dinero y escribe un motivo libre; la ingesta postea
// el EGRESO en Tesorería y nada más. Aquí el DUEÑO contesta después la misma
// pregunta que el movimiento manual de Tesorería —«¿en qué se fue este dinero?»—
// sobre esos movimientos ya hechos, y esa respuesta es la que crea el gasto.
//
// Tres invariantes que no se pueden perder de vista al tocar esto:
//
//  1. **La fila nace pagada**, vía `naturaleza='COSTE'`. El efectivo ya salió del
//     cajón. Ver `NATURALEZA_GAVETA` en `lib/gastos-core`.
//  2. **La fecha es la del movimiento, no la de hoy.** El dueño clasifica una vez
//     por semana; con la fecha de la clasificación, siete días de pagos caerían
//     todos en el día de la limpieza y el P&L del mes saldría mal.
//  3. **`SOLO_MUEVE` no escribe nada, pero SE GUARDA.** Es una respuesta, no una
//     omisión: sin guardarla, el traslado al banco volvería a la bandeja para
//     siempre y el aviso no se apagaría nunca.

import { revalidatePath }    from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalSession, puedeEditarModulo } from './auth'
import { obtenerEmpresas }   from './empresas'
import { revalidarFinanzas } from './_finanzas-revalidar'
import {
  etiquetaDeCategoria, generarRegistroId,
  ORIGEN_CAJA_SALIDA, ORIGEN_CAJA_ENTRADA, NATURALEZA_GAVETA,
} from '@/lib/gastos-core'
import {
  listarGavetaPendiente, resumenGavetaPendiente, resumenDeLista, RESUMEN_GAVETA_VACIO,
  type GavetaPendiente, type ResumenGaveta,
} from '@/lib/caja/pendientes'
import { fechaEnTz } from '@/lib/fecha-tz'
import type { CategoriaGasto } from './gastos'

export interface DatosGaveta {
  pendientes: GavetaPendiente[]
  /** El mismo número que enseña el aviso. Sale de la misma lista, no de otra consulta. */
  resumen:    ResumenGaveta
  /** `false` si el usuario es de solo lectura o no tiene el módulo: la bandeja se ve, no se toca. */
  puedeEditar: boolean
}

export async function obtenerGavetaPendiente(): Promise<DatosGaveta> {
  const session = await getPortalSession()
  if (!session) return { pendientes: [], resumen: RESUMEN_GAVETA_VACIO, puedeEditar: false }

  const db = createAdminClient()
  const empresas = await obtenerEmpresas()
  const pendientes = await listarGavetaPendiente(
    db, session.client_id, empresas.map(e => e.empresa_id))

  return {
    pendientes,
    resumen:     resumenDeLista(pendientes),
    puedeEditar: !session.solo_lectura && await puedeEditarModulo('base'),
  }
}

/**
 * La bandeja entera, **pedida al pulsar el aviso** desde cualquier pantalla.
 *
 * El aviso sale en cinco sitios y la bandeja se abre en el sitio donde estés (ver
 * `GavetaLanzador`): mandar al dueño a Tesorería para que allí vuelva a pulsar era
 * un viaje de más, y en Cuba un viaje de más es medio minuto mirando una pantalla
 * en blanco. Lo que NO se hace es traerse esto en el render de las cinco pantallas:
 * el 90% de las veces no se pulsa, y entonces son cinco consultas regaladas. Se
 * paga solo cuando se usa.
 */
export async function abrirBandejaGaveta(): Promise<DatosGaveta & { categorias: CategoriaGasto[] }> {
  const datos = await obtenerGavetaPendiente()
  const session = await getPortalSession()
  if (!session) return { ...datos, categorias: [] }

  const { data } = await createAdminClient()
    .from('categorias_gastos').select('*')
    .eq('client_id', session.client_id)
    .eq('estado', 'ACTIVO')
    .order('nombre')

  return { ...datos, categorias: (data ?? []) as CategoriaGasto[] }
}

/**
 * Solo el resumen, para el render de las pantallas que únicamente pintan el aviso
 * (Gastos, el estado de resultados, el editor del dossier, las operaciones del
 * TPV). El detalle —el motivo que escribió quien atendió— solo cruza la red si el
 * dueño abre la bandeja, y entonces lo trae `abrirBandejaGaveta`.
 */
export async function resumenGavetaPortal(): Promise<ResumenGaveta> {
  const session = await getPortalSession()
  if (!session) return RESUMEN_GAVETA_VACIO

  const empresas = await obtenerEmpresas()
  return resumenGavetaPendiente(
    createAdminClient(), session.client_id, empresas.map(e => e.empresa_id))
}

/** Una respuesta del dueño sobre un movimiento concreto. */
export interface DecisionGaveta {
  movimiento_uuid: string
  /** GASTO exige `categoria_id`; SOLO_MUEVE lo ignora. */
  decision:        'GASTO' | 'SOLO_MUEVE'
  categoria_id?:   string | null
}

export interface ResultadoGaveta {
  ok: boolean
  error?:     string
  /** Clasificados de verdad. */
  hechos?:    number
  /** Los que ya no estaban pendientes al llegar aquí (otra pestaña se adelantó). */
  omitidos?:  number
}

/**
 * Aplica las decisiones. **En lote**, porque una semana de una cafetería con
 * movimiento son treinta filas y de una en una no se hace nunca.
 *
 * No es una transacción: cada movimiento es independiente y a medio camino no deja
 * nada inconsistente —lo que se clasificó, está; lo que no, sigue en la bandeja—.
 * Lo que sí protege es el índice único de la mig. 193: dos pestañas abiertas con la
 * misma lista no pueden crear el gasto dos veces.
 */
export async function clasificarGaveta(decisiones: DecisionGaveta[]): Promise<ResultadoGaveta> {
  const session = await getPortalSession()
  if (!session)             return { ok: false, error: 'Sesión inválida.' }
  if (session.solo_lectura) return { ok: false, error: 'Tu cuenta es de solo lectura.' }
  if (!(await puedeEditarModulo('base'))) {
    return { ok: false, error: 'No tienes permiso para editar en este módulo.' }
  }
  if (!decisiones.length) return { ok: false, error: 'No has clasificado ninguna operación.' }

  const db = createAdminClient()
  const empresas = await obtenerEmpresas()

  // Se relee la bandeja en vez de fiarse de lo que manda el cliente: entre que se
  // pintó la lista y se pulsó el botón cabe la otra pestaña, y cabe que la ingesta
  // haya cambiado algo. El importe y la fecha salen SIEMPRE de aquí, nunca del
  // formulario — son datos del dispositivo, no del dueño.
  const pendientes = await listarGavetaPendiente(
    db, session.client_id, empresas.map(e => e.empresa_id))
  const porUuid = new Map(pendientes.map(p => [p.movimiento_uuid, p]))

  const ahora = new Date().toISOString()
  const quien = session.email ?? null
  let hechos = 0, omitidos = 0

  for (const d of decisiones) {
    const mov = porUuid.get(d.movimiento_uuid)
    if (!mov) { omitidos++; continue }

    if (d.decision === 'GASTO') {
      if (!d.categoria_id) {
        return { ok: false, error: 'Falta la categoría de alguna operación marcada como gasto.' }
      }
      const etq = await etiquetaDeCategoria(db, session.client_id, d.categoria_id)
      if (!etq) return { ok: false, error: 'Categoría no válida o inactiva.' }

      // SALIDA → GASTO, ENTRADA → COBRO. La dirección la fija el dispositivo, no
      // el dueño: lo que él decide es el CONCEPTO, no si el dinero entró o salió.
      const esSalida = mov.tipo === 'SALIDA'
      const tipo     = esSalida ? 'GASTO' : 'COBRO'
      // El motivo de quien atendió es lo que identifica la fila en la tabla. Sin él
      // treinta salidas del mismo mes son la misma línea repetida (mig. 152).
      const concepto = mov.motivo?.trim()
        || `${esSalida ? 'Salida' : 'Entrada'} de caja · ${mov.caja_nombre}`

      const { error } = await db.from('gastos_cobros').insert({
        registro_id:  generarRegistroId(tipo),
        client_id:    session.client_id,
        empresa_id:   mov.empresa_id,
        tipo,
        // Invariante 2, y en el día del NEGOCIO: `substring(0,10)` daría el día UTC
        // y una salida de las 21:00 en Cuba caería en el mes siguiente cada 31.
        fecha:        fechaEnTz(mov.fecha),
        vencimiento:  null,
        tercero_id:   null,
        categoria:    etq.nombre,
        categoria_id: etq.categoria_id,
        // En un GASTO la etiqueta es «Categoría · Subcategoría» (de ella vive el
        // informe); en un COBRO la etiqueta es el concepto. Mismo criterio que el
        // alta manual de Gastos.
        descripcion:  esSalida ? etq.descripcion : concepto,
        concepto,
        moneda:       mov.moneda,
        monto:        mov.importe,
        naturaleza:   NATURALEZA_GAVETA,           // invariante 1: nace pagada
        origen_tipo:  esSalida ? ORIGEN_CAJA_SALIDA : ORIGEN_CAJA_ENTRADA,
        origen_id:    mov.movimiento_uuid,
        notas:        `Operación de la gaveta de ${mov.caja_nombre}, clasificada desde la bandeja.`,
        updated_at:   ahora,
      })
      // 23505 = el índice único de la mig. 193: otra pestaña llegó primero. No es un
      // error del dueño, es la carrera que el índice está ahí para perder con gracia.
      if (error && (error as { code?: string }).code !== '23505') {
        return { ok: false, error: error.message }
      }
      if (error) { omitidos++; continue }
    }

    const { error: eMarca } = await db.from('caja_turno_movimientos')
      .update({ clasificacion: d.decision, clasificado_at: ahora, clasificado_por: quien })
      .eq('client_id', session.client_id)
      .eq('movimiento_uuid', d.movimiento_uuid)
      .is('clasificacion', null)
    if (eMarca) return { ok: false, error: eMarca.message }
    hechos++
  }

  revalidatePath('/portal/tesoreria')
  revalidatePath('/portal/gastos')
  revalidatePath('/portal/caja')
  revalidarFinanzas()
  return { ok: true, hechos, omitidos }
}
