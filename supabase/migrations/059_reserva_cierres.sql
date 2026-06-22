-- ================================================================
-- MIGRACIÓN 059: Cierres y festivos del negocio
--
-- Fechas en las que el negocio NO acepta reservas ni citas (festivos, vacaciones,
-- cierres puntuales). Un rango [fecha_desde, fecha_hasta] (mismo día = puntual).
-- Compartido por Reservas (aforo) y Citas (agenda): el cierre es del negocio.
-- ================================================================

create table if not exists reserva_cierres (
  cierre_id   text primary key,                 -- CIE-XXXXXXXX
  client_id   text not null,
  fecha_desde date not null,
  fecha_hasta date not null,
  motivo      text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_cierres_client on reserva_cierres (client_id, fecha_desde, fecha_hasta);

alter table public.reserva_cierres enable row level security;
grant select, insert, update, delete on public.reserva_cierres to service_role;

-- Helper: ¿el negocio está cerrado esa fecha?
create or replace function res_cerrado(p_client_id text, p_fecha date) returns boolean as $$
  select exists (
    select 1 from reserva_cierres
    where client_id = p_client_id and p_fecha between fecha_desde and fecha_hasta
  );
$$ language sql stable;

grant execute on function res_cerrado(text, date) to service_role;

notify pgrst, 'reload schema';
