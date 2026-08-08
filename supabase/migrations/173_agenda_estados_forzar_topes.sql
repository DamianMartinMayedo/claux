-- ================================================================
-- MIGRACIÓN 173: Reservas y Citas — cerrar el pasado, mandar en el alta
--                manual y contar las reservas, no solo las personas.
--
-- Plan: docs/planes/reservas-citas-correcciones.md (fases 2, 3 y 4).
-- Todo ADITIVO: las dos columnas nuevas nacen con el valor que reproduce
-- exactamente el comportamiento de hoy (false / 0).
--
--  Fase 2 · `reservas.cierre_auto` + índice del barrido diario.
--  Fase 3 · `p_forzar` en las tres RPC de alta/edición: el sistema avisa,
--           no bloquea, cuando quien decide es el dueño (misma filosofía que
--           `permitir_negativo` del TPV).
--  Fase 4 · `reserva_franjas.max_reservas`: 40 plazas no son 10 mesas de 4.
--           Y `res_slots_aforo` pasa de una consulta POR HUECO a una sola
--           lectura por día.
-- ================================================================

-- ── Fase 2: el barrido diario ────────────────────────────────────────────────

-- Marca de que ATENDIDA la puso el sistema y no el dueño. Sin esto la pantalla
-- diría «Atendió» sobre algo que nadie ha confirmado: un dato inventado.
alter table reservas add column if not exists cierre_auto boolean not null default false;

-- El barrido filtra por (client_id, fecha, estado). Había `idx_res_fecha` e
-- `idx_res_estado` sueltos, que obligan a un bitmap-and o a un seq scan.
create index if not exists idx_res_client_fecha_estado on reservas (client_id, fecha, estado);

-- Marca de que el dueño la metió saltándose alguna regla. Sin esto, su aforo dice
-- 41 de 40 y no hay forma de saber por qué.
alter table reservas add column if not exists forzada boolean not null default false;

-- ── Fase 4.1: tope de reservas (no de personas) por franja ───────────────────

-- 0 = sin tope, como el resto de reglas del módulo.
alter table reserva_franjas add column if not exists max_reservas int not null default 0;

-- ── Fase 3: fuera las firmas viejas ──────────────────────────────────────────
--
-- `create or replace` con un parámetro MÁS no reemplaza: crea una sobrecarga. Y
-- con dos versiones vivas, una llamada de 11 argumentos encaja en las dos
-- («function is not unique») y PostgREST deja de resolver el nombre. Se tiran
-- primero, y por eso esta migración no es reversible a medias: o entera, o nada.

drop function if exists res_crear_reserva(text, text, date, time, int, text, text, text, text, boolean, text);
drop function if exists res_crear_cita(text, text, text, date, time, text, text, text, text, boolean, text);
drop function if exists res_modificar_reserva(text, text, text, date, time, int, text, text, text);

-- ── Fase 3 + 4.1: crear reserva de aforo ─────────────────────────────────────

