-- ================================================================
-- MIGRACIÓN 028: RRHH · Nómina simple (módulo rrhh, Fase 5 · Tanda 2)
--
-- Una nómina agrupa el pago del personal de una empresa en un período.
-- Cada línea = un empleado con su devengado, deducciones y neto.
--
-- INTEGRACIÓN CON LA BASE CONTABLE (decisión de diseño):
--   Al CONFIRMAR una nómina se crea automáticamente un registro GASTO
--   ("Salarios") en gastos_cobros con monto = Σ netos. Ese gasto fluye
--   a CxP, se paga desde Tesorería (liquidación unificada ya existente)
--   y aparece en Reportes. La nómina guarda gasto_id como referencia.
--   RRHH depende de la base (permitido); la base nunca depende de RRHH.
--
-- Estados: BORRADOR (editable) | CONFIRMADA (genera el gasto, bloqueada).
--
-- Numeración: NOM-XXXXXXXX (nómina) · NLN-XXXXXXXX (línea).
-- ================================================================

create table if not exists nominas (
  nomina_id    text          primary key,                -- NOM-XXXXXXXX
  client_id    text          not null,
  empresa_id   text          not null,

  periodo      text          not null,                   -- YYYY-MM
  fecha        date          not null default current_date,
  moneda       text          not null,
  estado       text          not null default 'BORRADOR', -- BORRADOR | CONFIRMADA
  gasto_id     text,                                      -- referencia a gastos_cobros.registro_id (NULL hasta confirmar)
  total        numeric(18,2) not null default 0,          -- Σ netos

  notas        text,
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now()
);

create table if not exists nomina_lineas (
  linea_id        text          primary key,             -- NLN-XXXXXXXX
  nomina_id       text          not null,
  client_id       text          not null,
  empleado_id     text          not null,
  empleado_nombre text          not null,                -- snapshot
  cargo           text,                                  -- snapshot
  salario_base    numeric(18,2) not null default 0,
  devengado       numeric(18,2) not null default 0,
  deducciones     numeric(18,2) not null default 0,
  neto            numeric(18,2) not null default 0,
  notas           text,
  created_at      timestamptz   not null default now()
);

create index if not exists idx_nom_client   on nominas (client_id);
create index if not exists idx_nom_empresa  on nominas (empresa_id);
create index if not exists idx_nom_periodo  on nominas (periodo);
create index if not exists idx_nom_gasto    on nominas (gasto_id);

create index if not exists idx_nl_nomina    on nomina_lineas (nomina_id);
create index if not exists idx_nl_client    on nomina_lineas (client_id);
create index if not exists idx_nl_empleado  on nomina_lineas (empleado_id);

alter table public.nominas       enable row level security;
alter table public.nomina_lineas enable row level security;
grant select, insert, update, delete on public.nominas       to service_role;
grant select, insert, update, delete on public.nomina_lineas to service_role;

notify pgrst, 'reload schema';
