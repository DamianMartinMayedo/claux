-- ================================================================
-- MIGRACIÓN 130: cuenta técnica de «Apertura» en Tesorería
--
-- La necesita el importador de datos para el histórico financiero. El estado
-- de un gasto/cobro NO se guarda: se DERIVA de los movimientos de tesorería
-- que lo referencian (`estadoDe`, gastos.ts). Así que un gasto que el cliente
-- YA PAGÓ antes de entrar en CLAUX necesita un movimiento que lo salde, o
-- entraría como pendiente y ensuciaría CxP/CxC con deuda que no existe.
--
-- Ese movimiento no puede salir de una caja real (falsearía el efectivo de
-- hoy), así que sale de una cuenta marcada `es_apertura`: una cuenta técnica
-- por (empresa, moneda) que el importador crea sola, fechada en el período
-- del gasto —nunca hoy—, de modo que el estado de resultados devengado cuadra
-- por fecha y la caja real no se toca.
--
-- El flag existe para EXCLUIRLA de todo lo que habla de dinero real: saldos de
-- Tesorería, caja del dashboard, flujo de caja efectivo de Reportes y los
-- selectores de cuenta para pagar/cobrar. No es una caja: es un artefacto de
-- migración. Ver docs/planes/modulo-importacion.md §12 (decisión D-A).
--
-- `movimientos_tesoreria.origen` se queda en PAGO/COBRO a propósito: el estado
-- se deriva de esos orígenes y las vistas los saben pintar; lo que se excluye
-- es la CUENTA, no el origen.
-- ================================================================

alter table cuentas add column if not exists es_apertura boolean not null default false;

create index if not exists idx_cuentas_apertura on cuentas (client_id, es_apertura);

notify pgrst, 'reload schema';
