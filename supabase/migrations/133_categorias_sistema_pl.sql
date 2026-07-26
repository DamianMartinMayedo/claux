-- ================================================================
-- MIGRACIÓN 133: Categorías FANTASMA — el saneamiento que desbloquea el P&L (F0)
--
-- EL PROBLEMA (verificado en producción): los gastos que generan los módulos
-- automáticamente escribían el NOMBRE de la categoría y nada más:
--
--   `Compras`              ← inv_confirmar_compra (migs. 037/038)  → sin fila, sin categoria_id
--   `Servicios de terceros`← srv_cxp_generar      (mig. 118)       → sin fila, sin categoria_id
--
-- Existían en el estado de resultados pero NO como fila gestionable: el dueño no
-- podía renombrarlas ni colgarles subcategorías, y cualquier clasificación apoyada
-- en `categoria_id` las dejaba fuera — justo las dos que por naturaleza son coste
-- de ventas. Sin esto, el P&L no puede tener estructura.
--
-- Y había un agujero de fondo: las categorías de sistema solo se sembraron en la
-- mig. 074 para los clientes que existían ENTONCES. Un cliente dado de alta después
-- no tiene ninguna, así que la nómina («Salarios») y las comisiones de transferencia
-- también nacían sin `categoria_id`. Por eso la solución no es otra semilla: es una
-- función RESOLVER-O-CREAR que se llama en el momento de escribir el gasto.
--
-- LA CLAVE ESTABLE, y por qué no basta el nombre: la mig. 074 dejó estas categorías
-- RENOMBRABLES. Si el dueño llama «Mercancía» a su «Compras», buscarla por nombre
-- crearía una segunda «Compras» a su espalda en la siguiente compra — que es
-- exactamente el bug de datos de la mig. 122 («Servicios»/«Servicio» duplicadas).
-- Por eso se añade `clave_sistema`: la identidad es la clave, el nombre es etiqueta.
-- ================================================================

-- ── 1. Clave estable de las categorías que gestiona el sistema ────────────────
alter table categorias_gastos
  add column if not exists clave_sistema text;

comment on column categorias_gastos.clave_sistema is
  'Identidad estable de una categoría que escribe el sistema (compras, servicios_terceros, '
  'salarios, comisiones_bancarias). El nombre es etiqueta renombrable; esta clave no cambia.';

create unique index if not exists uq_categorias_gastos_clave_sistema
  on categorias_gastos (client_id, clave_sistema) where clave_sistema is not null;

-- Adoptar las que ya existen por nombre (sembradas por la mig. 074 o creadas a mano).
update categorias_gastos c
   set clave_sistema = m.clave, es_sistema = true, updated_at = now()
  from (values ('Salarios', 'salarios'),
               ('Comisiones bancarias', 'comisiones_bancarias'),
               ('Compras', 'compras'),
               ('Servicios de terceros', 'servicios_terceros')) as m(nombre, clave)
 where c.nombre = m.nombre
   and c.parent_id is null
   and c.clave_sistema is null
   -- Solo si ese cliente no tiene ya otra fila con esa clave (no puede haberla:
   -- la clave se estrena aquí, pero la guardia deja la sentencia reejecutable).
   and not exists (select 1 from categorias_gastos c2
                    where c2.client_id = c.client_id and c2.clave_sistema = m.clave);

-- ── 2. Resolver-o-crear: la ÚNICA vía para que el sistema escriba una categoría ──
-- Orden de resolución: por clave → por nombre (la adopta) → la crea.
-- Idempotente y a prueba de concurrencia (dos confirmaciones de compra a la vez).
create or replace function cat_gasto_sistema(
  p_client_id text,
  p_clave     text,
  p_nombre    text
) returns text
language plpgsql as $$
declare
  v_id text;
begin
  -- (a) Por clave estable: sobrevive a que el dueño la haya renombrado.
  select categoria_id into v_id from categorias_gastos
   where client_id = p_client_id and clave_sistema = p_clave
   limit 1;
  if v_id is not null then return v_id; end if;

  -- (b) Por nombre, a nivel raíz: la categoría del dueño se ADOPTA en vez de
  --     duplicarla. Es lo que evita dos «Compras» conviviendo en el informe.
  select categoria_id into v_id from categorias_gastos
   where client_id = p_client_id and nombre = p_nombre and parent_id is null
   limit 1;
  if v_id is not null then
    update categorias_gastos
       set clave_sistema = p_clave, es_sistema = true, updated_at = now()
     where categoria_id = v_id;
    return v_id;
  end if;

  -- (c) Crearla.
  v_id := 'CATGAS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  begin
    insert into categorias_gastos (categoria_id, client_id, nombre, clave_sistema, es_sistema, updated_at)
    values (v_id, p_client_id, p_nombre, p_clave, true, now());
  exception when unique_violation then
    -- Otra transacción se adelantó: nos quedamos con la suya.
    select categoria_id into v_id from categorias_gastos
     where client_id = p_client_id and clave_sistema = p_clave limit 1;
    if v_id is null then
      select categoria_id into v_id from categorias_gastos
       where client_id = p_client_id and nombre = p_nombre and parent_id is null limit 1;
    end if;
  end;

  return v_id;
