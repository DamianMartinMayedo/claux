-- ================================================================
-- MIGRACIÓN 166: una fila de `gastos_cobros` deja de ser SIEMPRE las dos cosas
--
-- PROBLEMA. Hoy cada fila de `gastos_cobros` cumple dos papeles a la vez:
--   · es una LÍNEA DE COSTE del estado de resultados (por su categoría y su rol_pl)
--   · es una DEUDA en Cuentas por pagar (saldo = monto − Σ liquidado en Tesorería)
-- Funcionaba porque hasta ahora coste y deuda eran el mismo número en toda fila.
--
-- La mig. 144 rompió esa coincidencia por primera vez —el subsidio de la nómina: el
-- trabajador lo cobra pero a la empresa no le cuesta, se lo reembolsa la Seguridad
-- Social— y se resolvió con una excepción escrita a mano, `cobroEsIngreso()`, más un
-- comentario avisando de que cualquier consumidor nuevo tenía que acordarse de ella.
--
-- Ahora la nómina la rompe en serio, y por una razón de negocio, no técnica: **el
-- coste de las vacaciones se reconoce el mes en que se ACUMULAN y el pago sale el mes
-- en que se DISFRUTAN**. De ahí que el reparto por acreedor y el reparto por categoría
-- de coste sean dos listas distintas del mismo dinero:
--
--   COSTE = (devengado − vacaciones disfrutadas) + acumulación del mes + aportes
--   DEUDA = neto a percibir + retenciones + aportes
--   COSTE − DEUDA = acumulación − vacaciones disfrutadas
--
-- Escribir los dos juegos de filas sin distinguirlos DUPLICARÍA el coste de personal
-- del estado de resultados y la deuda de CxP. Y no vale un booleano «genera deuda»:
-- deja sin expresar el caso «deuda sin coste», que es justo el del salario neto y las
-- retenciones (su coste ya está dentro del devengado; contarlo otra vez es el agujero
-- que cerró la mig. 139, por la puerta contraria).
--
-- SOLUCIÓN. `naturaleza`, con TRES valores, en la FILA —no en la categoría—:
--
--   AMBAS  (defecto) → cuenta como coste Y genera saldo. Todo lo que existe hoy.
--   COSTE            → cuenta en el P&L, NO aparece en CxP/CxC ni en Tesorería.
--   DEUDA            → genera saldo, NO cuenta en el P&L.
--
-- **En la fila y no en la categoría, a propósito.** Marcar la categoría «Salario»
-- como «no genera deuda» haría que cualquier gasto que el dueño anote a mano en esa
-- categoría desapareciera de Cuentas por pagar: una decisión de la nómina cambiando
-- el comportamiento de apuntes ajenos.
--
-- **`AMBAS` por defecto** es lo que hace que esta migración no mueva ni una cifra: el
-- histórico entero se comporta exactamente igual que antes.
--
-- El subsidio pasa de excepción a caso normal de la regla (`DEUDA`), y con eso
-- `cobroEsIngreso()` deja de ser una lista de orígenes y pasa a leer la columna.
--
-- ── También aquí, porque son la misma entrega ────────────────────────────────
--  · `empresa_config_nomina.dia_pago`: el día del mes en que esa empresa paga su
--    nómina. Es config de la EMPRESA, no de cada nómina, y alimenta el `vencimiento`
--    (que ya existe desde la mig. 023 y ya mueve el aging) de las CxP que genera
--    confirmar. Hoy no existe en ninguna parte y las deudas de nómina nacen sin
--    vencimiento, o sea fuera del aging.
--  · `nomina_gasto_mapeo`: qué categoría de gasto recibe cada concepto de coste de la
--    nómina, por empresa. Hasta ahora el reparto estaba fijo en código («Salarios» y
--    «Retenciones de nómina»). El dueño puede mandar varios conceptos a la MISMA
--    categoría si quiere un estado de resultados más agregado —es una decisión suya
--    legítima—, y aun así **se escribe una fila por concepto**: agrupar en el informe
--    (que ya agrupa por `categoria_id`) es reversible; fusionar las filas destruiría
--    la separación de la deuda, que es lo que se quiere ganar.
--
-- Plan: docs/planes/nomina-coste-deuda-plan-de-trabajo.md (Fase 3)
-- ================================================================

