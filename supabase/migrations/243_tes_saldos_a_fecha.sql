-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN 243 — `tes_saldos_a_fecha`: el saldo de cada cuenta a una fecha
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ EXISTE. El saldo de una cuenta nunca se persistió: siempre fue derivado
-- (`cuentas.saldo_inicial + Σ INGRESO − Σ EGRESO`), y eso es justo lo que lo hace
-- consultable a CUALQUIER fecha:
--
--   hoy:        saldo(cuenta)    = saldo_inicial + Σ ±monto
--   a fecha D:  saldo(cuenta, D) = saldo_inicial + Σ ±monto donde fecha ≤ D
--
-- El portal lo calculaba en JavaScript trayéndose las filas: 1.410 movimientos por
-- la API para dar tres números, y con el techo de 1.000 de PostgREST encima (que hoy
-- salva `traerTodas`, a costa de dos viajes). Aquí baja a Postgres, que además es lo
-- que Cuba necesita: una fila por cuenta en vez de miles de movimientos.
--
-- LOS CUATRO NÚMEROS, y por qué son estos. La fila de una cuenta tiene que leerse
-- entera —parto de X, entró esto, salió esto, quedo en Y— o el saldo del final no se
-- puede comprobar contra nada:
--
--   saldo_previo  saldo al día ANTERIOR a `p_desde`  (de dónde parte)
--   ingresos      Σ INGRESO dentro de [desde, hasta]
--   egresos       Σ EGRESO  dentro de [desde, hasta]
--   saldo         saldo a `p_hasta`                  (donde acaba)
--
-- y por construcción `saldo_previo + ingresos − egresos = saldo`. Sin `p_desde` no
-- hay «previo» que valga: `saldo_previo` es entonces el `saldo_inicial` a secas.
--
-- ACOTAR SOLO EL EXTREMO SUPERIOR. Acotar los DOS extremos daría
-- `saldo_inicial + solo los movimientos de la ventana`: ni el saldo de hoy ni el del
-- 20 de julio, un número que no existe. Por eso el `saldo` ignora `p_desde` y solo
-- mira `p_hasta`; `p_desde` únicamente parte el período para los otros tres.
--
-- `primera_fecha` ES PARTE DE LA RESPUESTA, no un extra. El importador escribe
-- `cuentas.saldo_inicial` sin pedir fecha de corte, así que ese saldo es el del día
-- de la migración pero está guardado como si fuera el del principio de los tiempos.
-- Preguntar por una fecha anterior al primer movimiento devuelve `saldo_inicial`, que
-- es una respuesta plana y engañosa. Devolviendo la fecha del primer movimiento, la
-- pantalla puede decir «sin movimientos anteriores a esta fecha» en vez de dar la
-- cifra como si fuera un saldo medido.
--
-- LAS CUENTAS DE «APERTURA» (mig. 130) QUEDAN FUERA, aquí y no en cada consumidor:
-- no son dinero real, son el contrapeso técnico contra el que el importador salda el
-- histórico ya pagado. Los tres sitios que llaman a esta función las descartaban por
-- su cuenta, cada uno a su manera.
--
-- LAS ARCHIVADAS SE DEVUELVEN. Una cuenta inactiva hoy pudo tener saldo el 20 de
-- julio, y quien pregunta por una fecha pasada la necesita. Quién entra en el total
-- lo decide la pantalla, que es la que sabe si está enseñando las archivadas.
--
-- Depende de: 022 (tesorería), 130 (`cuentas.es_apertura`).

-- El acumulado recorre los movimientos de la cuenta filtrando por fecha: la clave
-- útil es (client_id, cuenta_id, fecha), que es prefijo del índice que ya creó la
-- mig. 242 para la ventana de `tes_saldo_tras`. No hace falta índice nuevo.

create or replace function public.tes_saldos_a_fecha(
  p_client_id   text,
  p_empresa_ids text[],
  p_desde       date default null,
  p_hasta       date default null
)
returns table (
  cuenta_id     text,
  saldo_previo  numeric,
  ingresos      numeric,
  egresos       numeric,
  movimientos   bigint,
  saldo         numeric,
  primera_fecha date
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.cuenta_id,
    -- De dónde parte: todo lo anterior al rango. Sin `p_desde`, el saldo inicial.
    c.saldo_inicial + coalesce(sum(
      case when m.tipo = 'INGRESO' then m.monto else -m.monto end
    ) filter (where p_desde is not null and m.fecha < p_desde), 0),
    coalesce(sum(m.monto) filter (
      where m.tipo = 'INGRESO'
        and (p_desde is null or m.fecha >= p_desde)
        and (p_hasta is null or m.fecha <= p_hasta)), 0),
    coalesce(sum(m.monto) filter (
      where m.tipo = 'EGRESO'
        and (p_desde is null or m.fecha >= p_desde)
        and (p_hasta is null or m.fecha <= p_hasta)), 0),
    -- `count(m.movimiento_id)` y no `count(*)`: con LEFT JOIN, una cuenta sin
    -- movimientos trae una fila de nulos y `count(*)` la contaría como uno.
    count(m.movimiento_id) filter (
      where (p_desde is null or m.fecha >= p_desde)
        and (p_hasta is null or m.fecha <= p_hasta)),
    -- Donde acaba: SOLO el extremo superior (ver la cabecera).
    c.saldo_inicial + coalesce(sum(
      case when m.tipo = 'INGRESO' then m.monto else -m.monto end
    ) filter (where p_hasta is null or m.fecha <= p_hasta), 0),
    min(m.fecha)
  from public.cuentas c
  left join public.movimientos_tesoreria m
    on m.cuenta_id = c.cuenta_id
   and m.client_id = c.client_id
  where c.client_id = p_client_id
    and c.empresa_id = any(p_empresa_ids)
    and coalesce(c.es_apertura, false) = false
  group by c.cuenta_id, c.saldo_inicial;
$$;

comment on function public.tes_saldos_a_fecha(text, text[], date, date) is
  'Saldo de cada cuenta a `p_hasta` (saldo_inicial + Σ ±monto con fecha ≤ hasta), más el '
  'saldo previo a `p_desde` y los ingresos/egresos/movimientos del rango, de forma que '
  'previo + ingresos − egresos = saldo. El saldo acota SOLO el extremo superior: acotar los '
  'dos daría un número que no existe. Excluye las cuentas de Apertura (mig. 130) y devuelve '
  'las archivadas, que a una fecha pasada pudieron tener saldo (mig. 243).';

-- Solo el backend, como el resto de funciones con `p_client_id` por parámetro:
-- expuesta a `anon` sería el saldo de cualquier inquilino.
revoke all on function public.tes_saldos_a_fecha(text, text[], date, date) from public;
revoke all on function public.tes_saldos_a_fecha(text, text[], date, date) from anon;
revoke all on function public.tes_saldos_a_fecha(text, text[], date, date) from authenticated;
