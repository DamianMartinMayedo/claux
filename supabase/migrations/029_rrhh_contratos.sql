-- ================================================================
-- MIGRACIÓN 029: RRHH · Contratos (historial) — Fase 5 · Tanda 3
--
-- Historial de contratos por empleado (altas, renovaciones, cambios de
-- salario con fecha). NO sustituye al snapshot del empleado: la nómina
-- sigue leyendo empleados.salario_base/moneda/tipo_contrato/periodicidad
-- (el "contrato vigente"). Este historial es paralelo y trazable.
--
-- "Nuevo contrato" cierra el vigente (fecha_fin) y actualiza el snapshot
-- del empleado. Estado VIGENTE/Finalizado se DERIVA de fecha_fin.
--
-- Numeración: CON-XXXXXXXX.
-- ================================================================

create table if not exists contratos (
  contrato_id    text          primary key,                -- CON-XXXXXXXX
  client_id      text          not null,
  empleado_id    text          not null,
  tipo_contrato  text          not null default 'INDEFINIDO',
  fecha_inicio   date          not null default current_date,
  fecha_fin      date,                                     -- NULL = vigente
  salario_base   numeric(18,2) not null default 0,
  moneda         text          not null,
  periodicidad   text          not null default 'MENSUAL',
  notas          text,
  created_at     timestamptz   not null default now()
);

create index if not exists idx_con_client   on contratos (client_id);
create index if not exists idx_con_empleado on contratos (empleado_id);
create index if not exists idx_con_fin      on contratos (fecha_fin);

alter table public.contratos enable row level security;
grant select, insert, update, delete on public.contratos to service_role;

-- Backfill: un contrato vigente por cada empleado existente, desde su snapshot.
insert into contratos (contrato_id, client_id, empleado_id, tipo_contrato, fecha_inicio, fecha_fin, salario_base, moneda, periodicidad, notas)
select
  'CON-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  e.client_id, e.empleado_id, e.tipo_contrato, e.fecha_alta, e.fecha_baja,
  e.salario_base, e.moneda, e.periodicidad, 'Contrato inicial (migrado)'
from empleados e
where not exists (select 1 from contratos c where c.empleado_id = e.empleado_id);

notify pgrst, 'reload schema';
