-- ================================================================
-- MIGRACIÓN 155: el coste de una compra entra en el historial de precios
--
-- PROBLEMA. Al confirmar una compra, `inv_confirmar_compra` pisa
-- `products.costos` con el último coste de compra (`costos = costos || {moneda:
-- coste}`) pero **no escribe nada en `producto_precios_historial`**, que sí escribe
-- `guardarProducto` en las ediciones manuales. Resultado: la pestaña «Historial de
-- precios» enseña lo que el dueño tecleó a mano y **se pierde lo que el negocio
-- hizo de verdad** — que es justo donde el coste cambia, compra a compra.
--
-- Y como es el ÚLTIMO coste (no un medio ponderado), con la inflación cubana una
-- compra cara reescribe el margen de todo el stock viejo sin dejar rastro. Esto no
-- cambia esa decisión —seguirá siendo último coste— pero la hace **visible**: cada
-- salto queda registrado con su fecha.
--
-- LO QUE HACE. Un `insert` más dentro del bucle que ya recorre las líneas, en la
-- MISMA transacción. Captura también el precio de venta vigente en esa moneda, para
-- que la fila del historial muestre el margen del momento (igual que hace la
-- edición manual). Nada más del flujo cambia: ni el gasto, ni el movimiento, ni el
-- orden de las operaciones.
--
-- El cuerpo es el de la 152 con ese único añadido.
-- ================================================================

create or replace function inv_confirmar_compra(p_compra_id text, p_client_id text)
returns jsonb
language plpgsql
as $function$
declare
  v_compra compras%rowtype;
  v_total  numeric;
  v_gasto  text := 'GAS-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
  v_cat    text;
  v_catnom text;
  v_line   record;
  v_precio numeric;
begin
  select * into v_compra from compras where compra_id = p_compra_id and client_id = p_client_id;
  if not found                       then raise exception 'COMPRA_NO_ENCONTRADA'; end if;
  if v_compra.estado <> 'BORRADOR'   then raise exception 'COMPRA_NO_BORRADOR'; end if;

  select coalesce(sum(cantidad * costo_unitario), 0) into v_total
    from compra_lineas where compra_id = p_compra_id and client_id = p_client_id;
  if v_total <= 0.005 then raise exception 'COMPRA_SIN_IMPORTE'; end if;

  v_cat := cat_gasto_sistema(p_client_id, 'compras', 'Compras');
  select nombre into v_catnom from categorias_gastos where categoria_id = v_cat;

  insert into gastos_cobros (registro_id, client_id, empresa_id, tipo, fecha, tercero_id,
                             categoria, categoria_id, descripcion, concepto, moneda, monto, notas, updated_at)
  values (v_gasto, p_client_id, v_compra.empresa_id, 'GASTO', v_compra.fecha, v_compra.proveedor_id,
          coalesce(v_catnom, 'Compras'), v_cat,
          'Compra ' || v_compra.numero, 'Compra ' || v_compra.numero,
          v_compra.moneda, v_total, 'Compra ' || p_compra_id, now());

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

    if v_line.costo_unitario > 0 then
      -- Precio de venta vigente en esa moneda, para que el historial muestre el margen.
      select (precios ->> v_compra.moneda)::numeric into v_precio
        from products where producto_id = v_line.producto_id and client_id = p_client_id;

      update products
        set costos = coalesce(costos, '{}'::jsonb) || jsonb_build_object(v_compra.moneda, v_line.costo_unitario),
            updated_at = now()
        where producto_id = v_line.producto_id and client_id = p_client_id;

      -- El apunte que faltaba: el coste que puso la compra, con su fecha.
      insert into producto_precios_historial (historial_id, client_id, producto_id, moneda, precio, costo, created_at)
      values ('PRH-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8)),
              p_client_id, v_line.producto_id, v_compra.moneda, v_precio, v_line.costo_unitario, now());
    end if;
  end loop;

  update compras set estado = 'CONFIRMADA', gasto_id = v_gasto, total = v_total, updated_at = now()
    where compra_id = p_compra_id and client_id = p_client_id;

  return jsonb_build_object('gasto_id', v_gasto, 'total', v_total);
end; $function$;

notify pgrst, 'reload schema';
