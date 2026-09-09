-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN 242 — `tes_saldo_tras`: el saldo de la cuenta después de cada movimiento
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ EXISTE. La lista de movimientos de Tesorería enseña el importe de cada
-- apunte pero no el saldo que dejó, que es lo que se busca al revisar un extracto
-- («y después de esto, cuánto quedaba»). Con UNA cuenta seleccionada, la columna
-- «Cuenta» repite el mismo nombre en todas las filas y ese hueco pasa a ser el
-- saldo.
--
-- POR QUÉ EN SQL Y NO EN EL NAVEGADOR. El saldo tras un movimiento se apoya en
-- TODA la historia anterior de la cuenta, y la pantalla nunca la tiene:
--   · el listado va acotado por rango y con techo de 500 filas (las más
--     recientes), así que las viejas —las que forman el saldo— no están;
--   · los filtros de la barra son `escalado`: en cuanto el listado se corta, el
--     servidor ya devuelve solo los ingresos, o solo una categoría, y una suma
--     hecha arriba sobre eso sale desplazada por las filas que no llegaron.
-- Acumular en el cliente sería, otra vez, un número creíble y falso. Aquí se
-- calcula sobre la cuenta entera y se devuelven solo las filas que se piden.
--
-- LA CLAVE DE ORDEN es `(fecha, created_at, movimiento_id)`: `fecha` es un DATE y
-- varios apuntes del mismo día empatan. Sin desempate único el acumulado cambia
-- de una consulta a otra sobre los mismos datos. `movimiento_id` es la PK, así
-- que el orden es total. Dentro de un día el orden es el de REGISTRO
-- (`created_at`), no el económico: el saldo del cierre del día es correcto, el
-- intermedio es el orden en que se teclearon los apuntes.
--
-- `saldo_inicial` de la cuenta entra en el acumulado, igual que en el saldo que
-- ya pinta la tabla de cuentas (`saldo_inicial + Σ INGRESO − Σ EGRESO`): así el
-- último movimiento de la cuenta da exactamente el saldo de arriba y los dos
-- números se pueden cuadrar a ojo.
--
-- Los ids se pasan por parámetro (los que la pantalla acaba de traer) para no
-- bajar la historia entera por una tabla de 500 filas.
--
-- Depende de: 022 (tesorería).

-- El índice DA el orden de la ventana: con `client_id` y `cuenta_id` fijos, el
-- resto de la clave ya es exactamente el `order by` del acumulado, así que se
-- recorre sin ordenar (comprobado: `Index Scan … → WindowAgg`, sin `Sort`). Con
-- las 72 filas de hoy el planificador aún prefiere bitmap + quicksort porque le
-- sale más barato; lo que importa es que con años de operación encima existe el
-- camino que no ordena toda la historia de la cuenta en cada carga.
create index if not exists idx_mov_cuenta_orden
  on movimientos_tesoreria (client_id, cuenta_id, fecha, created_at, movimiento_id);

create or replace function public.tes_saldo_tras(
  p_client_id      text,
  p_cuenta_id      text,
  p_movimiento_ids text[]
)
returns table (movimiento_id text, saldo_tras numeric)
language sql
stable
security definer
set search_path = public
as $$
  select s.movimiento_id, s.saldo_tras
    from (
      select m.movimiento_id,
             c.saldo_inicial
               + sum(case when m.tipo = 'INGRESO' then m.monto else -m.monto end)
                   over (order by m.fecha, m.created_at, m.movimiento_id
                         rows between unbounded preceding and current row) as saldo_tras
        from public.movimientos_tesoreria m
        join public.cuentas c on c.cuenta_id = m.cuenta_id
       where m.client_id = p_client_id
         and m.cuenta_id = p_cuenta_id
    ) s
   where s.movimiento_id = any(p_movimiento_ids);
$$;

comment on function public.tes_saldo_tras(text, text, text[]) is
  'Saldo de la cuenta después de cada movimiento (saldo_inicial + acumulado por fecha, '
  'created_at y movimiento_id), devuelto solo para los ids que se piden. Se calcula sobre '
  'toda la historia de la cuenta porque el listado va truncado y filtrado: acumular en el '
  'cliente daría un saldo desplazado (mig. 242).';

-- Solo el backend, como el resto de funciones con `p_client_id` por parámetro:
-- expuesta a `anon` sería el extracto de la cuenta de cualquier inquilino.
revoke all on function public.tes_saldo_tras(text, text, text[]) from public;
revoke all on function public.tes_saldo_tras(text, text, text[]) from anon;
revoke all on function public.tes_saldo_tras(text, text, text[]) from authenticated;
