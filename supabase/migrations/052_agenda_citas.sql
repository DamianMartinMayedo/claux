-- ================================================================
-- MIGRACIÓN 052: Módulo Citas (agenda) — esquema y RPC atómica
--
-- Citas por recurso/profesional: reservas de 1 plaza sobre un recurso concreto
-- (peluquero, sala, cancha…) para un servicio con duración. Reutiliza la tabla
-- `reservas` (misma máquina de estados, notificaciones y canal que aforo): una
-- fila es de AFORO (franja_id) o de AGENDA (recurso_id + servicio_id).
--
-- Concurrencia: mismo patrón verificado que res_crear_reserva (049) —
-- pg_advisory_xact_lock por (negocio, recurso, fecha) + check de solape.
-- ================================================================

-- ── Recursos (profesional / sala / cancha…) ──────────────────────────────────
create table if not exists recursos (
  recurso_id text primary key,                 -- REC-XXXXXXXX
  client_id  text not null,
  nombre     text not null,
  tipo       text,                              -- libre: 'profesional','sala','cancha'…
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_recursos_client on recursos (client_id);

-- ── Servicios (duración + precio opcional) ───────────────────────────────────
create table if not exists servicios (
  servicio_id      text primary key,            -- SER-XXXXXXXX
  client_id        text not null,
  nombre           text not null,
  duracion_minutos int  not null default 30,
  precio           numeric(12,2),
  activo           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_servicios_client on servicios (client_id);

-- ── Qué recurso presta qué servicio (sin filas para un recurso = presta todos) ─
create table if not exists recurso_servicios (
  recurso_id  text not null,
  servicio_id text not null,
  primary key (recurso_id, servicio_id)
);

-- ── Horario semanal de cada recurso (varias franjas por día) ─────────────────
create table if not exists recurso_horarios (
  horario_id  text primary key,                 -- RHO-XXXXXXXX
  recurso_id  text not null,
  client_id   text not null,
  dia_semana  int  not null,                     -- 1=Lun … 7=Dom
  hora_inicio time not null,
  hora_fin    time not null
);
create index if not exists idx_rh_recurso on recurso_horarios (recurso_id);

-- ── reservas: reutilizar para citas; franja_id pasa a opcional ───────────────
alter table reservas alter column franja_id drop not null;
alter table reservas add column if not exists recurso_id  text;
alter table reservas add column if not exists servicio_id text;
create index if not exists idx_res_recurso on reservas (recurso_id);
alter table reservas drop constraint if exists chk_reserva_tipo;
alter table reservas add constraint chk_reserva_tipo
  check (franja_id is not null or recurso_id is not null);

-- ── RLS + grants (patrón del proyecto: acceso vía service_role) ──────────────
alter table public.recursos          enable row level security;
alter table public.servicios         enable row level security;
alter table public.recurso_servicios enable row level security;
alter table public.recurso_horarios  enable row level security;
grant select, insert, update, delete on public.recursos          to service_role;
grant select, insert, update, delete on public.servicios         to service_role;
grant select, insert, update, delete on public.recurso_servicios to service_role;
grant select, insert, update, delete on public.recurso_horarios  to service_role;

-- ── RPC atómica: crear cita ──────────────────────────────────────────────────
create or replace function res_crear_cita(
  p_client_id              text,
  p_recurso_id             text,
  p_servicio_id            text,
  p_fecha                  date,
  p_hora                   time,
  p_nombre_cliente         text,
  p_telefono               text,
  p_notas                  text,
  p_canal                  text,
  p_confirmacion_automatica boolean,
  p_reserva_id             text
) returns jsonb as $$
declare
  v_dur      int;
  v_hora_fin time;
  v_dow      int;
  v_solapa   int;
begin
  perform pg_advisory_xact_lock(hashtext(p_client_id || ':' || p_recurso_id || ':' || p_fecha::text));

  -- Servicio activo + duración
  select duracion_minutos into v_dur
  from servicios where servicio_id = p_servicio_id and client_id = p_client_id and activo = true;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Servicio no disponible.');
  end if;

  -- Recurso activo
  if not exists (select 1 from recursos where recurso_id = p_recurso_id and client_id = p_client_id and activo = true) then
    return jsonb_build_object('ok', false, 'error', 'Profesional o recurso no disponible.');
  end if;

  -- Si el recurso tiene servicios asignados, el pedido debe estar entre ellos
  if exists (select 1 from recurso_servicios where recurso_id = p_recurso_id)
     and not exists (select 1 from recurso_servicios where recurso_id = p_recurso_id and servicio_id = p_servicio_id) then
    return jsonb_build_object('ok', false, 'error', 'Ese profesional no presta este servicio.');
  end if;

  v_hora_fin := (p_hora + (v_dur || ' minutes')::interval)::time;
  v_dow := extract(isodow from p_fecha)::int;

  -- Si el recurso tiene horario definido, la cita debe caber dentro de una franja de ese día
  if exists (select 1 from recurso_horarios where recurso_id = p_recurso_id)
     and not exists (
       select 1 from recurso_horarios
       where recurso_id = p_recurso_id and dia_semana = v_dow
         and hora_inicio <= p_hora and hora_fin >= v_hora_fin
     ) then
    return jsonb_build_object('ok', false, 'error', 'Fuera del horario de atención.');
  end if;

  -- Solape: el recurso no puede tener otra cita que pise el rango
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
$$ language plpgsql;

grant execute on function res_crear_cita(text, text, text, date, time, text, text, text, text, boolean, text) to service_role;

notify pgrst, 'reload schema';
