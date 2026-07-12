-- ================================================================
-- MIGRACIÓN 091: Rectificación de ventas en Caja
--
-- El vendedor puede corregir una venta ya cobrada (cantidad, precio o
-- moneda) desde la app offline. Se registra SIEMPRE la operación original
-- y la rectificación (auditoría): el ticket original queda ANULADO y se
-- crea un ticket RECTIFICACION que apunta al original.
--
-- Efecto en los resúmenes por cierre: los tickets ANULADO se EXCLUYEN del
-- cálculo (Tesorería e Inventario reciben el neto), por eso la corrección
-- se hace dentro del mismo turno, antes de cerrarlo. Idempotente: reenviar
-- el original como ANULADO solo actualiza su estado, no duplica.
-- ================================================================

alter table caja_tickets
  add column if not exists estado      text not null default 'VIGENTE'
    check (estado in ('VIGENTE', 'ANULADO', 'RECTIFICACION')),
  add column if not exists rectifica_a text;  -- ticket_uuid del original (solo en RECTIFICACION)

-- Localizar rápido las rectificaciones de un ticket dado.
create index if not exists caja_tickets_rectifica_a_idx
  on caja_tickets (rectifica_a) where rectifica_a is not null;

notify pgrst, 'reload schema';
