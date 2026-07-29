-- ================================================================
-- MIGRACIÓN 152: el concepto del gasto vuelve (D4)
--
-- Desde la mig. 126 un GASTO se identifica por su categoría y su etiqueta (la columna
-- `descripcion`) se DERIVA como «Categoría · Subcategoría», con el texto libre en
-- `notas`. La intención era buena —clasificar de verdad, en vez de acumular texto
-- suelto— pero el listado se volvió ilegible: dos gastos de «Suministros ·
-- Electricidad» del mismo mes son indistinguibles en la tabla, y para saber cuál es
-- cuál hay que abrir cada uno y leer las notas.
--
-- Decisión del propietario: **concepto obligatorio ADEMÁS de categoría y
-- subcategoría**, no en su lugar. La categoría sigue mandando en el informe; el
-- concepto es para reconocer la fila.
--
-- ⚠️ **NULLABLE de verdad, no NOT NULL con default.** Hay CUATRO escritores que no son
-- el formulario y a los que no se les puede exigir un concepto por contrato de columna:
--   · la nómina (hasta 5 filas por confirmación),
--   · las compras confirmadas,
--   · el cierre de caja (mig. 149),
--   · el importador de datos.
-- «Obligatorio» es una regla DEL FORMULARIO. Y el histórico —todas las filas de
-- producción— nace sin concepto: la tabla cae a `descripcion` cuando falta, así que no
-- queda ninguna celda en blanco.
--
-- Los tres escritores del sistema SÍ lo rellenan a partir de aquí (nómina, compras y
-- cierre de caja), que es lo que evita que la columna nueva repita el problema que
-- viene a arreglar: cinco filas de nómina del mismo mes, todas leyendo «Salarios».
-- ================================================================

alter table gastos_cobros
  add column if not exists concepto text;

comment on column gastos_cobros.concepto is
  'De qué es este gasto, en palabras del dueño (mig. 152). Obligatorio en el formulario, nullable en la columna: nómina, compras, cierre de caja e importador también escriben aquí. El histórico cae a `descripcion`.';

create index if not exists idx_gc_concepto
  on gastos_cobros using gin (to_tsvector('spanish', coalesce(concepto, '')));

-- ── Los dos escritores en Postgres también rellenan `concepto` ────────────────
-- Idénticas a las de la mig. 133 salvo la columna nueva: la etiqueta que ya escribían
-- («Compra F0001», «Servicios de la factura F0001») es exactamente el concepto que el
-- dueño reconoce, y dejarlas fuera haría que la columna nueva enseñara «Compras» en
-- todas las filas de compras — el problema que viene a arreglar.

create or replace function inv_confirmar_compra(p_compra_id text, p_client_id text)
returns jsonb
language plpgsql as $$
declare
  v_compra compras%rowtype;
  v_total  numeric;
  v_gasto  text := 'GAS-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
  v_cat    text;
  v_catnom text;
  v_line   record;
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

create or replace function srv_cxp_generar(p_factura_id text, p_client_id text)
returns jsonb
language plpgsql as $$
declare
  v_factura facturas%rowtype;
  v_prov    record;
  v_gasto   text;
  v_cat     text;
  v_catnom  text;
  v_creados int := 0;
begin
  select * into v_factura from facturas
    where factura_id = p_factura_id and client_id = p_client_id;
  if not found then raise exception 'FACTURA_NO_ENCONTRADA'; end if;

  if exists (select 1 from gastos_cobros
              where client_id = p_client_id and origen_tipo = 'FACTURA' and origen_id = p_factura_id) then
    return jsonb_build_object('creados', 0, 'ya_existia', true);
  end if;

  v_cat := cat_gasto_sistema(p_client_id, 'servicios_terceros', 'Servicios de terceros');
  select nombre into v_catnom from categorias_gastos where categoria_id = v_cat;

  for v_prov in
    select p.proveedor_id,
           sum(dl.cantidad * coalesce(dl.costo_unitario,
                                      (p.costos ->> v_factura.moneda)::numeric,
                                      0)) as total
      from documento_lineas dl
      join products p on p.producto_id = dl.producto_id and p.client_id = p_client_id
     where dl.documento_tipo = 'FACTURA'
       and dl.documento_id   = p_factura_id
       and p.tipo = 'SERVICIO'             -- un físico ya se gastó al COMPRARLO (gasto «Compras»)
       and p.proveedor_id is not null      -- decisión 7: sin proveedor NO se contabiliza
     group by p.proveedor_id
  loop
    continue when coalesce(v_prov.total, 0) <= 0.005;   -- sin coste no hay deuda

    v_gasto := 'GAS-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
    insert into gastos_cobros (registro_id, client_id, empresa_id, tipo, fecha, tercero_id,
                               categoria, categoria_id, descripcion, concepto, moneda, monto, notas,
                               origen_tipo, origen_id, updated_at)
    values (v_gasto, p_client_id, v_factura.empresa_id, 'GASTO', v_factura.fecha_emision,
            v_prov.proveedor_id, coalesce(v_catnom, 'Servicios de terceros'), v_cat,
            'Servicios de la factura ' || v_factura.numero,
            'Servicios de la factura ' || v_factura.numero,
            v_factura.moneda, v_prov.total,
            'Generado al emitir la factura ' || p_factura_id, 'FACTURA', p_factura_id, now());
    v_creados := v_creados + 1;
  end loop;

  return jsonb_build_object('creados', v_creados, 'ya_existia', false);
end; $$;

notify pgrst, 'reload schema';
