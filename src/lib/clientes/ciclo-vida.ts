// Ciclo de vida del cliente: reglas PURAS, sin BD.
//
// Vive aparte de `vencimientos.ts` —que sí toca la BD— porque de aquí tira
// también un componente cliente (el botón de retirar el período especial de la
// ficha), y arrastrar `createAdminClient` al bundle del navegador por reusar dos
// funciones de tres líneas no sale a cuenta. Aquí solo entra lógica que se puede
// contestar con los datos de una fila delante.

import { esSocioHoy } from '@/lib/billing'

/** Columnas mínimas para decidir la exención. Cópialas tal cual quien use `desactivable`. */
export const COLUMNAS_EXENCION = 'es_prueba, es_socio, socio_hasta'

/** Columnas que pide `accesoBloqueado`, que mira además las dos fechas. */
export const COLUMNAS_ACCESO =
  'estado, fecha_expiracion, fecha_fin_gracia, es_prueba, es_socio, socio_hasta'

/** Lo que hace falta saber de un cliente para decidir su ciclo de vida. */
export type FilaCicloVida = {
  estado?:           string | null
  es_prueba?:        boolean | null
  es_socio?:         boolean | null
  socio_hasta?:      string | null
  fecha_expiracion?: string | null
  fecha_fin_gracia?: string | null
}

/**
 * ¿Se le puede escribir DESACTIVADO? No, si es de prueba o socio vigente.
 *
 * Lo comparten los DOS barridos (el del cron y el del admin) para que la regla no
 * acabe con dos redacciones. Y tiene que estar de acuerdo con el guardia del
 * portal: si aquí se escribe DESACTIVADO, allí se bloquea por estado y el escudo
 * de allí deja de servir.
 */
export function desactivable(c: FilaCicloVida): boolean {
  return !c.es_prueba && !esSocioHoy(c)
}

/**
 * ¿Es un socio vigente al que alguien dejó escrito DESACTIVADO/VENCIDO?
 *
 * Es una contradicción, no un estado: le hemos dicho que no pague y le hemos
 * cerrado la puerta por no pagar. Nace sola cuando un barrido escribe antes de
 * que la exención exista —justo lo que pasó con DEUS el 2026-08-28: producción
 * corría todavía el código sin exención, lo suspendió, y el portal (que bloquea
 * por ESTADO) lo dejó fuera aunque su bandera de socio estuviera puesta.
 *
 * Se resuelve a favor del acceso, y a propósito: para cortarle a un socio se le
 * quita la bandera o se le deja caducar, que es la decisión que sí dice lo que
 * quiere decir. El de PRUEBA no entra aquí: su sitio es TRIAL, no ACTIVO.
 */
export function socioMalSuspendido(c: FilaCicloVida, hoy?: string): boolean {
  if (c.es_prueba) return false
  if (!esSocioHoy(c, hoy)) return false
  return c.estado === 'DESACTIVADO' || c.estado === 'VENCIDO'
}

/**
 * Estado en el que queda un cliente al RETIRARLE el período especial.
 *
 * El período de gracia no guarda de dónde venía el cliente, así que no se puede
 * «deshacer»: hay que volver a deducir dónde le toca estar. Y lo que le toca
 * depende de qué lo sostenga cuando la gracia ya no esté:
 *
 *   · de prueba      → TRIAL, que es su estado de por vida.
 *   · socio vigente  → ACTIVO. No paga, pero tiene acceso por otra vía.
 *   · aún dentro de su fecha pagada → ACTIVO.
 *   · sin fecha de expiración → ACTIVO. «No tiene fecha» no es «ha vencido»: el
 *     guardia del portal nunca cierra por una fecha que no existe y el barrido de
 *     expiración tampoco lo alcanza (`.lt(fecha_expiracion, hoy)` no casa un NULL).
 *     Devolver DESACTIVADO aquí era la única voz que decía lo contrario.
 *   · nada de lo anterior → DESACTIVADO. La gracia era lo único que lo sostenía,
 *     y retirarla lo deja fuera HOY. Por eso el botón que llama a esto tiene que
 *     decirlo antes, con esa palabra, y no después.
 */
