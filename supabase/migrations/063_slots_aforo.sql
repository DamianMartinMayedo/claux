-- ================================================================
-- MIGRACIÓN 063: Disponibilidad de aforo (Reservas) en 1 query
--
-- Devuelve los huecos de un día como lista plana de horas (sin nombre de turno),
-- cada uno con el franja_id para reservar y si está libre para N personas.
-- Aplica cierres, antelación mínima, ventana máxima y huecos pasados (Havana).
-- Dedupe por hora: si dos turnos comparten hora, gana el que esté libre.
-- ================================================================

create or replace function res_slots_aforo(p_client_id text, p_fecha date, p_personas int)
returns jsonb as $$
declare
  v_dow   int;
  v_now   timestamp := now() at time zone 'America/Havana';
  v_min   timestamp;
  r       record;
  f       record;
  v_t     int; v_end int; v_dur int; v_cap int;
  v_hora  time; v_hora_fin time; v_k text;
  v_ocupado int; v_libre boolean;
  v_map   jsonb := '{}'::jsonb;
  v_out   jsonb;
begin
  if res_cerrado(p_client_id, p_fecha) then return '[]'::jsonb; end if;

  select reserva_antelacion_min_horas as a, reserva_ventana_max_dias as v into r
  from clients where client_id = p_client_id;
  if coalesce(r.v, 0) > 0 and p_fecha > (v_now::date + r.v) then return '[]'::jsonb; end if;
  v_min := v_now + make_interval(hours => coalesce(r.a, 0));

  v_dow := extract(isodow from p_fecha)::int;

  for f in
    select franja_id, hora_inicio, hora_fin, capacidad, duracion_minutos, dias_semana
    from reserva_franjas
    where client_id = p_client_id and activa = true
      and hora_inicio is not null and hora_fin is not null
    order by hora_inicio
  loop
    if f.dias_semana is not null and array_length(f.dias_semana, 1) is not null
       and not (v_dow = any (f.dias_semana)) then continue; end if;

    v_dur := coalesce(f.duracion_minutos, 60);
    v_cap := coalesce(f.capacidad, 1);
    v_t   := extract(hour from f.hora_inicio)::int * 60 + extract(minute from f.hora_inicio)::int;
    v_end := extract(hour from f.hora_fin)::int   * 60 + extract(minute from f.hora_fin)::int;

    while v_t < v_end loop
      v_hora     := make_time((v_t / 60)::int, (v_t % 60)::int, 0);
      v_hora_fin := (v_hora + (v_dur || ' minutes')::interval)::time;

      if (p_fecha + v_hora) >= v_min then
        select coalesce(sum(personas), 0) into v_ocupado
        from reservas
        where franja_id = f.franja_id and client_id = p_client_id and fecha = p_fecha
          and estado in ('PENDIENTE', 'CONFIRMADA')
          and hora < v_hora_fin and hora_fin > v_hora;
        v_libre := (v_cap - v_ocupado) >= p_personas;
        v_k := to_char(v_hora, 'HH24:MI');

        if not (v_map ? v_k)
           or (v_libre and not coalesce((v_map -> v_k ->> 'libre')::boolean, false)) then
          v_map := v_map || jsonb_build_object(v_k, jsonb_build_object('franja_id', f.franja_id, 'libre', v_libre));
        end if;
      end if;

      v_t := v_t + 30;
    end loop;
  end loop;

  select coalesce(jsonb_agg(
           jsonb_build_object('hora', k, 'franja_id', val ->> 'franja_id', 'libre', (val ->> 'libre')::boolean)
           order by k), '[]'::jsonb)
  into v_out
  from jsonb_each(v_map) as e(k, val);

  return v_out;
end;
$$ language plpgsql stable;

grant execute on function res_slots_aforo(text, date, int) to service_role;

-- Próximo día (desde p_desde) con al menos un hueco LIBRE; null si no hay en p_dias.
create or replace function res_proximo_dia_aforo(p_client_id text, p_personas int, p_desde date, p_dias int)
returns date as $$
declare d date;
begin
  for i in 0 .. p_dias loop
    d := p_desde + i;
    if exists (
      select 1 from jsonb_array_elements(res_slots_aforo(p_client_id, d, p_personas)) e
      where (e ->> 'libre')::boolean
    ) then
      return d;
    end if;
  end loop;
  return null;
end;
$$ language plpgsql stable;

grant execute on function res_proximo_dia_aforo(text, int, date, int) to service_role;

notify pgrst, 'reload schema';