-- ── 1. La naturaleza de la fila ──────────────────────────────────────────────
alter table public.gastos_cobros
  add column if not exists naturaleza text not null default 'AMBAS';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gc_naturaleza_ck') then
    alter table public.gastos_cobros
      add constraint gc_naturaleza_ck check (naturaleza in ('COSTE', 'DEUDA', 'AMBAS'));
  end if;
end $$;

comment on column public.gastos_cobros.naturaleza is
  'COSTE = solo estado de resultados · DEUDA = solo CxP/CxC y Tesorería · AMBAS = las '
  'dos cosas (defecto, y el comportamiento de todo lo anterior a la mig. 166). Va en la '
  'fila y no en la categoría: la categoría la comparten los apuntes que el dueño teclea '
  'a mano y no puede cambiarles el comportamiento.';

create index if not exists idx_gc_naturaleza on public.gastos_cobros (client_id, naturaleza);

-- El subsidio de la nómina (mig. 144) era la única fila que ya se comportaba como
-- DEUDA-sin-coste, mediante la excepción de `cobroEsIngreso()`. Pasa a decirlo en la
-- columna, y la excepción en código desaparece.
update public.gastos_cobros
   set naturaleza = 'DEUDA'
 where tipo = 'COBRO' and origen_tipo = 'NOMINA' and naturaleza = 'AMBAS';

-- ── 2. Día de pago de la nómina, por empresa ─────────────────────────────────
alter table public.empresa_config_nomina
  add column if not exists dia_pago smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ecn_dia_pago_ck') then
    alter table public.empresa_config_nomina
      add constraint ecn_dia_pago_ck check (dia_pago is null or (dia_pago >= 1 and dia_pago <= 31));
  end if;
end $$;

comment on column public.empresa_config_nomina.dia_pago is
  'Día del mes en que esta empresa paga su nómina. NULL = sin fijar, y entonces las '
  'CxP de la nómina nacen sin vencimiento (como hasta la mig. 166). Un 31 en un mes de '
  '30 se ajusta al último día del mes al calcular, no se rechaza.';

-- ── 3. Mapeo concepto de coste → categoría de gasto ─────────────────────────
-- `concepto` es una clave del catálogo de código (src/lib/rrhh/conceptos.ts), no un
-- FK: SALARIO no es un `concepto_clave` de ítem sino un agregado (el devengado sin
-- vacaciones). Sin `check` cerrado por lo mismo que en la mig. 165 — el catálogo vive
-- en código, junto al nombre de cada clave.
create table if not exists public.nomina_gasto_mapeo (
  mapeo_id     text primary key,
  client_id    text not null,
  empresa_id   text not null,
  concepto     text not null,
  categoria_id text not null references public.categorias_gastos (categoria_id) on delete cascade,
  updated_at   timestamptz not null default now(),

  constraint ngm_unico unique (client_id, empresa_id, concepto)
);

create index if not exists idx_ngm_client on public.nomina_gasto_mapeo (client_id, empresa_id);

comment on table public.nomina_gasto_mapeo is
  'Qué categoría de gasto recibe cada concepto de coste de la nómina, por empresa. Sin '
  'fila, se usa la categoría de sistema por defecto de ese concepto. Varios conceptos '
  'pueden apuntar a la MISMA categoría (decisión legítima del dueño): se sigue '
  'escribiendo una fila de gasto por concepto y agrupa el informe.';

