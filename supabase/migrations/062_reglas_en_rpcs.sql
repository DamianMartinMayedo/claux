-- ================================================================
-- MIGRACIÓN 062: Aplicar reglas de reserva dentro de los RPC
-- (antelación mínima, ventana máxima de días, tope de personas)
-- ================================================================

-- Helper: devuelve mensaje de error si se viola alguna regla, o NULL si todo ok.
create or replace function res_reglas_check(p_client_id text, p_fecha date, p_hora time, p_personas int)
returns text as $$
declare
  r record;
  v_now timestamp := now() at time zone 'America/Havana';
begin
  select reserva_antelacion_min_horas as a, reserva_ventana_max_dias as v, reserva_max_personas as m
    into r from clients where client_id = p_client_id;
  if not found then return null; end if;

  if r.a > 0 and (p_fecha + p_hora) < (v_now + make_interval(hours => r.a)) then
    return format('Debes reservar con al menos %s h de antelación.', r.a);
  end if;
  if r.v > 0 and p_fecha > (v_now::date + r.v) then
    return format('Solo se puede reservar hasta %s días vista.', r.v);
  end if;
  if p_personas > 0 and r.m > 0 and p_personas > r.m then
    return format('Máximo %s personas por reserva. Para grupos mayores, contacta con el negocio.', r.m);
  end if;
  return null;
end;
$$ language plpgsql stable;

grant execute on function res_reglas_check(text, date, time, int) to service_role;

-- res_crear_reserva: + reglas (tras el chequeo de cierre)
create or replace function res_crear_reserva(p_client_id text, p_franja_id text, p_fecha date, p_hora time without time zone, p_personas integer, p_nombre_cliente text, p_telefono text, p_notas text, p_canal text, p_confirmacion_automatica boolean, p_reserva_id text)
returns jsonb language plpgsql as $function$
declare
  v_franja        record;
  v_hora_fin      time;
  v_total_ocupado int;
  v_regla_err     text;
begin
  perform pg_advisory_xact_lock(hashtext(p_client_id || ':' || p_franja_id || ':' || p_fecha::text));

  if res_cerrado(p_client_id, p_fecha) then
    return jsonb_build_object('ok', false, 'error', 'El negocio está cerrado ese día.');
  end if;

  v_regla_err := res_reglas_check(p_client_id, p_fecha, p_hora, p_personas);
  if v_regla_err is not null then
    return jsonb_build_object('ok', false, 'error', v_regla_err);
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

-- res_crear_cita: + reglas (personas=1, el tope de grupo no aplica)
create or replace function res_crear_cita(p_client_id text, p_recurso_id text, p_servicio_id text, p_fecha date, p_hora time without time zone, p_nombre_cliente text, p_telefono text, p_notas text, p_canal text, p_confirmacion_automatica boolean, p_reserva_id text)
returns jsonb language plpgsql as $function$
declare
  v_dur       int;
  v_hora_fin  time;
  v_dow       int;
  v_solapa    int;
  v_regla_err text;
begin
  perform pg_advisory_xact_lock(hashtext(p_client_id || ':' || p_recurso_id || ':' || p_fecha::text));

  if res_cerrado(p_client_id, p_fecha) then
    return jsonb_build_object('ok', false, 'error', 'El negocio está cerrado ese día.');
  end if;

  v_regla_err := res_reglas_check(p_client_id, p_fecha, p_hora, 1);
  if v_regla_err is not null then
    return jsonb_build_object('ok', false, 'error', v_regla_err);
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

notify pgrst, 'reload schema';
