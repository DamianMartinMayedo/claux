// ────────────────────────────────────────────────────────────────────────────
// SALDO DE CADA CUENTA A UNA FECHA — envoltorio de `tes_saldos_a_fecha` (mig. 243).
//
// ── QUÉ RESUELVE ──────────────────────────────────────────────────────────────
// El saldo de una cuenta nunca se persistió: siempre fue derivado
// (`saldo_inicial + Σ INGRESO − Σ EGRESO`), y eso es justo lo que lo hace
// consultable a CUALQUIER fecha. Antes se sumaba arriba, en JavaScript, subiendo
// por la API todos los movimientos de la historia para dar tres números por cuenta:
// 1.410 filas en CLI-0008 para pintar unas tarjetas. Ahora suma Postgres y baja una
// fila por cuenta — que además es lo que Cuba necesita.
//
// ── POR QUÉ LANZA SI FALLA ────────────────────────────────────────────────────
// Devolver un mapa vacío dejaría a cada cuenta en su `saldo_inicial`: un número
// creíble y falso, que el dueño lee como un hecho. Mismo criterio que `traerTodas`
// (`lib/supabase/paginar.ts`): si la cuenta no se puede hacer, tiene que verse.
//
// ── LO QUE LA FUNCIÓN YA DECIDE, Y AQUÍ NO SE REPITE ──────────────────────────
// · Las cuentas de «Apertura» (mig. 130) quedan fuera: no son dinero real.
// · Las archivadas SE DEVUELVEN —a una fecha pasada pudieron tener saldo—; quién
//   entra en el total lo decide la pantalla, que es la que sabe si las enseña.
//
// Sin 'use server': utilidad de servidor que usan las server actions.
// ────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** La fila de una cuenta, que se lee entera: parto de X, entró esto, salió esto, quedo en Y. */
export interface SaldoCuenta {
  /** Saldo al día ANTERIOR a `desde`. Sin `desde`, el `saldo_inicial` de la cuenta. */
  saldo_previo:  number
  /** Σ INGRESO dentro de [desde, hasta]. */
  ingresos:      number
  /** Σ EGRESO dentro de [desde, hasta]. */
  egresos:       number
  /** Cuántos movimientos hay en [desde, hasta]. */
  movimientos:   number
  /**
   * Saldo a `hasta` (o de hoy si no hay `hasta`). Acota SOLO el extremo superior:
   * acotar los dos daría `saldo_inicial + los movimientos de la ventana`, ni el saldo
   * de hoy ni el del día pedido — un número que no existe.
   *
   * Por construcción: `saldo_previo + ingresos − egresos = saldo`.
   */
  saldo:         number
  /**
   * Fecha del primer movimiento de la cuenta, `null` si no tiene ninguno.
   *
   * No es un extra: el importador escribe `cuentas.saldo_inicial` **sin pedir fecha de
   * corte**, así que ese saldo es el del día de la migración pero está guardado como si
   * fuera el del principio de los tiempos. Preguntar por una fecha anterior devuelve
   * `saldo_inicial`, que es una respuesta plana y engañosa; con esto la pantalla puede
   * decir que antes de esa fecha no hay historia, en vez de dar la cifra como si fuera
   * un saldo medido.
   */
  primera_fecha: string | null
}

/** Rango del extracto. `hasta` es la FECHA DE CORTE del saldo; `desde` solo parte el período. */
export interface RangoSaldos {
  desde?: string | null
  hasta?: string | null
}

/**
 * Saldos de todas las cuentas del cliente (menos las de «Apertura»), indexados por
 * `cuenta_id`. Una cuenta sin movimientos también viene, con su `saldo_inicial`.
 *
 * ```ts
 * const saldos = await saldosAFecha(db, cid, empresaIds, { desde, hasta })
 * const s = saldos.get(cuenta_id)          // undefined ⇒ cuenta de Apertura o de otro cliente
 * ```
 *
 * @throws si la función SQL falla — ver la cabecera.
 */
export async function saldosAFecha(
  db:          Db,
  client_id:   string,
  empresa_ids: string[],
  rango?:      RangoSaldos,
): Promise<Map<string, SaldoCuenta>> {
  // Sin empresas no hay nada que sumar, y `= any('{}')` no casa con ninguna fila:
  // se ahorra el viaje.
  if (!empresa_ids.length) return new Map()

  const { data, error } = await db.rpc('tes_saldos_a_fecha', {
    p_client_id:   client_id,
    p_empresa_ids: empresa_ids,
    p_desde:       rango?.desde || null,
    p_hasta:       rango?.hasta || null,
  })
  if (error) throw new Error(`saldos a fecha: ${error.message}`)

  type Fila = {
    cuenta_id: string; saldo_previo: string; ingresos: string; egresos: string
    movimientos: string; saldo: string; primera_fecha: string | null
  }
  // `numeric` y `bigint` llegan como cadena por JSON: sin `Number` las sumas de arriba
  // concatenarían en vez de sumar.
  return new Map((data ?? []).map((f: Fila) => [f.cuenta_id, {
    saldo_previo:  Number(f.saldo_previo),
    ingresos:      Number(f.ingresos),
    egresos:       Number(f.egresos),
    movimientos:   Number(f.movimientos),
    saldo:         Number(f.saldo),
    primera_fecha: f.primera_fecha,
  }]))
}

/**
 * El extracto de una cuenta sin movimientos: todo se queda en su saldo inicial.
 *
 * Es el respaldo para una cuenta que el mapa no trae. Devolver ceros sería peor que no
 * contestar: dejaría a la vista un saldo de 0 en una cuenta que sí tiene dinero.
 */
export function saldoSinMovimientos(saldo_inicial: number): SaldoCuenta {
  return {
    saldo_previo: saldo_inicial, ingresos: 0, egresos: 0, movimientos: 0,
    saldo: saldo_inicial, primera_fecha: null,
  }
}