create or replace function res_crear_reserva(
  p_client_id               text,
  p_franja_id               text,
  p_fecha                   date,
  p_hora                    time without time zone,
  p_personas                integer,
  p_nombre_cliente          text,
  p_telefono                text,
  p_notas                   text,
  p_canal                   text,
  p_confirmacion_automatica boolean,
  p_reserva_id              text,
  p_forzar                  boolean default false
) returns jsonb language plpgsql as $function$
declare
  v_franja        record;
  v_hora_fin      time;
  v_total_ocupado int;
  v_n_reservas    int;
  v_regla_err     text;
  v_avisos        jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtext(p_client_id || ':' || p_franja_id || ':' || p_fecha::text));

  -- Integridad: esto NO lo salta ni el dueño. El turno tiene que existir y ser suyo.
  select capacidad, duracion_minutos, dias_semana, activa, max_reservas into v_franja
  from reserva_franjas
  where franja_id = p_franja_id and client_id = p_client_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Turno no encontrado.');
  end if;
  if not v_franja.activa then
    if not p_forzar then
      return jsonb_build_object('ok', false, 'error', 'Turno no encontrado o inactivo.', 'forzable', true);
    end if;
    v_avisos := v_avisos || to_jsonb('Ese turno está desactivado.'::text);
  end if;

  if res_cerrado(p_client_id, p_fecha) then
    if not p_forzar then
      return jsonb_build_object('ok', false, 'error', 'El negocio está cerrado ese día.', 'forzable', true);
    end if;
    v_avisos := v_avisos || to_jsonb('Ese día el negocio figura cerrado.'::text);
  end if;

  v_regla_err := res_reglas_check(p_client_id, p_fecha, p_hora, p_personas);
  if v_regla_err is not null then
    if not p_forzar then
      return jsonb_build_object('ok', false, 'error', v_regla_err, 'forzable', true);
    end if;
    v_avisos := v_avisos || to_jsonb(v_regla_err);
  end if;

  if v_franja.dias_semana is not null
     and array_length(v_franja.dias_semana, 1) is not null
     and not (extract(isodow from p_fecha)::int = any (v_franja.dias_semana)) then
    if not p_forzar then
      return jsonb_build_object('ok', false, 'error', 'Ese turno no atiende ese día de la semana.', 'forzable', true);
    end if;
    v_avisos := v_avisos || to_jsonb('Ese turno no atiende ese día de la semana.'::text);
  end if;

  v_hora_fin := (p_hora + (v_franja.duracion_minutos || ' minutes')::interval)::time;

  select coalesce(sum(personas), 0), count(*) into v_total_ocupado, v_n_reservas
  from reservas
  where franja_id = p_franja_id and client_id = p_client_id and fecha = p_fecha
    and estado in ('PENDIENTE', 'CONFIRMADA')
    and hora < v_hora_fin and hora_fin > p_hora;

  if v_total_ocupado + p_personas > v_franja.capacidad then
    if not p_forzar then
      return jsonb_build_object('ok', false, 'error',
        format('No hay capacidad suficiente para esa hora (%s de %s).', v_total_ocupado, v_franja.capacidad), 'forzable', true);
    end if;
    v_avisos := v_avisos || to_jsonb(
      format('El turno se pasa de aforo: %s de %s.', v_total_ocupado + p_personas, v_franja.capacidad)::text);
  end if;

  -- Tope de RESERVAS: 40 plazas no son 10 mesas de 4. Veinte parejas llenan el
  -- salón aunque «queden personas».
  if coalesce(v_franja.max_reservas, 0) > 0 and v_n_reservas + 1 > v_franja.max_reservas then
    if not p_forzar then
      return jsonb_build_object('ok', false, 'error',
        format('Ya hay %s reservas a esa hora, que es el máximo.', v_n_reservas), 'forzable', true);
    end if;
    v_avisos := v_avisos || to_jsonb(
      format('Se pasa del máximo de reservas a esa hora (%s de %s).', v_n_reservas + 1, v_franja.max_reservas)::text);
  end if;

  insert into reservas (reserva_id, client_id, franja_id, fecha, hora, hora_fin, personas,
                        nombre_cliente, telefono, notas, canal, estado, confirmacion_automatica,
                        forzada)
  values (p_reserva_id, p_client_id, p_franja_id, p_fecha, p_hora, v_hora_fin, p_personas,
          p_nombre_cliente, p_telefono, p_notas, p_canal,
          case when p_confirmacion_automatica then 'CONFIRMADA' else 'PENDIENTE' end,
          p_confirmacion_automatica,
          -- Forzada solo si de verdad se saltó algo: pulsar el botón sin infringir
          -- nada no convierte una reserva normal en una excepción.
          jsonb_array_length(v_avisos) > 0);

  return jsonb_build_object('ok', true, 'reserva_id', p_reserva_id, 'avisos', v_avisos);
end;
$function$;

-- ── Fase 3: crear cita ───────────────────────────────────────────────────────

