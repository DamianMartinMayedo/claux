-- ================================================================
-- MIGRACIÓN 150: la factura puede descontar del inventario, con un check
--
-- Hasta hoy, vender por factura no movía existencias: el stock solo bajaba por el
-- cierre del punto de venta o por un movimiento manual. Un negocio que factura a
-- empresas tenía que acordarse de restar a mano lo que acababa de vender.
--
-- Decisión de producto (propietario): **es una elección por factura, no un
-- automatismo**. Un check dentro del propio documento, porque no toda factura mueve
-- existencias — servicios, alquileres, una reventa que no pasa por almacén.
--
-- `descuenta_stock` nace en **false** a propósito, y hay que no «arreglarlo»:
--   · Las facturas que ya existen no pueden cambiar de comportamiento al migrar.
--   · El cron de suscripciones y la facturación del período crean borradores con
--     `crearFacturaBorrador` y NUNCA emiten (el dueño revisa y emite). Una factura de
--     suscripción de servicios no tiene existencias que mover, así que el default
--     correcto para lo que no pasa por el formulario es «no».
-- El formulario decide el valor de las nuevas: marcado cuando el cliente tiene
-- Inventario y hay al menos una línea de producto físico.
--
-- `almacen_id`: de dónde sale la mercancía. `almacenes` no tiene almacén principal
-- —y no se le añade uno: sería una columna más y configuración previa— así que se
-- pregunta en la factura; con un solo almacén activo se precarga y el selector no se
-- pinta. FK blanda (text sin constraint), como el resto de referencias entre módulos
-- del repo: el módulo Inventario puede no estar contratado.
--
-- Sin tabla nueva → nada que añadir a `eliminar_cliente()` (mig. 146). Las
-- existencias se mueven al EMITIR, no al guardar el borrador, y se devuelven al
-- anular; la idempotencia se pregunta a `movimientos_inventario.referencia_id`, no a
-- un flag (patrón de `lib/caja/ingesta.ts`, donde el flag ya falló una vez).
-- ================================================================

alter table facturas
  add column if not exists descuenta_stock boolean not null default false,
  add column if not exists almacen_id      text;

comment on column facturas.descuenta_stock is
  'Si al emitir se saca del inventario lo vendido. Elección por factura (mig. 150). Default false: los borradores automáticos no mueven existencias.';
comment on column facturas.almacen_id is
  'Almacén del que sale la mercancía al emitir. FK blanda a almacenes.';

notify pgrst, 'reload schema';
