-- ================================================================
-- MIGRACIÓN 174: Citas — mover una cita, ausencias del profesional y
--                margen entre citas.
--
-- Plan: docs/planes/reservas-citas-correcciones.md (fase 5).
--
--  5.1 `res_modificar_cita` — hermana de `res_modificar_reserva`. No existía:
--      «¿me lo pasas a las 5?» obligaba a CANCELAR (con su aviso de
--      cancelación al cliente, que es un mensaje equivocado) y crear otra.
--  5.2 `recurso_ausencias` + `res_ausente()` — que un barbero libre el martes
--      obligaba a cerrar la barbería entera, porque `reserva_cierres` es del
--      NEGOCIO.
--  5.3 `servicios.margen_minutos` — las citas iban espalda con espalda: la
--      agenda que el software decía que cabía, no cabía. El margen se aplica a
--      la OCUPACIÓN, nunca a lo que se le enseña al cliente ni al precio.
-- ================================================================

-- ── 5.2 Ausencias por profesional ────────────────────────────────────────────

create table if not exists recurso_ausencias (
  ausencia_id  text primary key,
  client_id    text not null references clients(client_id),
  recurso_id   text not null references recursos(recurso_id),
  fecha_desde  date not null,
  fecha_hasta  date not null,
  motivo       text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_recurso_ausencias_rec  on recurso_ausencias (recurso_id, fecha_desde, fecha_hasta);
create index if not exists idx_recurso_ausencias_cli  on recurso_ausencias (client_id);

-- Tabla nueva ⇒ RLS con política, o en producción no carga en el admin (el local
-- lo enmascara porque el service_role hace bypass). Mismo patrón que el resto.
alter table recurso_ausencias enable row level security;
drop policy if exists admin_full_access on recurso_ausencias;
create policy admin_full_access on recurso_ausencias for all to authenticated using (true) with check (true);

-- Mismo patrón que `res_cerrado`, pero de UN profesional.
create or replace function res_ausente(p_recurso_id text, p_fecha date)
returns boolean as $$
  select exists (
    select 1 from recurso_ausencias
    where recurso_id = p_recurso_id
      and fecha_desde <= p_fecha and fecha_hasta >= p_fecha
  );
$$ language sql stable;

grant execute on function res_ausente(text, date) to service_role;

-- ── 5.3 Margen entre citas ───────────────────────────────────────────────────

-- 0 = sin margen, o sea el comportamiento de hoy.
alter table servicios add column if not exists margen_minutos int not null default 0;

-- ── 5.1 + 5.2 + 5.3: huecos de cita ──────────────────────────────────────────
--
-- El margen NO se guarda en `hora_fin` (que es lo que ve el cliente: «Corte de
-- pelo · 30 min»), así que el solape se calcula ensanchando la comparación por
-- los dos lados. Y el reloj avanza `duración + margen` entre hueco y hueco.

create or replace function res_slots_cita(p_client_id text, p_servicio_id text, p_recurso_id text, p_fecha date)
returns jsonb language plpgsql as $function$
declare
  v_dur        int;
  v_margen     int;
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
  select duracion_minutos, coalesce(margen_minutos, 0) into v_dur, v_margen
  from servicios where servicio_id = p_servicio_id and client_id = p_client_id and activo = true;
  if not found or v_dur < 1 then return '[]'::jsonb; end if;

  if res_cerrado(p_client_id, p_fecha) then return '[]'::jsonb; end if;

  select coalesce(reserva_antelacion_min_horas, 0), coalesce(reserva_ventana_max_dias, 0)
    into v_antelacion, v_ventana
  from clients where client_id = p_client_id;

  if coalesce(v_ventana, 0) > 0 and p_fecha > (v_now_local::date + v_ventana) then
    return '[]'::jsonb;
  end if;

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
    -- Ese profesional está de baja/vacaciones ese día: no ofrece nada, y el resto
    -- del negocio sigue funcionando.
    if res_ausente(r_rec.recurso_id, p_fecha) then continue; end if;

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
               -- Ensanchado por el margen: entre cliente y cliente hay que limpiar,
               -- cobrar y despedir. El cliente no ve estos minutos.
               and hora < (v_hora_fin + make_interval(mins => v_margen))
               and (hora_fin + make_interval(mins => v_margen)) > v_hora
           ) then
          v_result := v_result || jsonb_build_object(
            'recurso_id', r_rec.recurso_id,
            'recurso_nombre', r_rec.nombre,
            'hora', to_char(v_hora, 'HH24:MI')
          );
        end if;

        v_t := v_t + v_dur + v_margen;
      end loop;
    end loop;
  end loop;

  return v_result;
