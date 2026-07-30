-- ================================================================
-- MIGRACIÓN 153: el stock mínimo, por almacén
--
-- PROBLEMA (verificado con datos reales el 2026-07-29). `products.stock_minimo`
-- es UN número por cliente, pero el stock vive por `(producto, almacén)` y los
-- almacenes son de empresas distintas. En el tenant de pruebas hay almacenes en
-- TRES empresas y el «Arroz 1kg» marcaba 217 unidades sobre un mínimo de 30
-- —todo bien— mientras el Almacén Central estaba en **−3**. Un local puede
-- quedarse sin mercancía mientras el consolidado va sobrado, y nadie se entera.
--
-- POR QUÉ UNA TABLA NUEVA Y NO UNA COLUMNA EN `stock_almacenes`. Es la decisión
-- de fondo de esta migración, y las dos razones son del SQL de la mig. 037:
--
--   1) `inv_recalcular_stock()` hace `delete from stock_almacenes where
--      client_id = ...` y reinserta desde el ledger. El botón «Recalcular stock»
--      —la red de seguridad, que el dueño pulsa justo cuando algo no cuadra—
--      BORRARÍA todos los mínimos por almacén en silencio.
--   2) Esa reinserción lleva `having sum(delta) <> 0`: un almacén cuyo stock
--      llega exactamente a 0 pierde su fila. Y el mínimo tiene que sobrevivir
--      precisamente al momento en que el stock llega a cero, que es cuando
--      importa.
--
-- El recálculo no se toca (es la red de seguridad del módulo). El mínimo es
-- CONFIGURACIÓN, no saldo, así que vive aparte y sobrevive a cualquier
-- reconstrucción del ledger.
--
-- OPCIONAL POR DISEÑO. `stock_minimo` NULL —o sin fila— significa «usa el global
-- de `products`», que es exactamente el comportamiento de hoy. Nadie pierde nada
-- al aplicar esto y el aviso solo se vuelve fino donde el dueño se ha molestado
-- en configurarlo.
--
-- SIN POLÍTICA RLS, a propósito: solo la lee el portal por `service_role`
-- (`createAdminClient`), y sin política es la configuración más cerrada posible
-- (migs. 145 → 147). El admin no la consulta por el cliente autenticado.
-- ================================================================

create table if not exists producto_almacen_config (
  client_id    text          not null,
  producto_id  text          not null,
  almacen_id   text          not null,
  stock_minimo numeric(18,3),                       -- NULL = usa el global de products
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now(),
  primary key (producto_id, almacen_id)             -- el mismo par que stock_almacenes
);

create index if not exists idx_prod_alm_config_client
  on producto_almacen_config (client_id);

comment on table producto_almacen_config is
  'Configuración por (producto, almacén). Hoy solo el stock mínimo. NO es un saldo: '
  'vive fuera de stock_almacenes porque inv_recalcular_stock() borra y reinserta esa '
  'tabla entera (mig. 037) y se llevaría los mínimos por delante. Ver mig. 153.';

comment on column producto_almacen_config.stock_minimo is
  'Mínimo para ESE almacén. NULL o sin fila = se usa products.stock_minimo (el global).';

-- ── eliminar_cliente(): la lista se queda corta en silencio ──────────────────
-- La función enumera A MANO las tablas del tenant (mig. 146). Toda tabla nueva
-- con `client_id` entra aquí o deja filas huérfanas al purgar un cliente, sin que
-- nada falle. `tablas_tenant_sin_purgar()` es el centinela y tiene que devolver
-- cero filas: la verificación del final de esta migración lo comprueba.
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

-- Centinela: si la tabla nueva se hubiera quedado fuera, esto falla y la migración
-- no se aplica. Es el mismo bloque de la mig. 146, a propósito.
do $$
declare pendientes text;
begin
  select string_agg(tabla, ', ') into pendientes from tablas_tenant_sin_purgar();
  if pendientes is not null then
    raise exception 'Tablas con client_id fuera de eliminar_cliente(): %', pendientes;
  end if;
end $$;

notify pgrst, 'reload schema';
