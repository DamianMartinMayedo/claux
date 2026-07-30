-- 158 · Una ENTRADA nunca puede fallar por «stock insuficiente»
--
-- POR QUÉ (encontrado al probar el candado de la mig. 157, con datos de prod)
-- `inv_aplicar_movimiento` comprobaba `v_res_alm < 0` en las TRES ramas, incluida la
-- de ENTRADA. En un almacén ya en negativo eso hacía que **entrar mercancía fallara**:
-- Almacén Central tiene −6 de «Botella agua 500ml», así que una compra de 5 botellas
-- a ese almacén saltaba con STOCK_NEGATIVO (−6 + 5 = −1 < 0) y se abortaba ENTERA,
-- con el mensaje «No hay stock suficiente en el almacén para este movimiento» — sobre
-- una entrega que SUMA. `inv_confirmar_compra` llama sin `p_permitir_negativo`, así
-- que la vía normal de reponer estaba cerrada justo en los productos que más lo
-- necesitan: los que están en negativo. Un callejón sin salida, y de los caros: el
-- dueño ve «no hay stock» al meter stock.
--
-- LA REGLA CORRECTA
-- El guardia existe para no dejar sacar lo que no hay. Solo tiene sentido en el
-- movimiento que RESTA: la pata de origen de una transferencia, una SALIDA, o un
-- AJUSTE de delta negativo. Si el movimiento suma y el resultado sigue en negativo,
-- el negativo no lo causó este movimiento y rechazarlo no arregla nada: lo empeora.
-- (`p_cantidad` en AJUSTE es el delta y puede venir negativo; en ENTRADA es magnitud.)
create or replace function inv_aplicar_movimiento(
  p_client_id text, p_empresa_id text, p_fecha date, p_tipo text,
  p_producto_id text, p_almacen_id text, p_almacen_destino_id text,
  p_cantidad numeric, p_costo_unitario numeric, p_motivo text,
  p_origen text, p_referencia_id text,
  p_permitir_negativo boolean default false, p_motivo_tipo text default null
) returns jsonb language plpgsql as $$
declare
  v_mov     text := 'MVI-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
  v_res_alm numeric;
  v_global  numeric;
  v_tipo    text;
begin
  -- Un servicio no tiene existencias (mig. 157). Se corta ANTES de insertar en el
  -- ledger: un movimiento de un SRV- es un dato falso, no un dato incómodo.
  select tipo into v_tipo from products
    where producto_id = p_producto_id and client_id = p_client_id;
  if v_tipo is not null and v_tipo <> 'PRODUCTO' then
    raise exception 'PRODUCTO_NO_FISICO';
  end if;

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
    -- `p_cantidad < 0`: solo se vigila el AJUSTE que resta. Una ENTRADA que suma no
    -- puede quedar rechazada por un negativo que ya estaba ahí (ver cabecera).
    if v_res_alm < 0 and p_cantidad < 0 and not p_permitir_negativo then
      raise exception 'STOCK_NEGATIVO';
    end if;
    update products set stock_actual = stock_actual + p_cantidad, updated_at = now()
      where producto_id = p_producto_id and client_id = p_client_id;
  end if;

  select stock_actual into v_global from products
    where producto_id = p_producto_id and client_id = p_client_id;

  return jsonb_build_object('movimiento_id', v_mov, 'stock_global', coalesce(v_global, 0), 'stock_almacen', v_res_alm);
end; $$;

grant execute on function inv_aplicar_movimiento(
  text, text, date, text, text, text, text, numeric, numeric, text, text, text, boolean, text
) to service_role;
