-- ================================================================
-- MIGRACIÓN 069: Citas — recomendar la fecha más cercana disponible
--
-- a) res_slots_cita: además de cierres/horario/solape/pasado, aplica la
--    ANTELACIÓN mínima y la VENTANA máxima del negocio, para que todo hueco
--    mostrado sea reservable por res_crear_cita (antes podía ofrecer horas
--    que el alta luego rechazaba por antelación).
-- b) res_dias_disponibles_cita: escanea día a día desde una fecha y devuelve
--    los próximos días CON hueco (fecha, primera_hora, huecos), para que las
--    vías de reserva salten al primer día disponible y pinten una tira de
--    próximos días — sin que el cliente adivine fechas.
-- ================================================================

-- ── a) Disponibilidad de un día, ahora con reglas de antelación/ventana ──────
create or replace function res_slots_cita(p_client_id text, p_servicio_id text, p_recurso_id text, p_fecha date)
returns jsonb language plpgsql as $function$
declare
  v_dur        int;
  v_dow        int;
  v_now_local  timestamp := now() at time zone 'America/Havana';
  v_antelacion int;
  v_ventana    int;
  v_min_ts     timestamp;
  v_result     jsonb := '[]'::jsonb;
  r_rec        record;
  r_hor        record;
  v_t          int;
  v_end        int;
  v_hora       time;
  v_hora_fin   time;
begin
  select duracion_minutos into v_dur
  from servicios where servicio_id = p_servicio_id and client_id = p_client_id and activo = true;
  if not found or v_dur < 1 then return '[]'::jsonb; end if;

  if res_cerrado(p_client_id, p_fecha) then return '[]'::jsonb; end if;

  -- Reglas del negocio: antelación mínima y ventana máxima (coherencia con res_crear_cita)
  select coalesce(reserva_antelacion_min_horas, 0), coalesce(reserva_ventana_max_dias, 0)
    into v_antelacion, v_ventana
  from clients where client_id = p_client_id;

  if coalesce(v_ventana, 0) > 0 and p_fecha > (v_now_local::date + v_ventana) then
    return '[]'::jsonb;
  end if;

  -- Umbral mínimo: ahora + antelación. Un hueco solo vale si empieza a partir de aquí
  -- (esto reemplaza el viejo filtro de "hora pasada", que es el caso antelación = 0).
  v_min_ts := v_now_local + make_interval(hours => coalesce(v_antelacion, 0));
  v_dow := extract(isodow from p_fecha)::int;

  for r_rec in
    select rec.recurso_id, rec.nombre
    from recursos rec
    where rec.client_id = p_client_id and rec.activo = true
      and (p_recurso_id is null or rec.recurso_id = p_recurso_id)
      and (
        not exists (select 1 from recurso_servicios rs where rs.recurso_id = rec.recurso_id)
        or exists (select 1 from recurso_servicios rs where rs.recurso_id = rec.recurso_id and rs.servicio_id = p_servicio_id)
      )
    order by rec.nombre
  loop
    for r_hor in
      select hora_inicio, hora_fin
      from recurso_horarios
      where recurso_id = r_rec.recurso_id and dia_semana = v_dow
      order by hora_inicio
    loop
      v_t   := extract(hour from r_hor.hora_inicio)::int * 60 + extract(minute from r_hor.hora_inicio)::int;
      v_end := extract(hour from r_hor.hora_fin)::int   * 60 + extract(minute from r_hor.hora_fin)::int;
      while v_t + v_dur <= v_end loop
        v_hora     := make_time((v_t / 60)::int, (v_t % 60)::int, 0);
        v_hora_fin := (v_hora + (v_dur || ' minutes')::interval)::time;

        if (p_fecha + v_hora) >= v_min_ts
           and not exists (
             select 1 from reservas
             where recurso_id = r_rec.recurso_id and client_id = p_client_id and fecha = p_fecha
               and estado in ('PENDIENTE', 'CONFIRMADA')
               and hora < v_hora_fin and hora_fin > v_hora
           ) then
          v_result := v_result || jsonb_build_object(
            'recurso_id', r_rec.recurso_id,
            'recurso_nombre', r_rec.nombre,
            'hora', to_char(v_hora, 'HH24:MI')
          );
        end if;

        v_t := v_t + v_dur;
      end loop;
    end loop;
  end loop;

  return v_result;
end;
$function$;

grant execute on function res_slots_cita(text, text, text, date) to service_role;

-- ── b) Próximos días con disponibilidad ──────────────────────────────────────
-- Reutiliza res_slots_cita por día (DRY: misma lógica de horario/solape/cierre/
-- antelación). Corta pronto al juntar suficientes días con hueco.
create or replace function res_dias_disponibles_cita(
  p_client_id   text,
  p_servicio_id text,
  p_recurso_id  text,   -- null = cualquiera de los que presten el servicio
  p_desde       date,
  p_max_dias    int      -- nº de días a escanear hacia delante
) returns jsonb language plpgsql as $function$
declare
  v_now_d    date := (now() at time zone 'America/Havana')::date;
  v_ventana  int;
  v_limit    int;        -- días a escanear como máximo (tope duro 60)
  v_max_res  int := 10;  -- nº de días con hueco a devolver (para la tira)
  v_result   jsonb := '[]'::jsonb;
  v_count    int := 0;
  v_i        int := 0;
  v_inicio   date;
  v_dia      date;
  v_slots    jsonb;
  v_primera  text;
  v_huecos   int;
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
    v_slots := res_slots_cita(p_client_id, p_servicio_id, p_recurso_id, v_dia);
    if jsonb_array_length(v_slots) > 0 then
      v_primera := (select min(e->>'hora') from jsonb_array_elements(v_slots) e);
      v_huecos  := (select count(distinct e->>'hora') from jsonb_array_elements(v_slots) e);
      v_result := v_result || jsonb_build_object(
        'fecha',        to_char(v_dia, 'YYYY-MM-DD'),
        'primera_hora', v_primera,
        'huecos',       v_huecos
      );
      v_count := v_count + 1;
    end if;
    v_i := v_i + 1;
  end loop;

  return v_result;
end;
$function$;

grant execute on function res_dias_disponibles_cita(text, text, text, date, int) to service_role;

notify pgrst, 'reload schema';
