-- ================================================================
-- MIGRACIÓN 096: Borrado seguro / archivado de clientes
--
-- Dos vías complementarias para retirar un cliente:
--  · archivado_at: soft-delete reversible. Conserva TODOS los datos
--    (pagos, facturación, historial). Se oculta de las listas activas.
--    Es la vía obligada para clientes con ingresos reales.
--  · eliminar_cliente(): purga total e irreversible de las ~54 tablas
--    del tenant, en una transacción. SALVAGUARDA CONTABLE: se niega a
--    borrar un cliente con pagos confirmados (usar archivado en su caso).
--    Pensada para limpiar clientes de prueba que nunca facturaron.
-- ================================================================

alter table clients add column if not exists archivado_at timestamptz;

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

  -- Purga de todas las tablas del tenant. Único orden obligatorio:
  -- client_sessions antes de client_users (FK NO ACTION) y todo antes de clients.
  -- Las tablas-hijas sin client_id (empresa_usuario, usuario_modulo, ia_mensajes)
  -- se borran solas por ON DELETE CASCADE de su padre. emails_log queda con
  -- client_id a NULL (SET NULL) para conservar la traza de envíos.
  delete from caja_ticket_lineas        where client_id = p_client_id;
  delete from caja_tickets              where client_id = p_client_id;
  delete from caja_sesiones             where client_id = p_client_id;
  delete from cajas                     where client_id = p_client_id;
  delete from sale_lines                where client_id = p_client_id;
  delete from sale_logs                 where client_id = p_client_id;
  delete from sales                     where client_id = p_client_id;
  delete from ofertas                   where client_id = p_client_id;
  delete from facturas                  where client_id = p_client_id;
  delete from compra_lineas             where client_id = p_client_id;
  delete from compras                   where client_id = p_client_id;
  delete from movimientos_inventario    where client_id = p_client_id;
  delete from stock_almacenes           where client_id = p_client_id;
  delete from producto_precios_historial where client_id = p_client_id;
  delete from movimientos_tesoreria     where client_id = p_client_id;
  delete from gastos_cobros             where client_id = p_client_id;
  delete from cuentas                   where client_id = p_client_id;
  delete from categorias_gastos         where client_id = p_client_id;
  delete from nomina_lineas             where client_id = p_client_id;
  delete from nominas                   where client_id = p_client_id;
  delete from conceptos_empleado        where client_id = p_client_id;
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
  delete from currencies                where client_id = p_client_id;
  delete from third_parties             where client_id = p_client_id;
  delete from ia_uso                    where client_id = p_client_id;
  delete from ia_conversaciones         where client_id = p_client_id;
  delete from consecutivos_venta        where client_id = p_client_id;
  delete from consecutivos_compra       where client_id = p_client_id;
  delete from telegram_updates          where client_id = p_client_id;
  delete from telegram_sessions         where client_id = p_client_id;
  delete from soporte_mensajes          where client_id = p_client_id;
  delete from presupuestos_instalacion  where client_id = p_client_id;
  delete from payments                  where client_id = p_client_id;
  delete from companies                 where client_id = p_client_id;
  delete from empresas                  where client_id = p_client_id;
  delete from client_sessions           where client_id = p_client_id;
  delete from client_users              where client_id = p_client_id;
  delete from clients                   where client_id = p_client_id;
end;
$$;

grant execute on function eliminar_cliente(text) to authenticated, service_role;

notify pgrst, 'reload schema';
