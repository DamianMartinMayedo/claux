-- ================================================================
-- MIGRACIÓN 156: conteo físico
--
-- PROBLEMA. Contar lo que hay de verdad en el almacén y cuadrar el sistema es la
-- operación obligatoria de cualquier negocio con existencias, y hoy son **N ajustes
-- a mano**, uno por producto y por almacén, cada uno con su modal. Nadie lo hace
-- así: se cuenta en papel y no se carga nunca, que es la razón real de que el stock
-- del sistema se separe de la realidad.
--
-- POR QUÉ SE PERSISTE EL BORRADOR Y NO VIVE EN MEMORIA. Contar un almacén lleva
-- horas, se hace en varias sesiones y en Cuba con cortes de luz por medio. Un conteo
-- a medias que se pierde al cerrar la pestaña no se vuelve a empezar: se abandona.
--
-- `esperado` es INFORMATIVO, no la base del ajuste. Al aplicar, la diferencia se
-- recalcula contra el stock VIVO: entre que se abrió la hoja y se aplica el conteo
-- pueden haber entrado ventas del TPV, y aplicar un delta viejo corrompería el stock
-- justo en la operación que existe para arreglarlo.
--
-- El conteo aplicado se queda de SOLO LECTURA, como una compra confirmada: es el
-- documento de lo que se contó ese día. Los ajustes que genera van al ledger con
-- `referencia_id = conteo_id`, que es lo que da la idempotencia (aplicar dos veces
-- no duplica movimientos).
--
-- SIN POLÍTICA RLS, a propósito: solo lo lee el portal por `service_role`.
-- ================================================================

create table if not exists conteos (
  conteo_id    text        primary key,
  client_id    text        not null,
  almacen_id   text        not null,
  empresa_id   text        not null,
  estado       text        not null default 'BORRADOR',   -- BORRADOR | APLICADO | ANULADO
  fecha        date        not null default current_date,
  notas        text,
  aplicado_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint conteos_estado_chk check (estado in ('BORRADOR', 'APLICADO', 'ANULADO'))
);

create index if not exists idx_conteos_client  on conteos (client_id);
create index if not exists idx_conteos_almacen on conteos (client_id, almacen_id);

create table if not exists conteo_lineas (
  conteo_id    text          not null,
  client_id    text          not null,
  producto_id  text          not null,
  esperado     numeric(18,3),                 -- stock al abrir la línea; informativo
  contado      numeric(18,3),                 -- NULL = todavía sin contar
  updated_at   timestamptz   not null default now(),
  primary key (conteo_id, producto_id)
);

create index if not exists idx_conteo_lineas_client on conteo_lineas (client_id);

comment on table conteos is
  'Conteo fisico de UN almacen (mig. 156). Contar dos a la vez es contar mal. '
  'Al aplicar genera AJUSTE por linea con diferencia, con referencia_id = conteo_id.';

comment on column conteo_lineas.esperado is
  'Stock del sistema al abrir la linea. INFORMATIVO: la diferencia se recalcula '
  'contra el stock vivo al aplicar, porque entre medias puede haber vendido el TPV.';

-- ── eliminar_cliente(): la lista se queda corta en silencio ──────────────────
-- Toda tabla nueva con `client_id` entra aquí o deja filas huérfanas al purgar un
-- cliente, sin que nada falle. `tablas_tenant_sin_purgar()` es el centinela.
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

  -- Salvaguarda contable: nunca purgar un cliente con ingresos confirmados.
  if exists (select 1 from payments where client_id = p_client_id and estado = 'confirmado') then
    raise exception 'El cliente % tiene pagos confirmados; no se puede borrar (archívalo).', p_client_id;
  end if;

  -- Purga de todas las tablas del tenant. Órdenes obligatorios: las hijas antes que
  -- sus padres y todo antes de `clients`. Lo que se borra solo por CASCADE y lo que
  -- se conserva a propósito (emails_log) está explicado en la migración 146.
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
  delete from categorias_gastos         where client_id = p_client_id;

  -- Suscripciones: `suscripcion_lineas` cae por CASCADE de su padre.
  delete from suscripciones             where client_id = p_client_id;

  -- Dossiers: las tres hijas NO tienen FK, así que van explícitas y antes del padre.
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

  -- Importador: `import_lote_items` cae por CASCADE (no tiene `client_id`).
  delete from import_lotes              where client_id = p_client_id;

  delete from asesores                  where client_id = p_client_id;
  delete from uso_portal                where client_id = p_client_id;

  delete from payments                  where client_id = p_client_id;
  delete from empresas                  where client_id = p_client_id;
  delete from client_users              where client_id = p_client_id;
  delete from clients                   where client_id = p_client_id;
end;
$$;

-- Centinela: si las tablas nuevas se hubieran quedado fuera, esto falla y la
-- migración no se aplica.
do $$
declare pendientes text;
begin
  select string_agg(tabla, ', ') into pendientes from tablas_tenant_sin_purgar();
  if pendientes is not null then
    raise exception 'Tablas con client_id fuera de eliminar_cliente(): %', pendientes;
  end if;
end $$;

notify pgrst, 'reload schema';
