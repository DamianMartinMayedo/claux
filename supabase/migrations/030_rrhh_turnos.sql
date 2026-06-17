-- ================================================================
-- MIGRACIÓN 030: RRHH · Turnos (planificador semanal) — Fase 5 · Tanda 4
--
-- Catálogo de turnos por empresa + asignación semanal recurrente:
--   turnos              → definiciones (nombre, horario, color) por empresa
--   turno_asignaciones  → un turno por (empleado, día de la semana)
--
-- dia_semana: 1=Lunes … 7=Domingo. Único por (empleado_id, dia_semana):
-- un empleado tiene como mucho un turno asignado por día.
--
-- Numeración: TUR-XXXXXXXX (turno) · TAS-XXXXXXXX (asignación).
-- ================================================================

create table if not exists turnos (
  turno_id     text        primary key,                  -- TUR-XXXXXXXX
  client_id    text        not null,
  empresa_id   text        not null,
  nombre       text        not null,
  hora_inicio  time,
  hora_fin     time,
  color        text,
  activo       boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists turno_asignaciones (
  asignacion_id text        primary key,                 -- TAS-XXXXXXXX
  client_id     text        not null,
  empleado_id   text        not null,
  dia_semana    int         not null,                    -- 1=Lunes … 7=Domingo
  turno_id      text        not null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_tur_client  on turnos (client_id);
create index if not exists idx_tur_empresa on turnos (empresa_id);

create index        if not exists idx_tas_client    on turno_asignaciones (client_id);
create index        if not exists idx_tas_empleado  on turno_asignaciones (empleado_id);
create unique index if not exists uq_tas_emp_dia    on turno_asignaciones (empleado_id, dia_semana);

alter table public.turnos             enable row level security;
alter table public.turno_asignaciones enable row level security;
grant select, insert, update, delete on public.turnos             to service_role;
grant select, insert, update, delete on public.turno_asignaciones to service_role;

notify pgrst, 'reload schema';
