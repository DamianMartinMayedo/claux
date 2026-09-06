// ── La IA que paga CLAUX (server-only) ────────────────────────────────────────
// Puerta ÚNICA de las llamadas internas: el importador del equipo, el borrador de
// una propuesta, la respuesta de soporte, el relleno de textos. Ningún consumidor
// llama a `chat()` con `interno` a mano — se pasa por aquí y ya está, porque aquí
// viven las tres cosas que se olvidan cuando cada uno se lo monta por su cuenta:
//
//   1. COMPROBAR la bolsa antes de gastar.
//   2. MEDIR después, contra el origen que corresponda.
//   3. AVISAR por la campana del admin al acercarse y al agotarse.
//
// TOPE DURO, y aquí está la diferencia con el cliente. Al cliente no se le corta a
// mitad de conversación: su tope es blando y baja al modelo gratis (`resolverModelo`).
// Esta bolsa es nuestro dinero, y un bucle nuestro que se desmande no debe poder
// gastar sin techo mientras nadie mira. Cuando se agota, se corta.
//
// Y una regla que no se re-discute (mig. 235): el coste sigue a QUIÉN CONDUCE la
// sesión. Que la llamada vaya sobre los datos de un cliente no la convierte en
// suya; si la conduce nuestro equipo desde /admin, la pagamos nosotros.

import { chat, type IaMensaje, type IaResultado } from './provider'
import type { OrigenIa } from './modelo'
import { obtenerUsoInternoMes, registrarUsoInterno, type UsoInternoMes } from './uso'
import { crearAvisoAdmin } from '@/lib/notificaciones/admin/crear'

export type { OrigenIa } from './modelo'
export type { UsoInternoMes } from './uso'

/** Se agotó la bolsa del mes. Quien llama la traduce a un mensaje del panel. */
export class IaBolsaAgotada extends Error {
  constructor(public readonly cupo: number) {
    super(`La bolsa de IA interna del mes está agotada (${cupo} conversaciones). Se puede ampliar en Configuración → IA.`)
    this.name = 'IaBolsaAgotada'
  }
}

export interface OpcionesInternas {
  mensajes: IaMensaje[]
  /** Pide salida JSON estricta. */
  json?: boolean
  temperature?: number
  maxTokens?: number
  /**
   * `false` en los turnos siguientes de una misma conversación. Por defecto true,
   * porque lo normal aquí es una tirada suelta (un borrador, una sugerencia).
   */
  nuevaConversacion?: boolean
}

const ETIQUETA_ORIGEN: Record<OrigenIa, string> = {
  importador: 'el importador',
  propuesta:  'las propuestas',
  soporte:    'soporte',
  relleno:    'el relleno de textos',
}

/**
 * Una llamada de IA a cuenta de CLAUX. Lanza `IaBolsaAgotada` si el mes ya se
 * gastó, y `IaNoConfigurada` si no hay modelo o key (igual que `chat`).
 */
export async function chatInterno(origen: OrigenIa, opts: OpcionesInternas): Promise<IaResultado> {
  const antes = await obtenerUsoInternoMes()
  if (antes.agotado) {
    await avisarBolsa(antes, true)
    throw new IaBolsaAgotada(antes.cupo)
  }

  const nueva = opts.nuevaConversacion ?? true
  const res = await chat({
    mensajes:    opts.mensajes,
    json:        opts.json,
    temperature: opts.temperature,
    maxTokens:   opts.maxTokens,
    interno:     origen,
  })

  // Se mide DESPUÉS y con lo que devolvió el proveedor: una llamada que falló no
  // se cobra a la bolsa (el `throw` de `chat` se lleva por delante esta línea).
  await registrarUsoInterno(origen, res.usage, nueva)

  // El aviso se calcula con lo que acabamos de gastar, sin volver a preguntar a la
  // base: una consulta más por cada llamada de IA no compra nada.
  if (nueva) {
    const ahora = { ...antes, conversaciones: antes.conversaciones + 1 }
    const agotado = ahora.conversaciones >= ahora.cupo
    const cerca   = ahora.conversaciones >= ahora.cupo * 0.9
    if (agotado || cerca) await avisarBolsa(ahora, agotado)
  }

  return res
}

/** Estado de la bolsa, para pintarlo en /admin/ia y para desactivar botones. */
export async function estadoBolsaInterna(): Promise<UsoInternoMes> {
  return obtenerUsoInternoMes()
}

// Un aviso por mes y escalón. La idempotencia la da la BD (tipo + entidad +
// umbral), así que esto se puede llamar en cada mensaje sin llenar la bandeja: la
// entidad es el período y el escalón distingue «se acerca» de «se agotó».
async function avisarBolsa(uso: UsoInternoMes, agotado: boolean): Promise<void> {
  const reparto = uso.porOrigen.length
    ? ` Se fue sobre todo en ${ETIQUETA_ORIGEN[uso.porOrigen[0].origen]}.`
    : ''
  await crearAvisoAdmin({
    tipo:   'ia_consumo_alto',
    umbral: agotado ? 'vencido' : null,
    titulo: agotado
      ? `Se agotó la IA interna de ${uso.periodo}`
      : `La IA interna de ${uso.periodo} va por el ${Math.round((uso.conversaciones / (uso.cupo || 1)) * 100)}%`,
    cuerpo: agotado
      ? `${uso.conversaciones} de ${uso.cupo} conversaciones. Las funciones con IA del panel quedan cortadas hasta el mes que viene o hasta ampliar el tope.${reparto}`
      : `${uso.conversaciones} de ${uso.cupo} conversaciones del mes.${reparto}`,
    enlace:      '/admin/ia',
    entidadTipo: 'ia_uso_interno',
    entidadId:   uso.periodo,
    sustituyeA:  agotado ? ['ia_consumo_alto'] : undefined,
  })
}
