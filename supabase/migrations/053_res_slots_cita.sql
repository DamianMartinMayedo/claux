-- ================================================================
-- MIGRACIÓN 053: Disponibilidad de citas en 1 sola query
--
-- Devuelve los huecos LIBRES de un servicio para una fecha, ya sea de un
-- recurso concreto o de todos los que prestan el servicio ("cualquiera").
-- El paso entre huecos = duración del servicio (citas back-to-back).
-- Excluye huecos pasados si la fecha es hoy (zona America/Havana).
-- Una sola llamada para todo el día → presupuesto de página pública (CONTEXTO §3).
-- ================================================================

create or replace function res_slots_cita(
  p_client_id  text,
  p_servicio_id text,
  p_recurso_id text,   -- null = cualquiera de los que presten el servicio
  p_fecha      date
) returns jsonb as $$
declare
  v_dur     int;
  v_dow     int;
  v_now_d   date := (now() at time zone 'America/Havana')::date;
  v_now_t   time := (now() at time zone 'America/Havana')::time;
  v_result  jsonb := '[]'::jsonb;
  r_rec     record;
  r_hor     record;
  v_t       int;
  v_end     int;
  v_hora    time;
  v_hora_fin time;
begin
  select duracion_minutos into v_dur
  from servicios where servicio_id = p_servicio_id and client_id = p_client_id and activo = true;
  if not found or v_dur < 1 then return '[]'::jsonb; end if;

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

        if (p_fecha > v_now_d or (p_fecha = v_now_d and v_hora > v_now_t))
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
$$ language plpgsql;

grant execute on function res_slots_cita(text, text, text, date) to service_role;

notify pgrst, 'reload schema';
