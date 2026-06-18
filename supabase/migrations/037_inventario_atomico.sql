-- ================================================================
-- MIGRACIÓN 037: Inventario · operaciones atómicas (Fase 5, hardening)
--
-- Mueve la lógica de stock y de confirmar/anular compra a funciones plpgsql
-- que corren en UNA sola transacción (atómicas) y usan incrementos atómicos,
-- eliminando tres riesgos del modelo anterior (escrituras parciales en JS):
--   #1 Integridad: si algo falla a mitad, ROLLBACK total (antes quedaban
--      entradas de stock huérfanas o stock inflado).
--   #2 Reconciliación: inv_recalcular_stock() reconstruye stock_almacenes y
--      products.stock_actual desde el ledger (fuente de verdad).
--   #3 Concurrencia: el stock se incrementa con `cantidad = cantidad + delta`
--      (UPSERT atómico / UPDATE con bloqueo de fila), no leer-modificar-escribir.
--
-- Además: las líneas de tipo SERVICIO ya no generan stock (join a products).
-- Errores de negocio se señalan con RAISE EXCEPTION '<CODE>' y el código los
-- traduce a mensajes amables.
-- ================================================================

-- ── Incremento atómico de stock por almacén ─────────────────────────────────
create or replace function inv_sumar_stock_almacen(
  p_client_id text, p_producto_id text, p_almacen_id text, p_delta numeric
) returns numeric
language plpgsql as $$
declare v_nuevo numeric;
begin
  insert into stock_almacenes (client_id, producto_id, almacen_id, cantidad, updated_at)
  values (p_client_id, p_producto_id, p_almacen_id, p_delta, now())
  on conflict (producto_id, almacen_id)
  do update set cantidad = stock_almacenes.cantidad + excluded.cantidad, updated_at = now()
  returning cantidad into v_nuevo;
  return v_nuevo;
end; $$;

-- ── Aplicar un movimiento completo (ledger + stock almacén + global) ─────────
create or replace function inv_aplicar_movimiento(
  p_client_id text, p_empresa_id text, p_fecha date, p_tipo text,
  p_producto_id text, p_almacen_id text, p_almacen_destino_id text,
  p_cantidad numeric, p_costo_unitario numeric, p_motivo text,
  p_origen text, p_referencia_id text
) returns jsonb
language plpgsql as $$
declare
  v_mov     text := 'MVI-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
  v_res_alm numeric;
  v_global  numeric;
begin
  insert into movimientos_inventario (
    movimiento_id, client_id, empresa_id, fecha, tipo, producto_id,
    almacen_id, almacen_destino_id, cantidad, costo_unitario, motivo, origen, referencia_id
  ) values (
    v_mov, p_client_id, p_empresa_id, coalesce(p_fecha, current_date), p_tipo, p_producto_id,
    p_almacen_id, p_almacen_destino_id, p_cantidad, p_costo_unitario, p_motivo,
    coalesce(p_origen, 'MANUAL'), p_referencia_id
  );

  if p_tipo = 'TRANSFERENCIA' then
    v_res_alm := inv_sumar_stock_almacen(p_client_id, p_producto_id, p_almacen_id, -p_cantidad);
    if v_res_alm < 0 then raise exception 'STOCK_NEGATIVO'; end if;
    perform inv_sumar_stock_almacen(p_client_id, p_producto_id, p_almacen_destino_id, p_cantidad);
    -- global: neto cero
  elsif p_tipo = 'SALIDA' then
    v_res_alm := inv_sumar_stock_almacen(p_client_id, p_producto_id, p_almacen_id, -p_cantidad);
    if v_res_alm < 0 then raise exception 'STOCK_NEGATIVO'; end if;
    update products set stock_actual = stock_actual - p_cantidad, updated_at = now()
      where producto_id = p_producto_id and client_id = p_client_id;
  else
    -- ENTRADA o AJUSTE: p_cantidad con su signo (ENTRADA siempre > 0)
    v_res_alm := inv_sumar_stock_almacen(p_client_id, p_producto_id, p_almacen_id, p_cantidad);
    if v_res_alm < 0 then raise exception 'STOCK_NEGATIVO'; end if;
    update products set stock_actual = stock_actual + p_cantidad, updated_at = now()
      where producto_id = p_producto_id and client_id = p_client_id;
  end if;

  select stock_actual into v_global from products
    where producto_id = p_producto_id and client_id = p_client_id;

  return jsonb_build_object('movimiento_id', v_mov, 'stock_global', coalesce(v_global, 0), 'stock_almacen', v_res_alm);
end; $$;

-- ── Confirmar compra: sube stock (solo PRODUCTO) + crea GASTO 'Compras' ──────
create or replace function inv_confirmar_compra(p_compra_id text, p_client_id text)
returns jsonb
language plpgsql as $$
declare
  v_compra compras%rowtype;
  v_total  numeric;
  v_gasto  text := 'GAS-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
  v_line   record;
