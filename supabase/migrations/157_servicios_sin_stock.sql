-- 157 · Un servicio no tiene existencias: candado + limpieza del resto viejo
--
-- POR QUÉ
-- En prod había un SERVICIO («Básico Mensual», CLI-0003) con −1 en Almacén Central:
-- un cierre de caja de julio le descontó stock cuando la ingesta todavía no filtraba
-- por tipo. La fila era un callejón sin salida — aparecía en «Revisar» del inventario
-- pero ninguna acción podía arreglarla: `ajustarStock` rechaza servicios y el conteo
-- no los lista. Los servicios viven en Servicios y no llevan existencias, punto.
--
-- Hoy TODAS las vías de escritura filtran `tipo = 'PRODUCTO'` (ingesta de caja,
-- factura, compras, conteo, ajuste manual, importador), así que esto no se reproduce
-- por el camino conocido. El candado va igual en la BD porque la lista de vías crece
-- (bot, API, un módulo futuro) y el fallo es SILENCIOSO: nadie ve el servicio con
-- stock hasta que alguien mira una pantalla de inventario meses después.

-- ── 1. Candado en la RPC ──────────────────────────────────────────────────────
-- Se re-crea inv_aplicar_movimiento (última versión: mig. 154) idéntica salvo el
-- guardia inicial. Solo salta si el producto EXISTE y no es físico: si no hay fila no
-- se toca el comportamiento previo (la RPC ya escribía el ledger sin actualizar
-- nada), que es lo que espera el importador cuando el catálogo va por detrás.
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
  -- Un servicio no tiene existencias. Se corta ANTES de insertar en el ledger: un
  -- movimiento de un SRV- es un dato falso, no un dato incómodo.
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
    if v_res_alm < 0 and not p_permitir_negativo then raise exception 'STOCK_NEGATIVO'; end if;
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

-- ── 2. Limpieza del resto viejo ───────────────────────────────────────────────
-- Se borra el movimiento además de la fila de stock: dejarlo haría que
-- `inv_recalcular_stock` (que reconstruye desde el ledger) resucitara la fila en el
-- siguiente recálculo. La VENTA en sí no se pierde — el ticket, el ingreso y el
-- cierre de caja siguen intactos; lo que se va es el apunte de inventario que nunca
-- debió existir. El join es por (client_id, producto_id): `products.producto_id` no
-- tiene único en prod y un borrado por código suelto cruzaría tenants.
with no_fisicos as (
  select client_id, producto_id from products where tipo <> 'PRODUCTO'
)
delete from movimientos_inventario m
using no_fisicos n
where m.client_id = n.client_id and m.producto_id = n.producto_id;

with no_fisicos as (
  select client_id, producto_id from products where tipo <> 'PRODUCTO'
)
delete from stock_almacenes s
using no_fisicos n
where s.client_id = n.client_id and s.producto_id = n.producto_id;

with no_fisicos as (
  select client_id, producto_id from products where tipo <> 'PRODUCTO'
)
delete from producto_almacen_config c
using no_fisicos n
where c.client_id = n.client_id and c.producto_id = n.producto_id;

-- `stock_minimo` no se toca: en un servicio nadie lo lee y ponerlo a NULL sería
-- escribir en las 9 filas de servicios para no cambiar nada.
update products set stock_actual = 0
  where tipo <> 'PRODUCTO' and coalesce(stock_actual, 0) <> 0;

-- El mapa `stock_movs` del cierre es un flag de idempotencia («ya se descontó») y a
-- la vez la lista de movimientos posteados. Se le quitan las claves cuyos
-- movimientos acaban de irse, para que no apunte a ids inexistentes. Queda `{}` si
-- no había ningún producto físico en ese cierre: sigue siendo NOT NULL, así que ni
-- se re-postea ni cambia el badge «Descontado».
-- Se quitan SOLO las claves de un no-físico, no las «que no son físicas»: un código
-- cuyo producto ya se borró del catálogo no es asunto de esta migración.
update caja_sesiones s
set stock_movs = (
  select coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb)
  from jsonb_each_text(s.stock_movs) as e(k, v)
  where not exists (
    select 1 from products p
    where p.client_id = s.client_id and p.producto_id = e.k and p.tipo <> 'PRODUCTO'
  )
)
where s.stock_movs is not null
  and exists (
    select 1 from jsonb_each_text(s.stock_movs) as e(k, v)
    join products p on p.client_id = s.client_id and p.producto_id = e.k
    where p.tipo <> 'PRODUCTO'
  );
