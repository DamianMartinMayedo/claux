-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN 189 — `cat_usos_por_categoria`: contar apuntes sin traérselos
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ EXISTE. El asistente de adopción (F1.4) enseña «"Comisión bancaria"
-- tiene 34 registros» antes de proponer fundirla con otra, y fundir es
-- permanente. Así que el número tiene que ser EXACTO y sobre toda la historia:
-- acotarlo por rango daría un conteo creíble y falso, que es peor que ninguno.
--
-- Contarlo en el cliente obligaba a traerse una fila por apunte de las dos
-- tablas del tenant enteras. Con dos años de operación son miles de filas
-- viajando por una conexión cubana para producir dos docenas de enteros. El
-- centinela `npm run audit:filtros` lo marcó, y tenía razón: el arreglo no es
-- acotar la consulta, es no hacer la consulta.
--
-- Cuenta las DOS tablas porque una categoría se usa desde las dos: un gasto sin
-- factura vive en `gastos_cobros` y un movimiento manual de caja o banco vive en
-- `movimientos_tesoreria`. Fundir mirando solo una dejaría apuntes huérfanos que
-- el dueño no vio venir.
--
-- Depende de: 184 (esquema del clasificador).

create or replace function public.cat_usos_por_categoria(p_client_id text)
returns table (categoria_id text, usos bigint)
language sql
stable
security definer
set search_path = public
as $$
  select categoria_id, sum(n)::bigint as usos
    from (
      select categoria_id, count(*) as n
        from public.gastos_cobros
       where client_id = p_client_id and categoria_id is not null
       group by categoria_id
      union all
      select categoria_id, count(*) as n
        from public.movimientos_tesoreria
       where client_id = p_client_id and categoria_id is not null
       group by categoria_id
    ) t
   group by categoria_id;
$$;

comment on function public.cat_usos_por_categoria(text) is
  'Cuántos apuntes usa cada categoría de gasto del cliente, sumando gastos_cobros y '
  'movimientos_tesoreria. Exacto y sobre toda la historia: lo consume el asistente de '
  'adopción, que decide fusiones irreversibles con este número (mig. 189).';

-- Solo el backend. Es `security definer` y recibe el `client_id` por parámetro:
-- expuesta a `anon` sería un contador de la actividad de cualquier inquilino.
revoke all on function public.cat_usos_por_categoria(text) from public;
revoke all on function public.cat_usos_por_categoria(text) from anon;
revoke all on function public.cat_usos_por_categoria(text) from authenticated;
