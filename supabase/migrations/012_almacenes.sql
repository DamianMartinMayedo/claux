-- ================================================================
-- MIGRACIÓN 012: Tabla de almacenes
--
-- Los almacenes pertenecen a una empresa y representan ubicaciones
-- físicas o virtuales donde se almacena mercancía.
--
-- Tipos:
--   FISICO      → ubicación física real (nave, tienda, depósito)
--   VIRTUAL     → stock asignado a una empresa sin ubicación física propia
--   TRANSITO    → mercancía en camino / drop-shipping (entrega directa)
--   CONSIGNACION→ mercancía de terceros en custodia, diferente trato fiscal
-- ================================================================

create table if not exists almacenes (
  almacen_id    text          primary key,                -- ALM-XXXXXXXX
  client_id     text          not null,
  empresa_id    text          not null,

  nombre        text          not null,
  descripcion   text,
  tipo          text          not null default 'FISICO',  -- FISICO | VIRTUAL | TRANSITO | CONSIGNACION

  activo        boolean       not null default true,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now()
);

create index if not exists idx_almacenes_client  on almacenes (client_id);
create index if not exists idx_almacenes_empresa on almacenes (empresa_id);
create index if not exists idx_almacenes_tipo    on almacenes (tipo);
create index if not exists idx_almacenes_activo  on almacenes (activo);

-- RLS y grants
alter table public.almacenes enable row level security;
grant select, insert, update, delete on public.almacenes to service_role;

notify pgrst, 'reload schema';