-- Sin política RLS y es lo correcto: igual que las cinco tablas de nómina de las
-- migs. 145→147, solo se accede por `service_role` desde el portal (el aislamiento lo
-- da el `client_id` de cada consulta, no RLS). Añadir una política costaba
-- rendimiento medido sin aportar nada.
alter table public.nomina_gasto_mapeo enable row level security;
grant select, insert, update, delete on public.nomina_gasto_mapeo to service_role;

-- ── 4. La séptima categoría de sistema ───────────────────────────────────────
-- La acumulación de vacaciones pasa a ser COSTE y necesita su propia línea del renglón
-- Personal. Sin este `case` la categoría nacería en 'OPERATIVO' y la provisión caería
-- FUERA del coste de personal del estado de resultados — el mismo fallo que la mig. 139
-- arregló para «Salarios». Se reescribe la función entera porque el `case` es su cuerpo.
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
  v_rol := case p_clave
             when 'compras'                 then 'COSTE_VENTAS'
             when 'servicios_terceros'      then 'COSTE_VENTAS'
             when 'salarios'                then 'PERSONAL'
             when 'retenciones_nomina'      then 'PERSONAL'
             when 'impuestos_salario'       then 'PERSONAL'
             when 'contribucion_ss_empresa' then 'PERSONAL'
             when 'vacaciones_acumuladas'   then 'PERSONAL'   -- nuevo (mig. 166)
             when 'comisiones_bancarias'    then 'OTRO'
             else 'OPERATIVO'
           end;

  select categoria_id into v_id from categorias_gastos
   where client_id = p_client_id and clave_sistema = p_clave
   limit 1;
  if v_id is not null then return v_id; end if;

  select categoria_id into v_id from categorias_gastos
   where client_id = p_client_id and nombre = p_nombre and parent_id is null
   limit 1;
  if v_id is not null then
    update categorias_gastos
       set clave_sistema = p_clave, es_sistema = true,
           rol_pl = case when rol_pl = 'OPERATIVO' then v_rol else rol_pl end,
           updated_at = now()
     where categoria_id = v_id;
    return v_id;
  end if;

  v_id := 'CATGAS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  begin
    insert into categorias_gastos (categoria_id, client_id, nombre, clave_sistema, es_sistema, rol_pl, updated_at)
    values (v_id, p_client_id, p_nombre, p_clave, true, v_rol, now());
  exception when unique_violation then
    select categoria_id into v_id from categorias_gastos
     where client_id = p_client_id and clave_sistema = p_clave limit 1;
    if v_id is null then
      select categoria_id into v_id from categorias_gastos
       where client_id = p_client_id and nombre = p_nombre and parent_id is null limit 1;
    end if;
  end;
  return v_id;
end;
$$;

