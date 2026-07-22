-- ================================================================
-- MIGRACIÓN 129: filas parseadas dentro del lote de importación
--
-- El CSV se parsea una sola vez (al crear el lote) y las filas se guardan aquí,
-- así el dry-run y el commit leen del lote (no se reenvían) y el commit es
-- idempotente ante reintentos.
-- ================================================================

alter table import_lotes add column if not exists cabeceras jsonb not null default '[]'::jsonb;
alter table import_lotes add column if not exists datos     jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
