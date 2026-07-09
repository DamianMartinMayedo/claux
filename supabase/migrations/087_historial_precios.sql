-- Historial de precios y costos por producto
-- Registra cada cambio de precio/costo para mostrar evolución en el tiempo
-- (sin FK a products porque la PK real es id uuid, no producto_id text)

create table if not exists producto_precios_historial (
  historial_id text primary key,
  client_id    text not null,
  producto_id  text not null,
  moneda       text not null,
  precio       numeric(12,2),
  costo        numeric(12,2),
  created_at   timestamptz not null default now()
);

create index if not exists idx_historial_precios_producto on producto_precios_historial(producto_id);
create index if not exists idx_historial_precios_client on producto_precios_historial(client_id);
create index if not exists idx_historial_precios_created on producto_precios_historial(created_at desc);