end;
$function$;

grant execute on function res_slots_cita(text, text, text, date) to service_role;

-- ── res_crear_cita: ausencias + margen (sobre la 173, que trajo p_forzar) ─────

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
  v_margen    int;
  v_hora_fin  time;
  v_dow       int;
  v_solapa    int;
  v_regla_err text;
  v_avisos    jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtext(p_client_id || ':' || p_recurso_id || ':' || p_fecha::text));

  select duracion_minutos, coalesce(margen_minutos, 0) into v_dur, v_margen
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

  if res_ausente(p_recurso_id, p_fecha) then
    if not p_forzar then
      return jsonb_build_object('ok', false, 'error', 'Ese profesional no está disponible ese día.', 'forzable', true);
    end if;
    v_avisos := v_avisos || to_jsonb('Ese profesional figura ausente ese día.'::text);
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
    and hora < (v_hora_fin + make_interval(mins => v_margen))
    and (hora_fin + make_interval(mins => v_margen)) > p_hora;
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

-- ── 5.1 res_modificar_cita ───────────────────────────────────────────────────
--
-- Hermana exacta de `res_modificar_reserva`: mismo lock, mismas comprobaciones
-- que el alta, excluyendo la propia cita del solape.

create or replace function res_modificar_cita(
  p_client_id      text,
  p_reserva_id     text,
  p_recurso_id     text,
  p_servicio_id    text,
  p_fecha          date,
  p_hora           time without time zone,
  p_nombre_cliente text,
  p_telefono       text,
  p_notas          text,
  p_forzar         boolean default false
) returns jsonb language plpgsql as $function$
declare
  v_dur       int;
  v_margen    int;
  v_estado    text;
  v_hora_fin  time;
  v_dow       int;
  v_solapa    int;
  v_regla_err text;
  v_avisos    jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtext(p_client_id || ':' || p_recurso_id || ':' || p_fecha::text));

  select estado into v_estado
  from reservas
  where reserva_id = p_reserva_id and client_id = p_client_id and recurso_id is not null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Cita no encontrada.');
  end if;
  if v_estado not in ('PENDIENTE', 'CONFIRMADA') then
    return jsonb_build_object('ok', false, 'error', 'Solo se pueden editar citas pendientes o confirmadas.');
  end if;

  select duracion_minutos, coalesce(margen_minutos, 0) into v_dur, v_margen
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

  if res_ausente(p_recurso_id, p_fecha) then
    if not p_forzar then
      return jsonb_build_object('ok', false, 'error', 'Ese profesional no está disponible ese día.', 'forzable', true);
    end if;
    v_avisos := v_avisos || to_jsonb('Ese profesional figura ausente ese día.'::text);
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
    and reserva_id <> p_reserva_id
    and estado in ('PENDIENTE', 'CONFIRMADA')
    and hora < (v_hora_fin + make_interval(mins => v_margen))
    and (hora_fin + make_interval(mins => v_margen)) > p_hora;
  if v_solapa > 0 then
    if not p_forzar then
      return jsonb_build_object('ok', false, 'error', 'Ese horario ya está ocupado.', 'forzable', true);
    end if;
    v_avisos := v_avisos || to_jsonb('Ese profesional ya tiene otra cita a esa hora.'::text);
  end if;

  update reservas set
    recurso_id     = p_recurso_id,
    servicio_id    = p_servicio_id,
    fecha          = p_fecha,
    hora           = p_hora,
    hora_fin       = v_hora_fin,
    nombre_cliente = p_nombre_cliente,
    telefono       = p_telefono,
    notas          = p_notas,
    forzada        = forzada or jsonb_array_length(v_avisos) > 0,
    updated_at     = now()
  where reserva_id = p_reserva_id and client_id = p_client_id;

  return jsonb_build_object('ok', true, 'reserva_id', p_reserva_id, 'avisos', v_avisos);
end;
$function$;

grant execute on function res_crear_cita(text, text, text, date, time, text, text, text, text, boolean, text, boolean) to service_role;
grant execute on function res_modificar_cita(text, text, text, text, date, time, text, text, text, boolean)          to service_role;

