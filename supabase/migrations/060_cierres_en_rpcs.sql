-- ================================================================
-- MIGRACIÓN 060: Aplicar cierres/festivos dentro de los RPC
--
-- Añade el chequeo res_cerrado a res_crear_reserva, res_crear_cita y res_slots_cita.
-- Así ninguna vía (panel, web, bot) puede reservar en una fecha cerrada, y la
-- disponibilidad de citas no ofrece huecos esos días.
-- (Cuerpos idénticos a 049/052/053 con el bloque `if res_cerrado(...) then` añadido
-- tras el advisory lock / al inicio.)
-- ================================================================

create or replace function res_crear_reserva(p_client_id text, p_franja_id text, p_fecha date, p_hora time without time zone, p_personas integer, p_nombre_cliente text, p_telefono text, p_notas text, p_canal text, p_confirmacion_automatica boolean, p_reserva_id text)
returns jsonb language plpgsql as $function$
declare
  v_franja        record;
  v_hora_fin      time;
  v_total_ocupado int;
begin
  perform pg_advisory_xact_lock(hashtext(p_client_id || ':' || p_franja_id || ':' || p_fecha::text));

  if res_cerrado(p_client_id, p_fecha) then
    return jsonb_build_object('ok', false, 'error', 'El negocio está cerrado ese día.');
  end if;

  select capacidad, duracion_minutos, dias_semana into v_franja
  from reserva_franjas
  where franja_id = p_franja_id and client_id = p_client_id and activa = true;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Turno no encontrado o inactivo.');
  end if;

  if v_franja.dias_semana is not null
     and array_length(v_franja.dias_semana, 1) is not null
     and not (extract(isodow from p_fecha)::int = any (v_franja.dias_semana)) then
    return jsonb_build_object('ok', false, 'error', 'Ese turno no atiende ese día de la semana.');
  end if;

  v_hora_fin := (p_hora + (v_franja.duracion_minutos || ' minutes')::interval)::time;

  select coalesce(sum(personas), 0) into v_total_ocupado
  from reservas
  where franja_id = p_franja_id and client_id = p_client_id and fecha = p_fecha
    and estado in ('PENDIENTE', 'CONFIRMADA')
    and hora < v_hora_fin and hora_fin > p_hora;

  if v_total_ocupado + p_personas > v_franja.capacidad then
    return jsonb_build_object('ok', false, 'error', 'No hay capacidad suficiente para esa hora.');
  end if;

  insert into reservas (reserva_id, client_id, franja_id, fecha, hora, hora_fin, personas,
                        nombre_cliente, telefono, notas, canal, estado, confirmacion_automatica)
  values (p_reserva_id, p_client_id, p_franja_id, p_fecha, p_hora, v_hora_fin, p_personas,
          p_nombre_cliente, p_telefono, p_notas, p_canal,
          case when p_confirmacion_automatica then 'CONFIRMADA' else 'PENDIENTE' end,
          p_confirmacion_automatica);

  return jsonb_build_object('ok', true, 'reserva_id', p_reserva_id);
end;
$function$;

create or replace function res_crear_cita(p_client_id text, p_recurso_id text, p_servicio_id text, p_fecha date, p_hora time without time zone, p_nombre_cliente text, p_telefono text, p_notas text, p_canal text, p_confirmacion_automatica boolean, p_reserva_id text)
returns jsonb language plpgsql as $function$
declare
  v_dur      int;
  v_hora_fin time;
  v_dow      int;
  v_solapa   int;
begin
  perform pg_advisory_xact_lock(hashtext(p_client_id || ':' || p_recurso_id || ':' || p_fecha::text));

  if res_cerrado(p_client_id, p_fecha) then
    return jsonb_build_object('ok', false, 'error', 'El negocio está cerrado ese día.');
  end if;

  select duracion_minutos into v_dur
  from servicios where servicio_id = p_servicio_id and client_id = p_client_id and activo = true;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Servicio no disponible.');
  end if;

  if not exists (select 1 from recursos where recurso_id = p_recurso_id and client_id = p_client_id and activo = true) then
    return jsonb_build_object('ok', false, 'error', 'Profesional o recurso no disponible.');
  end if;

  if exists (select 1 from recurso_servicios where recurso_id = p_recurso_id)
     and not exists (select 1 from recurso_servicios where recurso_id = p_recurso_id and servicio_id = p_servicio_id) then
    return jsonb_build_object('ok', false, 'error', 'Ese profesional no presta este servicio.');
  end if;

  v_hora_fin := (p_hora + (v_dur || ' minutes')::interval)::time;
  v_dow := extract(isodow from p_fecha)::int;

  if exists (select 1 from recurso_horarios where recurso_id = p_recurso_id)
     and not exists (
       select 1 from recurso_horarios
       where recurso_id = p_recurso_id and dia_semana = v_dow
         and hora_inicio <= p_hora and hora_fin >= v_hora_fin
     ) then
    return jsonb_build_object('ok', false, 'error', 'Fuera del horario de atención.');
  end if;

  select count(*) into v_solapa
  from reservas
  where recurso_id = p_recurso_id and client_id = p_client_id and fecha = p_fecha
    and estado in ('PENDIENTE', 'CONFIRMADA')
    and hora < v_hora_fin and hora_fin > p_hora;
  if v_solapa > 0 then
    return jsonb_build_object('ok', false, 'error', 'Ese horario ya está ocupado.');
  end if;

  insert into reservas (reserva_id, client_id, franja_id, recurso_id, servicio_id, fecha, hora, hora_fin,
                        personas, nombre_cliente, telefono, notas, canal, estado, confirmacion_automatica)
  values (p_reserva_id, p_client_id, null, p_recurso_id, p_servicio_id, p_fecha, p_hora, v_hora_fin,
          1, p_nombre_cliente, p_telefono, p_notas, p_canal,
          case when p_confirmacion_automatica then 'CONFIRMADA' else 'PENDIENTE' end,
          p_confirmacion_automatica);

  return jsonb_build_object('ok', true, 'reserva_id', p_reserva_id);
end;
$function$;

create or replace function res_slots_cita(p_client_id text, p_servicio_id text, p_recurso_id text, p_fecha date)
returns jsonb language plpgsql as $function$
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

  if res_cerrado(p_client_id, p_fecha) then return '[]'::jsonb; end if;

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
$function$;

notify pgrst, 'reload schema';