create or replace function res_crear_cita(
  p_client_id               text,
  p_recurso_id              text,
  p_servicio_id             text,
  p_fecha                   date,
  p_hora                    time without time zone,
  p_nombre_cliente          text,
  p_telefono                text,
  p_notas                   text,
  p_canal                   text,
  p_confirmacion_automatica boolean,
  p_reserva_id              text,
  p_forzar                  boolean default false
) returns jsonb language plpgsql as $function$
declare
  v_dur       int;
  v_hora_fin  time;
  v_dow       int;
  v_solapa    int;
  v_regla_err text;
  v_avisos    jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtext(p_client_id || ':' || p_recurso_id || ':' || p_fecha::text));

  -- Integridad primero: sin servicio no hay duración que calcular.
  select duracion_minutos into v_dur
  from servicios where servicio_id = p_servicio_id and client_id = p_client_id and activo = true;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Servicio no disponible.');
  end if;

  if not exists (select 1 from recursos where recurso_id = p_recurso_id and client_id = p_client_id and activo = true) then
    return jsonb_build_object('ok', false, 'error', 'Profesional o recurso no disponible.');
  end if;

  if res_cerrado(p_client_id, p_fecha) then
    if not p_forzar then
      return jsonb_build_object('ok', false, 'error', 'El negocio está cerrado ese día.', 'forzable', true);
    end if;
    v_avisos := v_avisos || to_jsonb('Ese día el negocio figura cerrado.'::text);
  end if;

  v_regla_err := res_reglas_check(p_client_id, p_fecha, p_hora, 1);
  if v_regla_err is not null then
    if not p_forzar then
      return jsonb_build_object('ok', false, 'error', v_regla_err, 'forzable', true);
    end if;
    v_avisos := v_avisos || to_jsonb(v_regla_err);
  end if;

  if exists (select 1 from recurso_servicios where recurso_id = p_recurso_id)
     and not exists (select 1 from recurso_servicios where recurso_id = p_recurso_id and servicio_id = p_servicio_id) then
    if not p_forzar then
      return jsonb_build_object('ok', false, 'error', 'Ese profesional no presta este servicio.', 'forzable', true);
    end if;
    v_avisos := v_avisos || to_jsonb('Ese profesional no tiene asignado este servicio.'::text);
  end if;

  v_hora_fin := (p_hora + (v_dur || ' minutes')::interval)::time;
  v_dow := extract(isodow from p_fecha)::int;

  if exists (select 1 from recurso_horarios where recurso_id = p_recurso_id)
     and not exists (
       select 1 from recurso_horarios
       where recurso_id = p_recurso_id and dia_semana = v_dow
         and hora_inicio <= p_hora and hora_fin >= v_hora_fin
     ) then
    if not p_forzar then
      return jsonb_build_object('ok', false, 'error', 'Fuera del horario de atención.', 'forzable', true);
    end if;
    v_avisos := v_avisos || to_jsonb('Está fuera del horario de ese profesional.'::text);
  end if;

  select count(*) into v_solapa
  from reservas
  where recurso_id = p_recurso_id and client_id = p_client_id and fecha = p_fecha
    and estado in ('PENDIENTE', 'CONFIRMADA')
    and hora < v_hora_fin and hora_fin > p_hora;
  if v_solapa > 0 then
    if not p_forzar then
      return jsonb_build_object('ok', false, 'error', 'Ese horario ya está ocupado.', 'forzable', true);
    end if;
    v_avisos := v_avisos || to_jsonb('Ese profesional ya tiene otra cita a esa hora.'::text);
  end if;

  insert into reservas (reserva_id, client_id, franja_id, recurso_id, servicio_id, fecha, hora, hora_fin,
                        personas, nombre_cliente, telefono, notas, canal, estado, confirmacion_automatica,
                        forzada)
  values (p_reserva_id, p_client_id, null, p_recurso_id, p_servicio_id, p_fecha, p_hora, v_hora_fin,
          1, p_nombre_cliente, p_telefono, p_notas, p_canal,
          case when p_confirmacion_automatica then 'CONFIRMADA' else 'PENDIENTE' end,
          p_confirmacion_automatica,
          jsonb_array_length(v_avisos) > 0);

  return jsonb_build_object('ok', true, 'reserva_id', p_reserva_id, 'avisos', v_avisos);
