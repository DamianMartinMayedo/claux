-- ================================================================
-- MIGRACIÓN 035: Inventario · Stock por almacén + movimientos — Fase 5
--
-- Hasta ahora el stock vivía en un único número global por producto
-- (products.stock_actual). Este módulo lo descompone POR ALMACÉN y añade
-- un libro de movimientos (ledger) que es la fuente de cada entrada/salida.
--
--   stock_almacenes        → cantidad por (producto, almacén). Denormalizado:
--                            lo actualiza cada movimiento de forma atómica.
--   products.stock_actual  → pasa a ser la SUMA de stock_almacenes (se recalcula
--                            en cada movimiento). Para datos previos sin almacén
--                            asignado, el primer movimiento lo reconcilia.
--
--   movimientos_inventario → ledger. tipo:
--       ENTRADA        (+cantidad en almacen_id)
--       SALIDA         (−cantidad en almacen_id)
--       AJUSTE         (±cantidad en almacen_id; cantidad puede ser negativa)
--       TRANSFERENCIA  (−cantidad en almacen_id, +cantidad en almacen_destino_id)
--     origen: MANUAL | COMPRA | VENTA  ·  referencia_id → compra_id, etc.
--
-- Numeración: MVI-XXXXXXXX.
-- ================================================================

-- Stock por almacén (denormalizado, mantenido por los movimientos)
create table if not exists stock_almacenes (
  client_id    text          not null,
  producto_id  text          not null,
  almacen_id   text          not null,
  cantidad     numeric(18,3) not null default 0,
  updated_at   timestamptz   not null default now(),
  primary key (producto_id, almacen_id)
);

create index if not exists idx_stock_almacenes_client  on stock_almacenes (client_id);
create index if not exists idx_stock_almacenes_almacen on stock_almacenes (almacen_id);

-- Libro de movimientos de inventario
create table if not exists movimientos_inventario (
  movimiento_id      text          primary key,                  -- MVI-XXXXXXXX
  client_id          text          not null,
  empresa_id         text          not null,                     -- empresa del almacén origen
  fecha              date          not null default current_date,
  tipo               text          not null,                     -- ENTRADA | SALIDA | AJUSTE | TRANSFERENCIA
  producto_id        text          not null,
  almacen_id         text          not null,                     -- origen (o único)
  almacen_destino_id text,                                       -- solo TRANSFERENCIA
  cantidad           numeric(18,3) not null,                     -- magnitud; en AJUSTE puede ser negativa
  costo_unitario     numeric(18,2),                              -- opcional (ENTRADA / COMPRA)
  motivo             text,
  origen             text          not null default 'MANUAL',    -- MANUAL | COMPRA | VENTA
  referencia_id      text,                                       -- compra_id, etc.
  created_at         timestamptz   not null default now()
);

create index if not exists idx_mvi_client    on movimientos_inventario (client_id);
create index if not exists idx_mvi_producto   on movimientos_inventario (producto_id);
create index if not exists idx_mvi_almacen    on movimientos_inventario (almacen_id);
create index if not exists idx_mvi_fecha      on movimientos_inventario (client_id, fecha);
create index if not exists idx_mvi_referencia on movimientos_inventario (origen, referencia_id);

-- RLS y grants (patrón del repo: RLS on, sin políticas; acceso vía service_role)
alter table public.stock_almacenes        enable row level security;
alter table public.movimientos_inventario enable row level security;

grant select, insert, update, delete on public.stock_almacenes        to service_role;
grant select, insert, update, delete on public.movimientos_inventario to service_role;

notify pgrst, 'reload schema';