export function estadoAlRetirarGracia(c: FilaCicloVida, hoy: string): string {
  if (c.es_prueba) return 'TRIAL'
  if (esSocioHoy(c, hoy)) return 'ACTIVO'
  const exp = c.fecha_expiracion?.split('T')[0]
  if (!exp) return 'ACTIVO'
  return exp >= hoy ? 'ACTIVO' : 'DESACTIVADO'
}

/** Por qué se le cierra la puerta. Lo lee `BloqueadoScreen` para elegir el texto. */
export type MotivoBloqueo = 'DESACTIVADO' | 'VENCIDO' | 'EXPIRADO'

/**
 * ¿Se le cierra el portal, y por qué?
 *
 * Vive AQUÍ, al lado de `desactivable`, y no suelto en el layout del portal, que
 * es donde estuvo hasta ahora. Son las dos caras de la misma regla —quién entra y
 * a quién se le puede escribir DESACTIVADO— y separadas ya se desincronizaron una
 * vez: el barrido escribía el estado, el guardia lo leía, y ganaba el que escribía.
 * Juntas, una discrepancia se ve en la misma pantalla.
 *
 * El orden de las excusas para entrar:
 *   1. socio vigente  → entra. Le hemos dicho que no pague; su reloj es `socio_hasta`.
 *   2. gracia vigente → entra, aunque su fecha pagada haya quedado atrás.
 *   3. de prueba      → entra. No vence nunca por fecha; es un entorno interno.
 *   4. si no, manda `estado`, y después `fecha_expiracion`.
 */
export function accesoBloqueado(
  c: FilaCicloVida,
  hoy: string,
): { bloqueado: boolean; motivo: MotivoBloqueo } {
  const motivo: MotivoBloqueo =
    c.estado === 'DESACTIVADO' ? 'DESACTIVADO' :
    c.estado === 'VENCIDO'     ? 'VENCIDO'     :
                                 'EXPIRADO'

  // El socio entra pase lo que pase mientras su condición esté viva, incluso con
  // un DESACTIVADO heredado escrito encima: «socio» y «suspendido» no pueden ser
  // verdad a la vez, y esa contradicción la escribió una máquina, no una persona.
  //
  // Salvo sobre un cliente de PRUEBA, donde la bandera no manda: ahí es un dato
  // sin sentido (la condición de socio es comercial y un entorno de prueba no
  // factura) y el resto del sistema ya la ignora —`desactivable`,
  // `socioMalSuspendido` y el escáner de socios del admin filtran `es_prueba`
  // antes que nada—. Sin esta salvedad, un DESACTIVADO sobre un cliente de prueba
  // con la bandera puesta lo dejaba entrar por aquí y suspendido en la ficha.
  if (!c.es_prueba && esSocioHoy(c, hoy)) return { bloqueado: false, motivo }

  const enGraciaActiva =
    c.estado === 'GRACIA' &&
    !!c.fecha_fin_gracia &&
    c.fecha_fin_gracia.split('T')[0] >= hoy

  if (c.estado === 'DESACTIVADO' || c.estado === 'VENCIDO') {
    return { bloqueado: true, motivo }
  }

  // El de PRUEBA no vence por fecha (pero un DESACTIVADO explícito sí lo para:
  // esa decisión la toma una persona y va arriba). `es_prueba` se marca a menudo
  // sobre un cliente que YA tenía fecha guardada —así nació CLI-0003—, así que
  // mirar solo la fecha lo cerraría el día que llegara, sin que nadie recordara
  // por qué.
  const expiradoPorFecha =
    !c.es_prueba &&
    !!c.fecha_expiracion &&
    c.fecha_expiracion.split('T')[0] < hoy

  return { bloqueado: expiradoPorFecha && !enGraciaActiva, motivo }
}
