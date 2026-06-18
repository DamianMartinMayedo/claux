-- ================================================================
-- MIGRACIÓN 034: RRHH · Conceptos recurrentes por empleado — Fase 5
--
-- Bonos y deducciones FIJOS de cada trabajador (p. ej. -10% seguridad
-- social, +500 bono transporte). Al generar una nómina se aplican solos
-- a la línea del empleado, para no teclear cada mes.
--
--   tipo:  BONO (suma al devengado) | DEDUCCION (suma a deducciones)
--   modo:  FIJO (importe) | PORCENTAJE (% del salario base)
--
-- Numeración: CPT-XXXXXXXX.
-- ================================================================

create table if not exists conceptos_empleado (
  concepto_id text          primary key,                -- CPT-XXXXXXXX
  client_id   text          not null,
  empleado_id text          not null,
  nombre      text          not null,
  tipo        text          not null,                   -- BONO | DEDUCCION
  modo        text          not null default 'FIJO',    -- FIJO | PORCENTAJE
  valor       numeric(18,2) not null default 0,
  activo      boolean       not null default true,
  created_at  timestamptz   not null default now()
);

create index if not exists idx_cpt_client   on conceptos_empleado (client_id);
create index if not exists idx_cpt_empleado on conceptos_empleado (empleado_id);

alter table public.conceptos_empleado enable row level security;
grant select, insert, update, delete on public.conceptos_empleado to service_role;

notify pgrst, 'reload schema';
