-- ================================================================
-- MIGRACIÓN 210: Caja · campañas de descuento (tabla `caja_descuentos`)
--
-- Plan `caja-descuentos-turno-cambio.md`, Fase 4 (§1.7). La fase 1 dio al cajero
-- un descuento A MANO, ticket a ticket. Esto da el otro: «−10 % en todo, del 1 al
-- 7 de agosto», «este título, −20 % los martes» — puesto UNA vez desde el portal.
--
-- Lo que decide la forma y no es negociable: **la caja sincroniza solo al cerrar
-- turno**. Si el servidor precalculase «hoy este libro vale 450», el dispositivo
-- que no ha vuelto a sembrar aplicaría el precio de la semana pasada: una campaña
-- con fecha NACERÍA CADUCADA. Así que la campaña no baja como precio, baja como
-- REGLA CON SU VENTANA y la evalúa el dispositivo contra su reloj. No es una
-- confianza nueva: la app ya fecha cada ticket con el reloj del aparato.
--
-- Dos ámbitos, no tres. `TODO` y `PRODUCTO` cubren exactamente lo que se pidió
-- («descuentos por productos y por días»). `CATEGORIA` se queda fuera porque la
-- semilla no baja categorías (ficha F4); añadirla luego es un valor más en el
-- CHECK, no un rediseño.
--
-- Y NO añade nada al ticket: la campaña rellena el MISMO `descuento_pct` de la
-- migración 207. Para el cierre, la contabilidad y los informes, un −10 % de
-- campaña y un −10 % por tara son el mismo dato.
-- ================================================================

create table if not exists caja_descuentos (
  descuento_id text        primary key,                   -- DTO-XXXXXXXX
  client_id    text        not null,
  empresa_id   text        not null,                      -- la caja es de una empresa
  caja_id      text,                                      -- null = todos los puntos de venta
  nombre       text        not null,                      -- «Semana del libro»: es lo único que distingue una campaña de un descuento a mano
  pct          numeric(6,2) not null,
  ambito       text        not null,
  ambito_id    text,                                      -- producto_id cuando ambito = 'PRODUCTO'
  desde        date,                                      -- null = sin fecha de inicio
  hasta        date,                                      -- null = sin fecha de fin
  -- 0 = domingo … 6 = sábado (mismo criterio que `getDay()` del dispositivo, que
  -- es quien evalúa). Vacío = todos los días: «todos los martes» sin tabla de
  -- calendario. El aparato compara contra su día LOCAL; en el servidor cualquier
  -- informe sobre campañas usa `diaDelNegocio` (`lib/fecha-tz.ts`) y nunca UTC, o
  -- la campaña del martes arrancaría el lunes a las 20:00 (Cuba = UTC−4).
  dias_semana  int[]       not null default '{}',
  activo       boolean     not null default true,
  created_at   timestamptz not null default now(),

  constraint caja_descuentos_pct_ck    check (pct > 0 and pct <= 100),
  constraint caja_descuentos_ambito_ck check (ambito in ('TODO', 'PRODUCTO')),
  -- Un ámbito PRODUCTO sin producto descuenta en todo; un TODO con producto miente
  -- sobre lo que hace. Ninguno de los dos puede llegar a existir.
  constraint caja_descuentos_ambito_id_ck check (
    (ambito = 'PRODUCTO' and ambito_id is not null) or
    (ambito = 'TODO'     and ambito_id is null)
  ),
  constraint caja_descuentos_ventana_ck check (desde is null or hasta is null or hasta >= desde),
  constraint caja_descuentos_dias_ck    check (dias_semana <@ array[0,1,2,3,4,5,6])
);

create index if not exists idx_caja_descuentos_client
  on caja_descuentos (client_id, empresa_id) where activo;
create index if not exists idx_caja_descuentos_caja
  on caja_descuentos (caja_id) where activo;

-- ── RLS y grants (patrón del módulo: RLS on, sin políticas, vía service_role) ──
alter table public.caja_descuentos enable row level security;
grant select, insert, update, delete on public.caja_descuentos to service_role;

-- ── Purgado del tenant ───────────────────────────────────────────────────────
--   Toda tabla con `client_id` entra en eliminar_cliente() o el centinela
--   `tablas_tenant_sin_purgar()` falla esta misma migración.
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
  delete from caja_descuentos           where client_id = p_client_id;
  delete from caja_operadores_cajas     where client_id = p_client_id;
  delete from caja_operadores           where client_id = p_client_id;
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
  delete from firmas_documentos         where client_id = p_client_id;
  delete from clients                   where client_id = p_client_id;
end;
$function$;

-- El centinela debe quedar en verde: ninguna tabla con client_id fuera del purgado.
do $$
declare pendientes text;
begin
  select string_agg(tabla, ', ') into pendientes from tablas_tenant_sin_purgar();
  if pendientes is not null then
    raise exception 'Tablas con client_id fuera de eliminar_cliente(): %', pendientes;
  end if;
end $$;

notify pgrst, 'reload schema';
