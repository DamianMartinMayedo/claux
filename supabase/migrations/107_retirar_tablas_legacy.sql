-- 107 · Retirar las tablas legacy del esquema inicial en inglés
--
-- Seis tablas de la primera versión del esquema quedaron vivas en la BD después
-- de que su sucesora en español las reemplazara. Las seis están VACÍAS (0 filas)
-- y ningún punto del código las consulta:
--
--   companies       → empresas
--   currencies      → monedas
--   sales           → facturas / ofertas
--   sale_lines      → documento_lineas
--   sale_logs       → (sin sucesora; no se usa)
--   client_sessions → (sin sucesora; la sesión del portal va por cookie)
--
-- No son inertes: `companies` se comió a crearDossier, que contaba empresas ahí
-- y por tanto veía cero SIEMPRE, bloqueando la creación de dossiers a todos los
-- clientes. Mientras existan, la siguiente búsqueda de "empresa"/"venta" en el
-- esquema puede volver a encontrar la tabla equivocada primero.
--
-- OJO — rate_limits NO entra aquí aunque tampoco aparezca en ningún .from():
-- está viva y la escribe la función rl_hit() vía RPC (mig. 057).

-- 1) eliminar_cliente() borra de estas seis en su cascada manual. Hay que
--    quitarlas del cuerpo ANTES del drop: si no, borrar un cliente rompe con
--    «relation does not exist». Se recrea idéntica salvo esas seis líneas.
create or replace function public.eliminar_cliente(p_client_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  delete from empresas                  where client_id = p_client_id;
  delete from client_users              where client_id = p_client_id;
  delete from clients                   where client_id = p_client_id;
end;
$function$;

-- 2) Fuera. Sin cascade: ninguna otra tabla las referencia (0 FKs entrantes,
--    verificado), así que si algo apareciera es mejor que el drop falle a que
--    se lleve por delante una dependencia que nadie vio.
drop table if exists public.sale_lines;
drop table if exists public.sale_logs;
drop table if exists public.sales;
drop table if exists public.companies;
drop table if exists public.currencies;
drop table if exists public.client_sessions;
