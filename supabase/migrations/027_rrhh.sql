-- ================================================================
-- MIGRACIÓN 027: RRHH · Personal (módulo rrhh, Fase 5 · Tanda 1)
--
-- Tabla de empleados del tenant. Cubre "Personal, contratos y bajas":
--   · Datos personales y de contacto.
--   · Datos de contrato: tipo, fecha de alta, salario base, moneda,
--     periodicidad de pago. "Turno" se guarda como texto simple
--     (Mañana/Tarde/Noche/Rotativo); no hay planificador de turnos.
--   · Baja: fecha_baja (NULL = activo) + motivo_baja.
--
-- El estado ACTIVO/BAJA NO se almacena: se DERIVA de fecha_baja.
--
-- Multi-tenant por client_id + empresa_id (sin RLS por tenant: toda
-- query filtra por client_id en la capa de servicio, como el resto).
--
-- La nómina (que consume estos empleados y vuelca un GASTO "Salarios"
-- en gastos_cobros) llega en la Tanda 2 (migración 028).
--
-- Numeración interna: PER-XXXXXXXX (UUID corto).
-- ================================================================

create table if not exists empleados (
  empleado_id    text          primary key,                -- PER-XXXXXXXX
  client_id      text          not null,
  empresa_id     text          not null,

  -- Datos personales
  nombre         text          not null,
  apellidos      text,
  documento      text,                                     -- CI / identidad
  telefono       text,
  email          text,
  direccion      text,

  -- Puesto
  cargo          text,
  departamento   text,
  turno          text,                                     -- Mañana | Tarde | Noche | Rotativo (libre)

  -- Contrato
  tipo_contrato  text          not null default 'INDEFINIDO', -- INDEFINIDO | TEMPORAL | POR_OBRA | PRACTICAS
  fecha_alta     date          not null default current_date,
  salario_base   numeric(18,2) not null default 0,
  moneda         text          not null,
  periodicidad   text          not null default 'MENSUAL',    -- MENSUAL | QUINCENAL | SEMANAL | POR_HORA

  -- Baja
  fecha_baja     date,                                     -- NULL = activo
  motivo_baja    text,

  notas          text,
  created_at     timestamptz   not null default now(),
  updated_at     timestamptz   not null default now()
);

create index if not exists idx_emp_client    on empleados (client_id);
create index if not exists idx_emp_empresa   on empleados (empresa_id);
create index if not exists idx_emp_baja      on empleados (fecha_baja);
create index if not exists idx_emp_documento on empleados (documento);

alter table public.empleados enable row level security;
grant select, insert, update, delete on public.empleados to service_role;

notify pgrst, 'reload schema';
