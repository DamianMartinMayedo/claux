-- ================================================================
-- MIGRACIÓN 038: Inventario · mejoras de negocio en compras (medios)
--
-- #4 Anular una compra PAGADA: en vez de borrar los pagos de Tesorería en
--    silencio, se BLOQUEA con COMPRA_PAGADA. Hay que anular el pago primero.
-- #6 Al confirmar, el costo de cada línea actualiza products.costos[moneda]
--    (último costo), para que los márgenes reflejen la última compra.
-- ================================================================

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

    -- #6: actualizar el último costo del producto en la moneda de la compra
    if v_line.costo_unitario > 0 then
      update products
        set costos = coalesce(costos, '{}'::jsonb) || jsonb_build_object(v_compra.moneda, v_line.costo_unitario),
            updated_at = now()
        where producto_id = v_line.producto_id and client_id = p_client_id;
    end if;
  end loop;

  update compras set estado = 'CONFIRMADA', gasto_id = v_gasto, total = v_total, updated_at = now()
    where compra_id = p_compra_id and client_id = p_client_id;

  return jsonb_build_object('gasto_id', v_gasto, 'total', v_total);
end; $$;

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

  -- #4: no anular si el gasto tiene pagos registrados en Tesorería
  if v_compra.gasto_id is not null
     and exists (select 1 from movimientos_tesoreria
                 where client_id = p_client_id and referencia_id = v_compra.gasto_id and origen = 'PAGO') then
    raise exception 'COMPRA_PAGADA';
  end if;

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

  -- Eliminar el gasto (sin pagos, garantizado por el check anterior)
  if v_compra.gasto_id is not null then
    delete from gastos_cobros where registro_id = v_compra.gasto_id and client_id = p_client_id;
  end if;

  update compras set estado = 'ANULADA', gasto_id = null, updated_at = now()
    where compra_id = p_compra_id and client_id = p_client_id;

  return jsonb_build_object('ok', true);
end; $$;

notify pgrst, 'reload schema';
