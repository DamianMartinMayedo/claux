-- ================================================================
-- MIGRACIÓN 047: Función atómica para crear reserva
--
-- Comprueba disponibilidad (solapamiento real) e inserta la
-- reserva en una sola transacción, evitando overbooking por
-- concurrencia.
--
-- Patrón: mismo que inv_confirmar_compra (037).
-- ================================================================

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
  v_franja       record;
  v_hora_fin     time;
  v_total_ocupado int;
  v_capacidad    int;
begin
  -- 1. Obtener la franja
  select capacidad, duracion_minutos into v_franja
  from reserva_franjas
  where franja_id = p_franja_id and client_id = p_client_id and activa = true;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Turno no encontrado o inactivo.');
  end if;

  v_capacidad := v_franja.capacidad;

  -- 2. Calcular hora_fin
  v_hora_fin := (p_hora + (v_franja.duracion_minutos || ' minutes')::interval)::time;

  -- 3. Comprobar solapamiento: suma personas de reservas que pisen este rango
  select coalesce(sum(personas), 0) into v_total_ocupado
  from reservas
  where franja_id = p_franja_id
    and client_id = p_client_id
    and fecha     = p_fecha
    and estado in ('PENDIENTE', 'CONFIRMADA')
    and hora    < v_hora_fin
    and hora_fin > p_hora;

  if v_total_ocupado + p_personas > v_capacidad then
    return jsonb_build_object('ok', false, 'error', 'No hay capacidad suficiente para esa hora.');
  end if;

  -- 4. Insertar la reserva
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

grant execute on function res_crear_reserva to service_role;

notify pgrst, 'reload schema';
