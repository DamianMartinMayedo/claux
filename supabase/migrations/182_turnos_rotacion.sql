-- ================================================================
-- MIGRACIÓN 182: RRHH · Turnos por ROTACIÓN y roster
--
-- Plan: docs/planes/turnos-frecuencia.md (Fase 1). Sustituye la «semana tipo»
-- (rejilla empleado × 7 días de `turno_asignaciones`) por un modelo de ROTACIÓN
-- generativo, en tres niveles:
--
--   turnos              → la FRANJA horaria (ya existe: Mañana 09-15, Noche…). No cambia.
--   turno_patrones      → un CICLO (semanal/quincenal/mensual/N×M) con fecha ancla.
--   turno_patron_slots  → qué franja toca en cada día del ciclo (NULL = descanso).
--   turno_miembros      → qué personas siguen el patrón, con su offset (escalonado).
--
-- El cuadrante y los `dias_trabajados` de la nómina se DERIVAN por aritmética
-- (patrón + ancla + offset + calendario); no se materializa día a día. Así el puente
-- puro a nómina (`lib/rrhh/dias-trabajados.ts`) sigue sin I/O.
--
-- Numeración: TPA- (patrón) · TPS- (slot) · TMI- (miembro).
--
-- SIN migración de datos (decisión del dueño): los turnos existentes se recrean.
-- `turno_asignaciones` se conserva sin uso hasta el cleanup (fase 8 del plan).
-- ================================================================

-- ── turno_patrones ──────────────────────────────────────────────────────────────
create table if not exists public.turno_patrones (
  patron_id      text        primary key,                 -- TPA-XXXXXXXX
  client_id      text        not null,
  empresa_id     text        not null,
  nombre         text        not null,
  tipo           text        not null
                 check (tipo in ('SEMANAL', 'QUINCENAL', 'MENSUAL', 'CICLO')),
  longitud_dias  int         not null check (longitud_dias between 1 and 366),
  fecha_ancla    date        not null,                     -- día 0 del ciclo (referencia)
  activo         boolean     not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── turno_patron_slots ──────────────────────────────────────────────────────────
-- Una fila por posición del ciclo (0 … longitud_dias-1). `turno_id` NULL = descanso.
create table if not exists public.turno_patron_slots (
  slot_id     text        primary key,                    -- TPS-XXXXXXXX
  client_id   text        not null,
  patron_id   text        not null,
  posicion    int         not null check (posicion >= 0),
  turno_id    text,                                        -- franja; NULL = descanso
  created_at  timestamptz not null default now()
);

-- ── turno_miembros ──────────────────────────────────────────────────────────────
-- El roster del patrón. `offset_ciclo` desplaza el arranque de cada persona (escalonar
-- la cobertura, o arrancar en «semana B»). Una persona puede estar en varios patrones.
create table if not exists public.turno_miembros (
  miembro_id    text        primary key,                  -- TMI-XXXXXXXX
  client_id     text        not null,
  patron_id     text        not null,
  empleado_id   text        not null,
  offset_ciclo  int         not null default 0,
  created_at    timestamptz not null default now()
);

-- ── Índices ─────────────────────────────────────────────────────────────────────
create index if not exists idx_tpa_client  on public.turno_patrones (client_id);
create index if not exists idx_tpa_empresa on public.turno_patrones (empresa_id);

create index        if not exists idx_tps_client     on public.turno_patron_slots (client_id);
create unique index if not exists uq_tps_patron_pos  on public.turno_patron_slots (patron_id, posicion);

create index        if not exists idx_tmi_client     on public.turno_miembros (client_id);
create index        if not exists idx_tmi_empleado   on public.turno_miembros (empleado_id);
create unique index if not exists uq_tmi_patron_emp  on public.turno_miembros (patron_id, empleado_id);

-- ── RLS: activada sin política (solo service_role, como todo el módulo) ───────────
alter table public.turno_patrones     enable row level security;
alter table public.turno_patron_slots enable row level security;
alter table public.turno_miembros     enable row level security;

grant select, insert, update, delete on public.turno_patrones     to service_role;
grant select, insert, update, delete on public.turno_patron_slots to service_role;
grant select, insert, update, delete on public.turno_miembros     to service_role;

comment on table public.turno_patrones is
  'Patrón de rotación de turnos (ciclo semanal/quincenal/mensual/N×M con fecha ancla). El cuadrante se deriva; no se materializa por fecha.';
comment on table public.turno_patron_slots is
  'Qué franja (turno) toca en cada posición del ciclo de un patrón. turno_id NULL = descanso.';
comment on table public.turno_miembros is
  'Roster de un patrón: qué empleados lo siguen, con su offset dentro del ciclo.';

-- ── Purga del tenant ─────────────────────────────────────────────────────────────
-- Memoria `listas-a-mano-derivan`: `eliminar_cliente` se queda corta con cada tabla
-- nueva, en silencio. Las tres cuelgan solo por client_id (sin FK), así que necesitan
-- borrado EXPLÍCITO. Se re-declara la función entera (patrón del repo) y el centinela
-- `tablas_tenant_sin_purgar()` lo verifica abajo.
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
  -- Turnos por rotación (mig. 182): las tres hijas van antes que el patrón (sin FK).
  delete from turno_miembros            where client_id = p_client_id;
  delete from turno_patron_slots        where client_id = p_client_id;
  delete from turno_patrones            where client_id = p_client_id;
  delete from turno_asignaciones        where client_id = p_client_id;
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

-- Verificación en la propia migración: si queda algo fuera, esto falla y no se aplica.
do $$
declare pendientes text;
begin
  select string_agg(tabla, ', ') into pendientes from tablas_tenant_sin_purgar();
  if pendientes is not null then
    raise exception 'Tablas con client_id fuera de eliminar_cliente(): %', pendientes;
  end if;
end $$;

notify pgrst, 'reload schema';
