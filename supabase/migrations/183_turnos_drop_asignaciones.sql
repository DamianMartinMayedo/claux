-- ================================================================
-- MIGRACIÓN 183: RRHH · Turnos — retirar la vieja «semana tipo»
--
-- Plan turnos-frecuencia, Fase 8 (cleanup). La mig. 182 sustituyó `turno_asignaciones`
-- (empleado, día 1-7, turno) por el modelo de rotación (`turno_patrones` + `_slots` +
-- `_miembros`). Ya nada del código escribe ni lee `turno_asignaciones`:
--   · `guardarAsignaciones` y la rejilla semanal se retiraron de la UI y las acciones.
--   · El export `turnos_cuadrante` se regenera de las rotaciones.
--   · El chequeo de dependencias del importador pasa a `turno_miembros`.
--
-- No se migran sus filas (decisión del dueño: los turnos se recrean en el modelo nuevo).
-- Se re-declara `eliminar_cliente` SIN su línea y se dropa la tabla; el centinela
-- `tablas_tenant_sin_purgar()` sigue verde.
-- ================================================================

create or replace function eliminar_cliente(p_client_id text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from clients where client_id = p_client_id) then
    raise exception 'El cliente % no existe.', p_client_id;
  end if;

  if exists (select 1 from payments where client_id = p_client_id and estado = 'confirmado') then
    raise exception 'El cliente % tiene pagos confirmados; no se puede borrar (archívalo).', p_client_id;
  end if;

  delete from caja_turno_movimientos    where client_id = p_client_id;
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

  delete from nomina_gasto_mapeo        where client_id = p_client_id;
  delete from categorias_gastos         where client_id = p_client_id;

  delete from suscripciones             where client_id = p_client_id;

  delete from dossier_aperturas         where client_id = p_client_id;
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
  delete from turno_miembros            where client_id = p_client_id;
  delete from turno_patron_slots        where client_id = p_client_id;
  delete from turno_patrones            where client_id = p_client_id;
  delete from turnos                    where client_id = p_client_id;
  delete from contratos                 where client_id = p_client_id;
  delete from empleados                 where client_id = p_client_id;
  delete from recurso_ausencias         where client_id = p_client_id;
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
  delete from telegram_envios           where client_id = p_client_id;
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
$function$;

-- Fuera la tabla vieja (sus índices y grants caen con ella).
drop table if exists public.turno_asignaciones;

-- El centinela debe seguir en verde tras el drop.
do $$
declare pendientes text;
begin
  select string_agg(tabla, ', ') into pendientes from tablas_tenant_sin_purgar();
  if pendientes is not null then
    raise exception 'Tablas con client_id fuera de eliminar_cliente(): %', pendientes;
  end if;
end $$;

notify pgrst, 'reload schema';