-- ── Purga del tenant ─────────────────────────────────────────────────────────
-- Memoria `listas-a-mano-derivan`: `eliminar_cliente` se queda corta con cada
-- tabla nueva, en silencio. El centinela `tablas_tenant_sin_purgar()` la caza,
-- pero solo si alguien lo corre — así que la tabla entra ahora.
create or replace function eliminar_cliente(p_client_id text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from clients where client_id = p_client_id) then
    raise exception 'El cliente % no existe.', p_client_id;
  end if;

  if exists (select 1 from payments where client_id = p_client_id and estado = 'confirmado') then
    raise exception 'El cliente % tiene pagos confirmados; no se puede borrar (archívalo).', p_client_id;
  end if;

  delete from caja_turno_movimientos    where client_id = p_client_id;
  delete from caja_ticket_lineas        where client_id = p_client_id;
  delete from caja_tickets              where client_id = p_client_id;
  delete from caja_sesiones             where client_id = p_client_id;
  delete from cajas                     where client_id = p_client_id;
  delete from ofertas                   where client_id = p_client_id;
  delete from facturas                  where client_id = p_client_id;
  delete from compra_lineas             where client_id = p_client_id;
  delete from compras                   where client_id = p_client_id;
  delete from conteo_lineas             where client_id = p_client_id;
  delete from conteos                   where client_id = p_client_id;
  delete from movimientos_inventario    where client_id = p_client_id;
  delete from stock_almacenes           where client_id = p_client_id;
  delete from producto_almacen_config   where client_id = p_client_id;
  delete from producto_precios_historial where client_id = p_client_id;
  delete from movimientos_tesoreria     where client_id = p_client_id;
  delete from gastos_cobros             where client_id = p_client_id;
  delete from cuentas                   where client_id = p_client_id;

  delete from nomina_gasto_mapeo        where client_id = p_client_id;
  delete from categorias_gastos         where client_id = p_client_id;

  delete from suscripciones             where client_id = p_client_id;

  delete from dossier_lineas            where client_id = p_client_id;
  delete from dossier_secciones         where client_id = p_client_id;
  delete from dossier_serie             where client_id = p_client_id;
  delete from dossiers                  where client_id = p_client_id;
  delete from dossier_costo_ventas      where client_id = p_client_id;

  delete from nomina_linea_conceptos    where client_id = p_client_id;
  delete from nomina_lineas             where client_id = p_client_id;
  delete from nominas                   where client_id = p_client_id;
  delete from incidencias_nomina        where client_id = p_client_id;
  delete from conceptos_empleado        where client_id = p_client_id;
  delete from deducciones_reglas        where client_id = p_client_id;
  delete from empresa_config_nomina     where client_id = p_client_id;
  delete from turno_asignaciones        where client_id = p_client_id;
  delete from turnos                    where client_id = p_client_id;
  delete from contratos                 where client_id = p_client_id;
  delete from empleados                 where client_id = p_client_id;
  delete from recurso_ausencias         where client_id = p_client_id;
  delete from recurso_horarios          where client_id = p_client_id;
  delete from reserva_franjas           where client_id = p_client_id;
  delete from reserva_cierres           where client_id = p_client_id;
  delete from reservas                  where client_id = p_client_id;
  delete from servicios                 where client_id = p_client_id;
  delete from recursos                  where client_id = p_client_id;
  delete from catalogo_items            where client_id = p_client_id;
  delete from catalogo_categorias       where client_id = p_client_id;
  delete from product_categories        where client_id = p_client_id;
  delete from products                  where client_id = p_client_id;
  delete from almacenes                 where client_id = p_client_id;
  delete from tasas_cambio              where client_id = p_client_id;
  delete from pares_tasa                where client_id = p_client_id;
  delete from monedas                   where client_id = p_client_id;
  delete from third_parties             where client_id = p_client_id;
  delete from ia_uso                    where client_id = p_client_id;
  delete from ia_conversaciones         where client_id = p_client_id;
  delete from consecutivos_venta        where client_id = p_client_id;
  delete from consecutivos_compra       where client_id = p_client_id;
  delete from telegram_updates          where client_id = p_client_id;
  delete from telegram_sessions         where client_id = p_client_id;
  delete from soporte_mensajes          where client_id = p_client_id;
  delete from presupuestos_instalacion  where client_id = p_client_id;

  delete from import_lotes              where client_id = p_client_id;

  delete from asesores                  where client_id = p_client_id;
  delete from uso_portal                where client_id = p_client_id;

  delete from payments                  where client_id = p_client_id;
  delete from empresas                  where client_id = p_client_id;
  delete from client_users              where client_id = p_client_id;
  delete from clients                   where client_id = p_client_id;
end;
$function$;

notify pgrst, 'reload schema';
