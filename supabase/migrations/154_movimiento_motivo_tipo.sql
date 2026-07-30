-- ================================================================
-- MIGRACIÓN 154: el porqué de un movimiento, tipificado
--
-- PROBLEMA. Hoy **solo el AJUSTE exige motivo**, y la SALIDA —merma, rotura,
-- consumo interno, autoconsumo, regalo— es justo la que necesita un porqué: queda
-- como «—» en el ledger. Y siendo texto libre, **la merma no se puede sumar
-- nunca**: es dinero que el negocio pierde y no mide, porque cada uno lo escribe
-- distinto («merma», «se rompió», «basura»).
--
-- LO QUE HACE. Una columna con vocabulario cerrado, y el `motivo` libre se
-- CONSERVA como detalle: el tipo es para agrupar, el texto para explicar.
--
-- EL HISTÓRICO SE QUEDA EN NULL A PROPÓSITO. No se inventa un tipo para los
-- movimientos viejos: adivinar «MERMA» a partir de un texto libre sería meter
-- datos falsos en la única tabla que el módulo trata como fuente de verdad. Los
-- informes por motivo empiezan a contar desde hoy, y la UI lo dice.
--
-- SIN CHECK CONSTRAINT, igual que `tipo` y `origen` en la mig. 035: la validación
-- vive en la acción del portal. Un CHECK obligaría a una migración por cada motivo
-- nuevo que el negocio real pida.
--
-- ⚠️ POR QUÉ HAY UN `drop function` Y NO SOLO UN `create or replace`.
-- Añadir un parámetro NO reemplaza la función: crea una SOBRECARGA. Las dos
-- convivirían y cualquier llamada con los 13 argumentos de siempre pasaría a ser
-- ambigua («function is not unique») — es decir, el cierre de caja y la factura
-- dejarían de descontar stock en producción. Se borra la firma vieja primero.
--
-- El cuerpo es el de la 037 **sin un solo cambio de lógica**: mismas ramas, mismo
-- `inv_sumar_stock_almacen`, misma guarda de STOCK_NEGATIVO. Lo único que se añade
-- es la columna en el insert. El núcleo de este módulo no se reescribe por gusto.
-- ================================================================

alter table movimientos_inventario
  add column if not exists motivo_tipo text;

comment on column movimientos_inventario.motivo_tipo is
  'Vocabulario cerrado del porqué: CONTEO, MERMA, ROTURA, CADUCADO, ROBO, AUTOCONSUMO, '
  'REGALO, DEVOLUCION, PRODUCCION, OTRO. NULL en el histórico anterior a la mig. 154 '
  '(no se adivina). El `motivo` libre se conserva como detalle.';

-- Los informes de merma agrupan por (client_id, motivo_tipo) sobre un rango de fechas.
create index if not exists idx_mov_inv_motivo_tipo
  on movimientos_inventario (client_id, motivo_tipo, fecha);

drop function if exists inv_aplicar_movimiento(
  text, text, date, text, text, text, text, numeric, numeric, text, text, text, boolean
);

create or replace function inv_aplicar_movimiento(
  p_client_id          text,
  p_empresa_id         text,
  p_fecha              date,
  p_tipo               text,
  p_producto_id        text,
  p_almacen_id         text,
  p_almacen_destino_id text,
  p_cantidad           numeric,
  p_costo_unitario     numeric,
  p_motivo             text,
  p_origen             text,
  p_referencia_id      text,
  p_permitir_negativo  boolean default false,
  p_motivo_tipo        text    default null
)
returns jsonb
language plpgsql
as $function$
declare
  v_mov     text := 'MVI-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
  v_res_alm numeric;
  v_global  numeric;
begin
  insert into movimientos_inventario (
    movimiento_id, client_id, empresa_id, fecha, tipo, producto_id,
    almacen_id, almacen_destino_id, cantidad, costo_unitario, motivo, origen, referencia_id,
    motivo_tipo
  ) values (
    v_mov, p_client_id, p_empresa_id, coalesce(p_fecha, current_date), p_tipo, p_producto_id,
    p_almacen_id, p_almacen_destino_id, p_cantidad, p_costo_unitario, p_motivo,
    coalesce(p_origen, 'MANUAL'), p_referencia_id,
    p_motivo_tipo
  );

  if p_tipo = 'TRANSFERENCIA' then
    v_res_alm := inv_sumar_stock_almacen(p_client_id, p_producto_id, p_almacen_id, -p_cantidad);
    if v_res_alm < 0 and not p_permitir_negativo then raise exception 'STOCK_NEGATIVO'; end if;
    perform inv_sumar_stock_almacen(p_client_id, p_producto_id, p_almacen_destino_id, p_cantidad);
  elsif p_tipo = 'SALIDA' then
    v_res_alm := inv_sumar_stock_almacen(p_client_id, p_producto_id, p_almacen_id, -p_cantidad);
    if v_res_alm < 0 and not p_permitir_negativo then raise exception 'STOCK_NEGATIVO'; end if;
    update products set stock_actual = stock_actual - p_cantidad, updated_at = now()
      where producto_id = p_producto_id and client_id = p_client_id;
  else
    v_res_alm := inv_sumar_stock_almacen(p_client_id, p_producto_id, p_almacen_id, p_cantidad);
    if v_res_alm < 0 and not p_permitir_negativo then raise exception 'STOCK_NEGATIVO'; end if;
    update products set stock_actual = stock_actual + p_cantidad, updated_at = now()
      where producto_id = p_producto_id and client_id = p_client_id;
  end if;

  select stock_actual into v_global from products
    where producto_id = p_producto_id and client_id = p_client_id;

  return jsonb_build_object('movimiento_id', v_mov, 'stock_global', coalesce(v_global, 0), 'stock_almacen', v_res_alm);
end; $function$;

notify pgrst, 'reload schema';
