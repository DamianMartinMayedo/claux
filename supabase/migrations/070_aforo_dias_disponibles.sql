-- ================================================================
-- MIGRACIÓN 070: Reservas (aforo) — próximos días con hueco libre
--
-- Hermano de res_dias_disponibles_cita: escanea día a día desde una fecha y
-- devuelve los próximos días CON al menos un hueco libre para N personas
-- (fecha, primera_hora, libres). Reutiliza res_slots_aforo por día (misma
-- lógica de cierres/antelación/ventana). Sirve para que la mini-web pinte una
-- rejilla de días marcando disponibles vs no disponibles.
-- ================================================================

create or replace function res_dias_disponibles_aforo(
  p_client_id text,
  p_personas  int,
  p_desde     date,
  p_max_dias  int
) returns jsonb language plpgsql stable as $function$
declare
  v_now_d   date := (now() at time zone 'America/Havana')::date;
  v_ventana int;
  v_limit   int;
  v_max_res int := 10;
  v_result  jsonb := '[]'::jsonb;
  v_count   int := 0;
  v_i       int := 0;
  v_inicio  date;
  v_dia     date;
  v_libres  jsonb;
  v_primera text;
  v_nlibres int;
begin
  v_inicio := greatest(coalesce(p_desde, v_now_d), v_now_d);

  select coalesce(reserva_ventana_max_dias, 0) into v_ventana
  from clients where client_id = p_client_id;

  v_limit := least(coalesce(nullif(p_max_dias, 0), 60), 60);
  if coalesce(v_ventana, 0) > 0 then
    v_limit := least(v_limit, v_ventana);
  end if;

  while v_i <= v_limit and v_count < v_max_res loop
    v_dia := v_inicio + v_i;
    select coalesce(jsonb_agg(e order by e ->> 'hora'), '[]'::jsonb) into v_libres
    from jsonb_array_elements(res_slots_aforo(p_client_id, v_dia, p_personas)) e
    where (e ->> 'libre')::boolean;
    if jsonb_array_length(v_libres) > 0 then
      v_primera := v_libres -> 0 ->> 'hora';
      v_nlibres := jsonb_array_length(v_libres);
      v_result := v_result || jsonb_build_object(
        'fecha',        to_char(v_dia, 'YYYY-MM-DD'),
        'primera_hora', v_primera,
        'libres',       v_nlibres
      );
      v_count := v_count + 1;
    end if;
    v_i := v_i + 1;
  end loop;

  return v_result;
end;
$function$;

grant execute on function res_dias_disponibles_aforo(text, int, date, int) to service_role;

notify pgrst, 'reload schema';
