-- ================================================================
-- MIGRACIÓN 049: Reservas — hardening de concurrencia y reglas
--
-- Corrige dos fallos de la migración 047:
--   #1 Overbooking por concurrencia: 047 hacía SELECT sum → check → INSERT
--      SIN bloqueo. En READ COMMITTED dos reservas simultáneas leen la misma
--      suma, ambas pasan el check y ambas insertan → se supera la capacidad.
--      Solución: pg_advisory_xact_lock por (negocio, franja, fecha) que
--      serializa solo a las reservas que compiten por el mismo cupo. El lock
--      se libera al terminar la transacción del RPC.
--   #2 dias_semana ignorado: 047 no validaba el día de la semana de la franja.
--      Ahora se rechaza si la fecha no cae en un día activo del turno
--      (isodow: 1=Lunes … 7=Domingo, igual que reserva_franjas.dias_semana).
--
-- Además: res_modificar_reserva lleva la edición (antes check+update en JS,
-- con la misma carrera) a una función atómica con idéntica garantía.
-- ================================================================

-- ── Crear reserva (atómica, anti-overbooking) ───────────────────────────────
create or replace function res_crear_reserva(
  p_client_id              text,
  p_franja_id              text,
  p_fecha                  date,
  p_hora                   time,
  p_personas               int,
  p_nombre_cliente         text,
  p_telefono               text,
  p_notas                  text,
  p_canal                  text,
  p_confirmacion_automatica boolean,
  p_reserva_id             text
) returns jsonb as $$
declare
  v_franja        record;
  v_hora_fin      time;
  v_total_ocupado int;
begin
  -- 0. Serializar las reservas que compiten por el mismo cupo (negocio+franja+fecha)
  perform pg_advisory_xact_lock(hashtext(p_client_id || ':' || p_franja_id || ':' || p_fecha::text));

  -- 1. Obtener la franja
  select capacidad, duracion_minutos, dias_semana into v_franja
  from reserva_franjas
  where franja_id = p_franja_id and client_id = p_client_id and activa = true;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Turno no encontrado o inactivo.');
  end if;

  -- 2. Validar día de la semana (NULL/vacío = todos los días)
  if v_franja.dias_semana is not null
     and array_length(v_franja.dias_semana, 1) is not null
     and not (extract(isodow from p_fecha)::int = any (v_franja.dias_semana)) then
    return jsonb_build_object('ok', false, 'error', 'Ese turno no atiende ese día de la semana.');
  end if;

  -- 3. Calcular hora_fin
  v_hora_fin := (p_hora + (v_franja.duracion_minutos || ' minutes')::interval)::time;

  -- 4. Comprobar solapamiento: suma personas de reservas que pisen este rango
  select coalesce(sum(personas), 0) into v_total_ocupado
  from reservas
  where franja_id = p_franja_id
    and client_id = p_client_id
    and fecha     = p_fecha
    and estado in ('PENDIENTE', 'CONFIRMADA')
    and hora    < v_hora_fin
    and hora_fin > p_hora;

  if v_total_ocupado + p_personas > v_franja.capacidad then
    return jsonb_build_object('ok', false, 'error', 'No hay capacidad suficiente para esa hora.');
  end if;

  -- 5. Insertar la reserva
  insert into reservas (reserva_id, client_id, franja_id, fecha, hora, hora_fin, personas,
                        nombre_cliente, telefono, notas, canal, estado,
                        confirmacion_automatica)
  values (p_reserva_id, p_client_id, p_franja_id, p_fecha, p_hora, v_hora_fin, p_personas,
          p_nombre_cliente, p_telefono, p_notas, p_canal,
          case when p_confirmacion_automatica then 'CONFIRMADA' else 'PENDIENTE' end,
          p_confirmacion_automatica);

  return jsonb_build_object('ok', true, 'reserva_id', p_reserva_id);
end;
$$ language plpgsql;

-- ── Modificar reserva (atómica, mismo lock y reglas) ─────────────────────────
create or replace function res_modificar_reserva(
  p_client_id      text,
  p_reserva_id     text,
  p_franja_id      text,
  p_fecha          date,
  p_hora           time,
  p_personas       int,
  p_nombre_cliente text,
  p_telefono       text,
  p_notas          text
) returns jsonb as $$
declare
  v_franja        record;
  v_estado        text;
  v_hora_fin      time;
  v_total_ocupado int;
begin
  perform pg_advisory_xact_lock(hashtext(p_client_id || ':' || p_franja_id || ':' || p_fecha::text));

  -- La reserva debe existir, ser del negocio y estar en estado editable
  select estado into v_estado
  from reservas
  where reserva_id = p_reserva_id and client_id = p_client_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Reserva no encontrada.');
  end if;
  if v_estado not in ('PENDIENTE', 'CONFIRMADA') then
    return jsonb_build_object('ok', false, 'error', 'Solo se pueden editar reservas pendientes o confirmadas.');
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

  -- Solapamiento excluyendo la propia reserva
  select coalesce(sum(personas), 0) into v_total_ocupado
  from reservas
  where franja_id  = p_franja_id
    and client_id  = p_client_id
    and fecha      = p_fecha
    and reserva_id <> p_reserva_id
    and estado in ('PENDIENTE', 'CONFIRMADA')
    and hora    < v_hora_fin
    and hora_fin > p_hora;

  if v_total_ocupado + p_personas > v_franja.capacidad then
    return jsonb_build_object('ok', false, 'error', 'No hay capacidad suficiente para los nuevos datos.');
  end if;

  update reservas set
    franja_id      = p_franja_id,
    fecha          = p_fecha,
    hora           = p_hora,
    hora_fin       = v_hora_fin,
    personas       = p_personas,
    nombre_cliente = p_nombre_cliente,
    telefono       = p_telefono,
    notas          = p_notas,
    updated_at     = now()
  where reserva_id = p_reserva_id and client_id = p_client_id;

  return jsonb_build_object('ok', true, 'reserva_id', p_reserva_id);
end;
$$ language plpgsql;

grant execute on function res_crear_reserva(text, text, date, time, int, text, text, text, text, boolean, text) to service_role;
grant execute on function res_modificar_reserva(text, text, text, date, time, int, text, text, text)            to service_role;

notify pgrst, 'reload schema';
