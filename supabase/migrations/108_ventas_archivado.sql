-- 108_ventas_archivado.sql
-- Acciones en lote (Ventas): soporte de archivado.
-- «Archivar» saca un documento de la vista principal sin borrarlo — imprescindible
-- para lo fiscal (facturas EMITIDA/COBRADA/ANULADA, ofertas APROBADA), que nunca
-- se elimina. El borrado real queda solo para borradores y ofertas muertas
-- (RECHAZADA/CADUCADA), y no necesita columna.

alter table ofertas  add column if not exists archivado boolean not null default false;
alter table facturas add column if not exists archivado boolean not null default false;

-- Índices parciales: la vista por defecto lista solo lo NO archivado.
create index if not exists idx_ofertas_no_archivadas
  on ofertas (client_id, empresa_id) where not archivado;
create index if not exists idx_facturas_no_archivadas
  on facturas (client_id, empresa_id) where not archivado;