end;
$function$;

-- ── Fase 3: modificar reserva de aforo ───────────────────────────────────────

create or replace function res_modificar_reserva(
  p_client_id      text,
  p_reserva_id     text,
  p_franja_id      text,
  p_fecha          date,
  p_hora           time,
  p_personas       int,
  p_nombre_cliente text,
  p_telefono       text,
  p_notas          text,
  p_forzar         boolean default false
) returns jsonb language plpgsql as $function$
declare
  v_franja        record;
  v_estado        text;
  v_hora_fin      time;
  v_total_ocupado int;
  v_n_reservas    int;
  v_avisos        jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtext(p_client_id || ':' || p_franja_id || ':' || p_fecha::text));

  select estado into v_estado
  from reservas
  where reserva_id = p_reserva_id and client_id = p_client_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Reserva no encontrada.');
  end if;
  if v_estado not in ('PENDIENTE', 'CONFIRMADA') then
    return jsonb_build_object('ok', false, 'error', 'Solo se pueden editar reservas pendientes o confirmadas.');
  end if;

  select capacidad, duracion_minutos, dias_semana, activa, max_reservas into v_franja
  from reserva_franjas
  where franja_id = p_franja_id and client_id = p_client_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Turno no encontrado.');
  end if;
  if not v_franja.activa and not p_forzar then
    return jsonb_build_object('ok', false, 'error', 'Turno no encontrado o inactivo.');
  end if;

  if v_franja.dias_semana is not null
     and array_length(v_franja.dias_semana, 1) is not null
     and not (extract(isodow from p_fecha)::int = any (v_franja.dias_semana)) then
    if not p_forzar then
      return jsonb_build_object('ok', false, 'error', 'Ese turno no atiende ese día de la semana.', 'forzable', true);
    end if;
    v_avisos := v_avisos || to_jsonb('Ese turno no atiende ese día de la semana.'::text);
  end if;

  v_hora_fin := (p_hora + (v_franja.duracion_minutos || ' minutes')::interval)::time;

  -- Solapamiento excluyendo la propia reserva
  select coalesce(sum(personas), 0), count(*) into v_total_ocupado, v_n_reservas
  from reservas
  where franja_id  = p_franja_id
    and client_id  = p_client_id
    and fecha      = p_fecha
    and reserva_id <> p_reserva_id
    and estado in ('PENDIENTE', 'CONFIRMADA')
    and hora    < v_hora_fin
    and hora_fin > p_hora;

  if v_total_ocupado + p_personas > v_franja.capacidad then
    if not p_forzar then
      return jsonb_build_object('ok', false, 'error',
        format('No hay capacidad suficiente para los nuevos datos (%s de %s).', v_total_ocupado, v_franja.capacidad), 'forzable', true);
    end if;
    v_avisos := v_avisos || to_jsonb(
      format('El turno se pasa de aforo: %s de %s.', v_total_ocupado + p_personas, v_franja.capacidad)::text);
  end if;

  if coalesce(v_franja.max_reservas, 0) > 0 and v_n_reservas + 1 > v_franja.max_reservas then
    if not p_forzar then
      return jsonb_build_object('ok', false, 'error',
        format('Ya hay %s reservas a esa hora, que es el máximo.', v_n_reservas), 'forzable', true);
    end if;
    v_avisos := v_avisos || to_jsonb(
      format('Se pasa del máximo de reservas a esa hora (%s de %s).', v_n_reservas + 1, v_franja.max_reservas)::text);
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
    forzada        = forzada or jsonb_array_length(v_avisos) > 0,
    updated_at     = now()
  where reserva_id = p_reserva_id and client_id = p_client_id;

  return jsonb_build_object('ok', true, 'reserva_id', p_reserva_id, 'avisos', v_avisos);
end;
$function$;

