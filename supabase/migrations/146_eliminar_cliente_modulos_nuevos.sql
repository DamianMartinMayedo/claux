-- ================================================================
-- MIGRACIÓN 146: `eliminar_cliente()` se había quedado atrás
--
-- PROBLEMA. La función enumera A MANO las tablas del tenant que purga (mig. 096,
-- retocada por la 140). Es una lista literal, así que **cada módulo nuevo la deja
-- desactualizada en silencio**: nada falla al crear la tabla, nada falla al borrar
-- el cliente, y el fallo solo se ve cuando alguien va a buscar por qué hay filas de
-- un cliente que ya no existe. Desde la 096 se han añadido suscripciones, dossiers,
-- notificaciones, el importador, los asesores y el contador de uso del portal, y
-- ninguno entró en la lista.
--
-- Hoy no hay huérfanas —ningún cliente se ha borrado desde que existen esos
-- módulos—, así que esto se arregla ANTES de que haya que limpiarlas a mano y no
-- después. Filas que habrían quedado colgando al purgar un cliente de prueba:
-- 4 dossiers con sus 82 filas hijas, 6 suscripciones con 8 líneas, 2 lotes de
-- importación, 1 asesor, 89 de uso_portal, 7 de dossier_costo_ventas.
--
-- LOS TRES GRUPOS. No todas las tablas con `client_id` van en la lista, y meterlas
-- todas sería tan incorrecto como faltarle diez. Comprobado contra `pg_constraint`,
-- no supuesto:
--
--  1) LAS QUE HAY QUE BORRAR AQUÍ (10). No tienen FK a `clients`, así que nadie las
--     limpia por ellas. Son las que añade esta migración.
--
--  2) LAS QUE SE BORRAN SOLAS por `ON DELETE CASCADE` desde `clients`, y por tanto
--     **no se duplican** —el `delete from clients` final las arrastra—:
--       · admin_notificaciones  (admin_notificaciones_client_id_fkey)
--       · notificaciones        (notificaciones_client_id_fkey)
--       · notificacion_config   (notificacion_config_client_id_fkey)
--     Igual que ya ocurría con empresa_usuario, usuario_modulo e ia_mensajes, que
--     ni siquiera tienen `client_id`. Y por la misma razón NO se añade
--     `suscripcion_lineas`: cuelga de `suscripciones` con CASCADE
--     (suscripcion_lineas_suscripcion_id_fkey), igual que `import_lote_items`
--     cuelga de `import_lotes` (import_lote_items_lote_id_fkey) — esa además no
--     tiene `client_id`, así que el CASCADE es la ÚNICA vía de limpiarla.
--
--  3) LA QUE NO SE BORRA A PROPÓSITO: `emails_log`. Su FK es `ON DELETE SET NULL`,
--     así que la traza de envíos sobrevive al cliente con `client_id` a NULL. Es
--     deliberado y ya venía documentado en la 096: si un envío rebotó o se marcó
--     como inválido, el registro tiene que seguir ahí para diagnosticar. **No se
--     toca.** (Hay 15 filas con `client_id` NULL, coherente con ese diseño.)
--
-- ORDEN. Las hijas de `dossiers` (dossier_lineas, dossier_secciones, dossier_serie)
-- se borran antes que su padre. Ojo: hoy **no tienen FK** a `dossiers` —cuelgan solo
-- por `dossier_id`—, así que el orden no lo impone la base, lo imponemos aquí. Si
-- algún día se les pone la FK, la función ya está en el orden correcto y no habrá
-- que volver a tocarla.
--
-- Y PARA QUE NO SE REPITA. El problema de fondo no es la lista, es que nada avisa
-- cuando se queda corta. Se añade `tablas_tenant_sin_purgar()`, de solo lectura, que
-- cruza `information_schema` con el cuerpo de la función y devuelve lo que falte.
-- Lleva dentro las excepciones justificadas de los grupos 2 y 3, así que devolver
-- cero filas es la afirmación completa. Al crear una tabla con `client_id`: correrla.
-- ================================================================

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
  -- se conserva a propósito (emails_log) está explicado en la cabecera.
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

-- ── El centinela ────────────────────────────────────────────────────────────────
-- Devuelve las tablas con `client_id` que `eliminar_cliente()` no purga y que no
-- están justificadas. Cero filas = la lista está completa. Solo lectura.
create or replace function tablas_tenant_sin_purgar()
returns table (tabla text, motivo text)
language sql
stable
security definer
set search_path = public
as $$
  with def as (
    select pg_get_functiondef(oid) as cuerpo
    from pg_proc where proname = 'eliminar_cliente'
  ),
  -- Excepciones justificadas. Añadir aquí SOLO con su razón, nunca para silenciar.
  justificadas(tabla, motivo) as (
    values
      ('admin_notificaciones', 'CASCADE desde clients'),
      ('notificaciones',       'CASCADE desde clients'),
      ('notificacion_config',  'CASCADE desde clients'),
      ('suscripcion_lineas',   'CASCADE desde suscripciones'),
      ('emails_log',           'SET NULL a propósito: conserva la traza de envíos')
  ),
  tenant as (
    select c.table_name::text as tabla
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'client_id'
      and t.table_type  = 'BASE TABLE'
  )
  select tenant.tabla, 'sin delete y sin justificación'::text
  from tenant
  where not (select cuerpo from def) ~ ('delete from\s+' || tenant.tabla || '\s')
    and tenant.tabla not in (select j.tabla from justificadas j)
  order by 1;
$$;

-- Verificación en la propia migración: si queda algo fuera, esto falla y no se aplica.
do $$
declare pendientes text;
begin
  select string_agg(tabla, ', ') into pendientes from tablas_tenant_sin_purgar();
  if pendientes is not null then
    raise exception 'Tablas con client_id fuera de eliminar_cliente(): %', pendientes;
  end if;
end $$;
