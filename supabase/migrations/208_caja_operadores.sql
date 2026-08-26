-- ================================================================
-- MIGRACIÓN 208: Caja · quién abre y quién cierra el turno
--
-- Plan `caja-descuentos-turno-cambio.md`, Fase 2. Hoy `caja_sesiones.cerrada_por`
-- (mig. 171) es texto libre y opcional: sirve para un post-it, no para un informe
-- («Yoandry», «yoandri» y «Yoa» son tres personas). Y `abierta_por` no existe: del
-- turno que se abrió no queda ni el nombre.
--
-- Solución: una LISTA de operadores, calcada del patrón que Citas ya tiene en
-- producción (`recursos` + `importarPersonalRRHH`):
--   · `caja_operadores`       — la lista vive en el CLIENTE: un cajero se teclea (o
--     se importa de RRHH) UNA vez, no una por caja. `empleado_id` es OPCIONAL: sin
--     RRHH la caja funciona igual, y con RRHH el vínculo ya queda puesto para
--     cuando se retome «ventas por persona» (R3).
--   · `caja_operadores_cajas` — qué operador maneja QUÉ punto de venta. La semilla
--     baja solo los de esa caja: el mostrador de arriba no enseña los cajeros del
--     de abajo.
--
-- En la sesión se guardan ID **y NOMBRE**. El nombre es la foto del momento: si el
-- trabajador se renombra o se da de baja, el turno cerrado debe seguir diciendo
-- quién lo cerró. Mismo criterio que el `salario_base` congelado de la nómina.
--
-- Las columnas son NULLABLE a propósito. «Obligatorio» lo es en el DISPOSITIVO; el
-- camino de rescate del portal (`cerrarYContabilizar`) cierra turnos que nadie
-- cerró —se fue la luz, se perdió el móvil— y ahí no hay a quién nombrar: escribe
-- «Cerrado desde el portal por ‹usuario›». Los turnos ya abiertos no se pueden
-- backfillear y la vista pinta «—».
-- ================================================================

-- ── 1. Operadores del cliente ────────────────────────────────────────────────
create table if not exists caja_operadores (
  operador_id  text        primary key,                  -- OPE-XXXXXXXX
  client_id    text        not null,
  empresa_id   text        not null,                     -- la caja es de una empresa
  nombre       text        not null,
  empleado_id  text,                                     -- vínculo OPCIONAL con RRHH
  activo       boolean     not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists idx_caja_operadores_client on caja_operadores (client_id, empresa_id);

-- Un nombre, una ficha. Sin esto el mismo cajero acaba dos veces (tecleado una y
-- luego importado de RRHH) y el informe por persona vuelve a partirse en dos.
-- Case-insensitive: «yoandry» y «Yoandry» son la misma persona.
create unique index if not exists uq_caja_operadores_nombre
  on caja_operadores (client_id, empresa_id, lower(nombre));

-- Y un empleado de RRHH no se importa dos veces.
create unique index if not exists uq_caja_operadores_empleado
  on caja_operadores (client_id, empleado_id) where empleado_id is not null;

-- ── 2. Qué operador maneja qué caja ──────────────────────────────────────────
create table if not exists caja_operadores_cajas (
  caja_id      text not null,
  operador_id  text not null,
  client_id    text not null,                            -- para el purgado del tenant
  primary key (caja_id, operador_id)
);
create index if not exists idx_caja_op_cajas_operador on caja_operadores_cajas (operador_id);
create index if not exists idx_caja_op_cajas_client   on caja_operadores_cajas (client_id);

-- ── 3. La sesión recuerda a las dos personas ─────────────────────────────────
--   `cerrada_por` (texto) ya existe desde la 171 y se conserva: es el NOMBRE
--   congelado. Se le añade su id, y la pareja completa para la apertura.
alter table caja_sesiones
  add column if not exists abierta_por    text,
  add column if not exists abierta_por_id text,
  add column if not exists cerrada_por_id text;

-- ── 4. RLS y grants (patrón del módulo: RLS on, sin políticas, vía service_role) ──
alter table public.caja_operadores       enable row level security;
alter table public.caja_operadores_cajas enable row level security;

grant select, insert, update, delete on public.caja_operadores       to service_role;
grant select, insert, update, delete on public.caja_operadores_cajas to service_role;

-- ── 5. Purgado del tenant ────────────────────────────────────────────────────
--   Toda tabla con `client_id` entra en eliminar_cliente() o el centinela
--   `tablas_tenant_sin_purgar()` (abajo) falla la migración.
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
  -- Deuda ajena que el centinela destapó al aplicar ESTA migración:
  -- `firmas_documentos` (mig. 200) nunca entró en el purgado. No había fuga —su
  -- FK a clients es `on delete cascade`— pero el centinela llevaba en rojo desde
  -- entonces, y con él en rojo la siguiente tabla que sí filtre pasa inadvertida.
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