end; $$;

grant execute on function cat_gasto_sistema(text, text, text) to service_role;

-- ── 3. Relleno del histórico ─────────────────────────────────────────────────
-- (a) Sembrar la fila que falte para los gastos ya escritos por los módulos.
do $$
declare r record;
begin
  for r in
    select distinct g.client_id, g.categoria, m.clave
      from gastos_cobros g
      join (values ('Compras', 'compras'),
                   ('Servicios de terceros', 'servicios_terceros')) as m(nombre, clave)
        on m.nombre = g.categoria
     where g.categoria_id is null
  loop
    perform cat_gasto_sistema(r.client_id, r.clave, r.categoria);
  end loop;
end $$;

-- (b) Cualquier otra categoría suelta que quedara sin fila (p. ej. importaciones
--     antiguas). Se crean como categorías normales del dueño, no de sistema.
insert into categorias_gastos (categoria_id, client_id, nombre, es_sistema, updated_at)
select 'CATGAS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
       t.client_id, t.categoria, false, now()
  from (
    select distinct client_id, categoria from gastos_cobros
      where categoria_id is null and categoria is not null and categoria <> ''
    union
    select distinct client_id, categoria from movimientos_tesoreria
      where categoria_id is null and categoria is not null and categoria <> ''
  ) t
 where not exists (
   select 1 from categorias_gastos c
    where c.client_id = t.client_id and c.nombre = t.categoria and c.parent_id is null
 );

-- (c) Atar los registros huérfanos a su fila, por nombre y a nivel raíz.
update gastos_cobros g
   set categoria_id = c.categoria_id
  from categorias_gastos c
 where g.categoria_id is null and g.categoria is not null
   and c.client_id = g.client_id and c.nombre = g.categoria and c.parent_id is null;

update movimientos_tesoreria m
   set categoria_id = c.categoria_id
  from categorias_gastos c
 where m.categoria_id is null and m.categoria is not null
   and c.client_id = m.client_id and c.nombre = m.categoria and c.parent_id is null;

-- ── 4. Que los módulos escriban categoria_id de aquí en adelante ─────────────
-- Compras (migs. 037/038): idéntica salvo que resuelve la categoría antes de
-- insertar el gasto y escribe AMBAS columnas (FK + nombre desnormalizado, que es
-- el que siguen leyendo listados y reportes).
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

  -- Categoría gestionable, no un texto suelto (mig. 133).
  v_cat := cat_gasto_sistema(p_client_id, 'compras', 'Compras');
  select nombre into v_catnom from categorias_gastos where categoria_id = v_cat;

  insert into gastos_cobros (registro_id, client_id, empresa_id, tipo, fecha, tercero_id,
                             categoria, categoria_id, descripcion, moneda, monto, notas, updated_at)
  values (v_gasto, p_client_id, v_compra.empresa_id, 'GASTO', v_compra.fecha, v_compra.proveedor_id,
          coalesce(v_catnom, 'Compras'), v_cat,
          'Compra ' || v_compra.numero, v_compra.moneda, v_total, 'Compra ' || p_compra_id, now());

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

    -- #6 (mig. 038): actualizar el último costo del producto en la moneda de la compra
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

-- CxP de servicios (mig. 118): mismo cambio. Las DOS reglas antidoble-conteo se
-- quedan intactas (solo `tipo = 'SERVICIO'`, solo con `proveedor_id`).
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

  -- Idempotencia: ya tiene CxP generada.
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
                               categoria, categoria_id, descripcion, moneda, monto, notas,
                               origen_tipo, origen_id, updated_at)
    values (v_gasto, p_client_id, v_factura.empresa_id, 'GASTO', v_factura.fecha_emision,
            v_prov.proveedor_id, coalesce(v_catnom, 'Servicios de terceros'), v_cat,
            'Servicios de la factura ' || v_factura.numero, v_factura.moneda, v_prov.total,
            'Generado al emitir la factura ' || p_factura_id, 'FACTURA', p_factura_id, now());
    v_creados := v_creados + 1;
  end loop;

  return jsonb_build_object('creados', v_creados, 'ya_existia', false);
end; $$;

notify pgrst, 'reload schema';
