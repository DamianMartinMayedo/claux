-- 076_movimiento_monto_ref.sql
-- Importe que un movimiento aplica al documento referenciado (factura / gasto / cobro),
-- expresado en la MONEDA DEL DOCUMENTO. Permite saldar un documento pagando/cobrando
-- desde una caja de otra moneda: `monto` queda en la moneda de la caja (lo que entra/sale
-- de tesorería) y `monto_ref` en la moneda del documento (lo que reduce su saldo).
-- Para liquidaciones en la misma moneda y para movimientos sin referencia, monto_ref = monto.

alter table movimientos_tesoreria
  add column if not exists monto_ref numeric(18,2);

-- Backfill: hasta ahora toda liquidación era en la misma moneda del documento.
update movimientos_tesoreria
  set monto_ref = monto
  where monto_ref is null;