-- ── Fase 4.1 + 4.3: huecos de aforo, con los dos topes y UNA lectura por día ──
--
-- Antes: una subconsulta a `reservas` POR HUECO. Una franja de 12:00 a 24:00 son
-- 24 consultas, y `res_dias_disponibles_aforo` la llama día a día (hasta 60):
-- cientos de consultas por visita a una página pública, que es la frontera dura
-- de rendimiento del proyecto. Ahora las reservas vivas del día se leen UNA vez
-- y el solape se calcula en memoria.

create or replace function res_slots_aforo(p_client_id text, p_fecha date, p_personas int)
returns jsonb as $$
declare
  v_dow   int;
  v_now   timestamp := now() at time zone 'America/Havana';
  v_min   timestamp;
  r       record;
  f       record;
  v_t     int; v_end int; v_dur int; v_cap int; v_max int;
  v_hora  time; v_hora_fin time; v_k text;
  v_ocupado int; v_nres int; v_libre boolean;
  v_vivas jsonb;
  v_map   jsonb := '{}'::jsonb;
  v_out   jsonb;
begin
  if res_cerrado(p_client_id, p_fecha) then return '[]'::jsonb; end if;

  select reserva_antelacion_min_horas as a, reserva_ventana_max_dias as v into r
  from clients where client_id = p_client_id;
  if coalesce(r.v, 0) > 0 and p_fecha > (v_now::date + r.v) then return '[]'::jsonb; end if;
  v_min := v_now + make_interval(hours => coalesce(r.a, 0));

  v_dow := extract(isodow from p_fecha)::int;

  -- LA lectura del día: todas las reservas vivas de aforo de esa fecha.
  select coalesce(jsonb_agg(jsonb_build_object(
           'f', franja_id, 'h', hora, 'hf', hora_fin, 'p', personas)), '[]'::jsonb)
  into v_vivas
  from reservas
  where client_id = p_client_id and fecha = p_fecha
    and franja_id is not null
    and estado in ('PENDIENTE', 'CONFIRMADA')
    and hora is not null and hora_fin is not null;

  for f in
    select franja_id, hora_inicio, hora_fin, capacidad, duracion_minutos, dias_semana, max_reservas
    from reserva_franjas
    where client_id = p_client_id and activa = true
      and hora_inicio is not null and hora_fin is not null
    order by hora_inicio
  loop
    if f.dias_semana is not null and array_length(f.dias_semana, 1) is not null
       and not (v_dow = any (f.dias_semana)) then continue; end if;

    v_dur := coalesce(f.duracion_minutos, 60);
    v_cap := coalesce(f.capacidad, 1);
    v_max := coalesce(f.max_reservas, 0);
    v_t   := extract(hour from f.hora_inicio)::int * 60 + extract(minute from f.hora_inicio)::int;
    v_end := extract(hour from f.hora_fin)::int   * 60 + extract(minute from f.hora_fin)::int;

    while v_t < v_end loop
      v_hora     := make_time((v_t / 60)::int, (v_t % 60)::int, 0);
      v_hora_fin := (v_hora + (v_dur || ' minutes')::interval)::time;

      if (p_fecha + v_hora) >= v_min then
        select coalesce(sum((e ->> 'p')::int), 0), count(*)
          into v_ocupado, v_nres
        from jsonb_array_elements(v_vivas) e
        where e ->> 'f' = f.franja_id
          and (e ->> 'h')::time  <  v_hora_fin
          and (e ->> 'hf')::time >  v_hora;

        -- Libre = cabe la gente Y queda mesa/grupo que atender.
        v_libre := ((v_cap - v_ocupado) >= p_personas)
                   and (v_max = 0 or v_nres < v_max);
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

-- ── Permisos ─────────────────────────────────────────────────────────────────

grant execute on function res_crear_reserva(text, text, date, time, int, text, text, text, text, boolean, text, boolean) to service_role;
grant execute on function res_crear_cita(text, text, text, date, time, text, text, text, text, boolean, text, boolean)  to service_role;
grant execute on function res_modificar_reserva(text, text, text, date, time, int, text, text, text, boolean)           to service_role;
grant execute on function res_slots_aforo(text, date, int) to service_role;

notify pgrst, 'reload schema';