begin
  select * into v_compra from compras where compra_id = p_compra_id and client_id = p_client_id;
  if not found                       then raise exception 'COMPRA_NO_ENCONTRADA'; end if;
  if v_compra.estado <> 'BORRADOR'   then raise exception 'COMPRA_NO_BORRADOR'; end if;

  select coalesce(sum(cantidad * costo_unitario), 0) into v_total
    from compra_lineas where compra_id = p_compra_id and client_id = p_client_id;
  if v_total <= 0.005 then raise exception 'COMPRA_SIN_IMPORTE'; end if;

  insert into gastos_cobros (registro_id, client_id, empresa_id, tipo, fecha, tercero_id,
                             categoria, descripcion, moneda, monto, notas, updated_at)
  values (v_gasto, p_client_id, v_compra.empresa_id, 'GASTO', v_compra.fecha, v_compra.proveedor_id,
          'Compras', 'Compra ' || v_compra.numero, v_compra.moneda, v_total, 'Compra ' || p_compra_id, now());

  for v_line in
    select cl.producto_id, cl.cantidad, cl.costo_unitario
    from compra_lineas cl
    join products p on p.producto_id = cl.producto_id and p.client_id = p_client_id
    where cl.compra_id = p_compra_id and cl.client_id = p_client_id
      and cl.producto_id is not null and p.tipo = 'PRODUCTO'
  loop
    perform inv_aplicar_movimiento(
      p_client_id, v_compra.empresa_id, v_compra.fecha, 'ENTRADA',
      v_line.producto_id, v_compra.almacen_id, null,
      v_line.cantidad, v_line.costo_unitario, 'Compra ' || v_compra.numero, 'COMPRA', p_compra_id);
  end loop;

  update compras set estado = 'CONFIRMADA', gasto_id = v_gasto, total = v_total, updated_at = now()
    where compra_id = p_compra_id and client_id = p_client_id;

  return jsonb_build_object('gasto_id', v_gasto, 'total', v_total);
end; $$;

-- ── Anular compra: revierte stock + elimina gasto y sus pagos ────────────────
create or replace function inv_anular_compra(p_compra_id text, p_client_id text)
returns jsonb
language plpgsql as $$
declare
  v_compra compras%rowtype;
  v_line   record;
  v_disp   numeric;
begin
  select * into v_compra from compras where compra_id = p_compra_id and client_id = p_client_id;
  if not found                        then raise exception 'COMPRA_NO_ENCONTRADA'; end if;
  if v_compra.estado <> 'CONFIRMADA'  then raise exception 'COMPRA_NO_CONFIRMADA'; end if;

  -- Validar que el stock alcanza para revertir cada entrada (solo PRODUCTO)
  for v_line in
    select cl.producto_id, cl.cantidad
    from compra_lineas cl
    join products p on p.producto_id = cl.producto_id and p.client_id = p_client_id
    where cl.compra_id = p_compra_id and cl.client_id = p_client_id
      and cl.producto_id is not null and p.tipo = 'PRODUCTO'
  loop
    select coalesce(cantidad, 0) into v_disp from stock_almacenes
      where producto_id = v_line.producto_id and almacen_id = v_compra.almacen_id;
    if v_line.cantidad > coalesce(v_disp, 0) + 0.005 then raise exception 'STOCK_CONSUMIDO'; end if;
  end loop;

  -- Revertir (salidas que compensan las entradas de la compra)
  for v_line in
    select cl.producto_id, cl.cantidad
    from compra_lineas cl
    join products p on p.producto_id = cl.producto_id and p.client_id = p_client_id
    where cl.compra_id = p_compra_id and cl.client_id = p_client_id
      and cl.producto_id is not null and p.tipo = 'PRODUCTO'
  loop
    perform inv_aplicar_movimiento(
      p_client_id, v_compra.empresa_id, current_date, 'SALIDA',
      v_line.producto_id, v_compra.almacen_id, null,
      v_line.cantidad, null, 'Anulación compra ' || v_compra.numero, 'COMPRA', p_compra_id);
  end loop;

  -- Eliminar el gasto y sus liquidaciones (pagos)
  if v_compra.gasto_id is not null then
    delete from movimientos_tesoreria
      where client_id = p_client_id and referencia_id = v_compra.gasto_id and origen in ('PAGO', 'COBRO');
    delete from gastos_cobros where registro_id = v_compra.gasto_id and client_id = p_client_id;
  end if;

  update compras set estado = 'ANULADA', gasto_id = null, updated_at = now()
    where compra_id = p_compra_id and client_id = p_client_id;

  return jsonb_build_object('ok', true);
end; $$;

-- ── Reconciliar: reconstruye stock desde el ledger (fuente de verdad) ────────
create or replace function inv_recalcular_stock(p_client_id text)
returns jsonb
language plpgsql as $$
declare v_productos int;
begin
  delete from stock_almacenes where client_id = p_client_id;

  insert into stock_almacenes (client_id, producto_id, almacen_id, cantidad, updated_at)
  select p_client_id, producto_id, alm, sum(delta), now()
  from (
    select producto_id, almacen_id as alm,
           case tipo when 'SALIDA' then -cantidad when 'TRANSFERENCIA' then -cantidad else cantidad end as delta
    from movimientos_inventario where client_id = p_client_id
    union all
    select producto_id, almacen_destino_id as alm, cantidad
    from movimientos_inventario
    where client_id = p_client_id and tipo = 'TRANSFERENCIA' and almacen_destino_id is not null
  ) e
  group by producto_id, alm
  having sum(delta) <> 0;

  update products p set stock_actual = coalesce(
    (select sum(cantidad) from stock_almacenes s where s.producto_id = p.producto_id and s.client_id = p_client_id), 0),
    updated_at = now()
  where p.client_id = p_client_id and p.tipo = 'PRODUCTO';

  get diagnostics v_productos = row_count;
  return jsonb_build_object('ok', true, 'productos', v_productos);
end; $$;

-- ── Grants ────────────────────────────────────────────────────────────────────
grant execute on function inv_sumar_stock_almacen(text, text, text, numeric)                                  to service_role;
grant execute on function inv_aplicar_movimiento(text, text, date, text, text, text, text, numeric, numeric, text, text, text) to service_role;
grant execute on function inv_confirmar_compra(text, text)                                                     to service_role;
grant execute on function inv_anular_compra(text, text)                                                        to service_role;
grant execute on function inv_recalcular_stock(text)                                                           to service_role;

notify pgrst, 'reload schema';