-- ── 5. La purga del tenant, con la tabla nueva ──────────────────────────────
-- `eliminar_cliente()` se queda corta en silencio con cada tabla nueva, así que se
-- reescribe entera (última versión: mig. 156) y el centinela
-- `tablas_tenant_sin_purgar()` lo comprueba al final: si faltara alguna, esta
-- migración no se aplica.
create or replace function eliminar_cliente(p_client_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from clients where client_id = p_client_id) then
    raise exception 'El cliente % no existe.', p_client_id;
  end if;

  if exists (select 1 from payments where client_id = p_client_id and estado = 'confirmado') then
    raise exception 'El cliente % tiene pagos confirmados; no se puede borrar (archívalo).', p_client_id;
  end if;

  delete from caja_ticket_lineas        where client_id = p_client_id;
  delete from caja_tickets              where client_id = p_client_id;
  delete from caja_sesiones             where client_id = p_client_id;
  delete from cajas                     where client_id = p_client_id;
  delete from ofertas                   where client_id = p_client_id;
  delete from facturas                  where client_id = p_client_id;
  delete from compra_lineas             where client_id = p_client_id;
  delete from compras                   where client_id = p_client_id;
  delete from conteo_lineas             where client_id = p_client_id;
  delete from conteos                   where client_id = p_client_id;
  delete from movimientos_inventario    where client_id = p_client_id;
  delete from stock_almacenes           where client_id = p_client_id;
  delete from producto_almacen_config   where client_id = p_client_id;
  delete from producto_precios_historial where client_id = p_client_id;
  delete from movimientos_tesoreria     where client_id = p_client_id;
  delete from gastos_cobros             where client_id = p_client_id;
  delete from cuentas                   where client_id = p_client_id;

  -- ANTES de `categorias_gastos`: el mapeo tiene FK a ella (con CASCADE, pero
  -- explícito para que el centinela no tenga que confiar en el orden).
  delete from nomina_gasto_mapeo        where client_id = p_client_id;
  delete from categorias_gastos         where client_id = p_client_id;

  delete from suscripciones             where client_id = p_client_id;

  delete from dossier_lineas            where client_id = p_client_id;
  delete from dossier_secciones         where client_id = p_client_id;
  delete from dossier_serie             where client_id = p_client_id;
  delete from dossiers                  where client_id = p_client_id;
  delete from dossier_costo_ventas      where client_id = p_client_id;

  delete from nomina_linea_conceptos    where client_id = p_client_id;
  delete from nomina_lineas             where client_id = p_client_id;
  delete from nominas                   where client_id = p_client_id;
  delete from incidencias_nomina        where client_id = p_client_id;
  delete from conceptos_empleado        where client_id = p_client_id;
  delete from deducciones_reglas        where client_id = p_client_id;
  delete from empresa_config_nomina     where client_id = p_client_id;
  delete from turno_asignaciones        where client_id = p_client_id;
  delete from turnos                    where client_id = p_client_id;
  delete from contratos                 where client_id = p_client_id;
  delete from empleados                 where client_id = p_client_id;
  delete from recurso_horarios          where client_id = p_client_id;
  delete from reserva_franjas           where client_id = p_client_id;
  delete from reserva_cierres           where client_id = p_client_id;
  delete from reservas                  where client_id = p_client_id;
  delete from servicios                 where client_id = p_client_id;
  delete from recursos                  where client_id = p_client_id;
  delete from catalogo_items            where client_id = p_client_id;
  delete from catalogo_categorias       where client_id = p_client_id;
  delete from product_categories        where client_id = p_client_id;
  delete from products                  where client_id = p_client_id;
  delete from almacenes                 where client_id = p_client_id;
  delete from tasas_cambio              where client_id = p_client_id;
  delete from pares_tasa                where client_id = p_client_id;
  delete from monedas                   where client_id = p_client_id;
  delete from third_parties             where client_id = p_client_id;
  delete from ia_uso                    where client_id = p_client_id;
  delete from ia_conversaciones         where client_id = p_client_id;
  delete from consecutivos_venta        where client_id = p_client_id;
  delete from consecutivos_compra       where client_id = p_client_id;
  delete from telegram_updates          where client_id = p_client_id;
  delete from telegram_sessions         where client_id = p_client_id;
  delete from soporte_mensajes          where client_id = p_client_id;
  delete from presupuestos_instalacion  where client_id = p_client_id;

  delete from import_lotes              where client_id = p_client_id;

  delete from asesores                  where client_id = p_client_id;
  delete from uso_portal                where client_id = p_client_id;

  delete from payments                  where client_id = p_client_id;
  delete from empresas                  where client_id = p_client_id;
  delete from client_users              where client_id = p_client_id;
  delete from clients                   where client_id = p_client_id;
end;
$$;

do $$
declare pendientes text;
begin
  select string_agg(tabla, ', ') into pendientes from tablas_tenant_sin_purgar();
  if pendientes is not null then
    raise exception 'Tablas con client_id fuera de eliminar_cliente(): %', pendientes;
  end if;
end $$;

notify pgrst, 'reload schema';
