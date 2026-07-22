-- ================================================================
-- MIGRACIÓN 128: Tablas del importador de datos
--
-- Infraestructura del importador (migración masiva por CSV; lo opera el
-- equipo CLAUX vía impersonación). NO se ensucian las tablas de negocio
-- con columnas import_*; la traza vive en tablas propias.
--   import_lotes       — un lote por importación (estado + mapeo + contadores)
--   import_lote_items  — traza fila a fila (idempotencia + deshacer + informe)
--   import_plantillas  — mapeos reutilizables (globales del equipo)
--
-- RLS activado + grant a service_role (como el resto del portal): el acceso
-- es solo server-side vía createAdminClient (service_role bypassea RLS);
-- con RLS puesta, anon/authenticated no ven nada por la API pública.
-- ================================================================

create table if not exists import_lotes (
  lote_id      text primary key,                     -- IMP-XXXXXXXX
  client_id    text not null,                         -- tenant destino (de la sesión impersonada)
  entidad      text not null,                         -- terceros|productos|servicios|personal|stock_inicial|gastos_cobros|tesoreria_saldo
  estado       text not null default 'BORRADOR'
    check (estado in ('BORRADOR','VALIDADO','APLICADO','REVERTIDO','ERROR')),
  operador     text,                                  -- email del admin (session.imp.admin_email)
  mapping      jsonb not null default '{}'::jsonb,     -- columna→campo + defaults + política de duplicados
  total_filas  int  not null default 0,
  filas_ok     int  not null default 0,
  filas_error  int  not null default 0,
  creado_at    timestamptz not null default now(),
  aplicado_at  timestamptz
);
create index if not exists idx_import_lotes_client on import_lotes (client_id);

create table if not exists import_lote_items (
  item_id      bigint generated always as identity primary key,
  lote_id      text not null references import_lotes(lote_id) on delete cascade,
  entidad      text not null,
  fila_origen  int  not null,                          -- nº de fila en el CSV
  accion       text not null
    check (accion in ('INSERTADA','ACTUALIZADA','SALTADA','ERROR')),
  pk_destino   text,                                   -- código/registro creado o afectado (null si error)
  motivo       text                                    -- motivo si SALTADA/ERROR
);
create index if not exists idx_import_lote_items_lote on import_lote_items (lote_id);

create table if not exists import_plantillas (
  plantilla_id text primary key,                      -- PLT-XXXXXXXX
  nombre       text not null,
  entidad      text not null,
  mapping      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.import_lotes       enable row level security;
alter table public.import_lote_items  enable row level security;
alter table public.import_plantillas  enable row level security;
grant select, insert, update, delete on public.import_lotes      to service_role;
grant select, insert, update, delete on public.import_lote_items to service_role;
grant select, insert, update, delete on public.import_plantillas to service_role;
grant usage, select on all sequences in schema public to service_role;

notify pgrst, 'reload schema';
