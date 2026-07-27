-- ================================================================
-- MIGRACIÓN 139: Nómina · las retenciones no pueden desaparecer
--
-- PROBLEMA. Al confirmar una nómina se registraba UN gasto «Salarios» por la
-- suma de los NETOS. Así, cada deducción rebajaba el coste de personal de la
-- empresa y el importe retenido se evaporaba: no quedaba como gasto ni como
-- deuda con nadie. Con 1.200 de devengado y 75 de retención, en los libros
-- aparecían 1.125 de coste y los 75 en ningún sitio.
--
-- Pero las deducciones reales son RETENCIONES DE IMPUESTOS: dinero del salario
-- bruto del trabajador que la empresa ingresa después a la agencia tributaria.
-- No es un ahorro, es el mismo coste con un segundo acreedor.
--
-- MODELO. Confirmar una nómina escribe DOS gastos que suman el devengado:
--   «Salarios»              = Σ netos        → acreedor: la plantilla
--   «Retenciones de nómina» = Σ deducciones  → acreedor: la agencia tributaria
-- 1.125 + 75 = 1.200. El coste de personal vuelve a ser el devengado, sin doble
-- conteo, y cada acreedor tiene su propia línea en Cuentas por pagar con su
-- propio vencimiento — en una sola fila, pagar la nómina completa a los
-- trabajadores era un clic, impuestos incluidos.
--
-- La segunda fila se ata a su nómina con `origen_tipo='NOMINA'` + `origen_id`
-- (el patrón de `srv_cxp_generar`), no con una columna nueva: `nominas.gasto_id`
-- sigue apuntando al de Salarios, que es el que gobierna el saldo a la plantilla.
--
-- NO cubre todavía las deducciones que NO son impuestos (un anticipo, un préstamo,
-- algo que la empresa adelantó). Esas no se le deben a nadie: son salario ya
-- pagado, y necesitan un `destino` en `conceptos_empleado` para distinguirse.
-- Hasta entonces TODA deducción se trata como retención a tercero, que es lo que
-- son en la práctica. Ver docs/CONTEXTO.md §2, bullet de RRHH.
--
-- ── BUG APARTE QUE SE ARREGLA AQUÍ ────────────────────────────────────────────
-- `cat_gasto_sistema` (mig. 133) creaba la categoría SIN fijar `rol_pl`, así que
-- se quedaba en el default 'OPERATIVO' de la mig. 134. Esa migración solo corrigió
-- las filas que existían entonces: todo cliente dado de alta DESPUÉS estrenaba su
-- «Salarios» como gasto operativo, y su nómina salía del renglón Personal del
-- estado de resultados. Ya había ocurrido en producción. El papel en el P&L es
-- propiedad de la CLAVE, no de quien llame, así que ahora lo fija la RPC.
-- ================================================================

-- ── 1. El rol en el P&L lo decide la clave, dentro de la RPC ──────────────────
create or replace function cat_gasto_sistema(
  p_client_id text,
  p_clave     text,
  p_nombre    text
) returns text
language plpgsql as $$
declare
  v_id  text;
  v_rol text;
begin
  -- Si el rol lo pusiera el llamador, cada módulo tendría su propia opinión y una
  -- misma categoría nacería con un papel distinto según por dónde se entrase.
  v_rol := case p_clave
             when 'compras'              then 'COSTE_VENTAS'
             when 'servicios_terceros'   then 'COSTE_VENTAS'
             when 'salarios'             then 'PERSONAL'
             when 'retenciones_nomina'   then 'PERSONAL'
             when 'comisiones_bancarias' then 'OTRO'
             else 'OPERATIVO'
           end;

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
       set clave_sistema = p_clave, es_sistema = true,
           -- Solo si sigue en el default: una clasificación puesta a mano por el
           -- dueño no se le pisa (mismo criterio que la mig. 134).
           rol_pl = case when rol_pl = 'OPERATIVO' then v_rol else rol_pl end,
           updated_at = now()
     where categoria_id = v_id;
    return v_id;
  end if;

  -- (c) Crearla, ya con su papel en el estado de resultados.
  v_id := 'CATGAS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  begin
    insert into categorias_gastos (categoria_id, client_id, nombre, clave_sistema, es_sistema, rol_pl, updated_at)
    values (v_id, p_client_id, p_nombre, p_clave, true, v_rol, now());
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

-- ── 2. Reparar las categorías del sistema que nacieron sin su rol ─────────────
-- Solo las que siguen en el default: si el dueño la reclasificó a mano, manda él.
update categorias_gastos c
   set rol_pl = m.rol, updated_at = now()
  from (values ('compras',              'COSTE_VENTAS'),
               ('servicios_terceros',   'COSTE_VENTAS'),
               ('salarios',             'PERSONAL'),
               ('retenciones_nomina',   'PERSONAL'),
               ('comisiones_bancarias', 'OTRO')) as m(clave, rol)
 where c.clave_sistema = m.clave
   and c.parent_id is null
   and c.rol_pl = 'OPERATIVO'
   and m.rol <> 'OPERATIVO';

-- ── 3. Índice para localizar el gasto de retenciones de una nómina ───────────
-- `eliminarNomina` lo necesita para revertir las DOS filas (la de Salarios la
-- encuentra por `nominas.gasto_id`; esta, por su origen).
create index if not exists idx_gastos_origen
  on gastos_cobros (client_id, origen_tipo, origen_id)
  where origen_tipo is not null;

comment on column gastos_cobros.origen_tipo is
  'Qué generó este registro automáticamente: FACTURA (CxP de servicios), '
  'NOMINA (retenciones de una nómina confirmada), IMPORTACION. NULL = alta manual.';

notify pgrst, 'reload schema';
