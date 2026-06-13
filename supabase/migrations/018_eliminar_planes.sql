-- 018 — Eliminar el sistema de planes heredado y consolidar el modelo base + módulos à la carte.
--
-- Contexto: el precio y el gating ya no salen de `plans` (Básico/Profesional/Empresarial)
-- sino de `clients.modulos_activos` + `modulos_catalogo` (migración 017). Esta migración
-- retira por completo la tabla `plans`, añade el ciclo de facturación por cliente
-- (mensual/anual con descuento), el concepto del pago (suscripción/configuración) y los
-- ajustes configurables de facturación.
--
-- Decisión del propietario: "eliminar por completo" los planes. Se conserva el importe de los
-- pagos históricos pero se vacía `plan_id` (la columna queda inerte y anulable, sin FK).

-- ── 1. Ciclo de facturación por cliente ──────────────────────────────
alter table clients
  add column if not exists ciclo_facturacion text not null default 'mensual';
-- valores: 'mensual' | 'anual' (anual con descuento configurable)

-- ── 2. Concepto del pago (para distinguir suscripción del pago único de configuración) ──
alter table payments
  add column if not exists concepto text not null default 'suscripcion';
-- valores: 'suscripcion' | 'configuracion'

-- ── 3. Ajustes configurables de facturación (key/value en settings) ──
insert into settings (key, value) values
  ('pago_setup_usd_default', '1000'),
  ('descuento_anual_pct',    '10'),
  ('dias_trial_default',     '15')
on conflict (key) do nothing;

-- ── 4. Backfill: clientes sin módulos → base contable mínima ─────────
-- (cubre clientes creados bajo el modelo de planes que aún tienen modulos_activos vacío)
update clients
set modulos_activos   = array['base'],
    precio_mensual_usd = coalesce(
      (select precio_estandar_usd from modulos_catalogo where clave = 'base'), 0)
where coalesce(array_length(modulos_activos, 1), 0) = 0;

-- ── 5. Eliminar la tabla plans ───────────────────────────────────────
-- 5a. plan_id pasa a anulable en clients y payments (queda como columna histórica inerte).
alter table clients  alter column plan_id drop not null;
alter table payments alter column plan_id drop not null;

-- 5b. Eliminar cualquier FK que apunte a plans (nombres independientes del entorno).
do $$
declare r record;
begin
  for r in (
    select conrelid::regclass::text as tbl, conname
    from pg_constraint
    where confrelid = 'plans'::regclass and contype = 'f'
  ) loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

-- 5c. Vaciar las referencias históricas a plan (se conserva el importe del pago).
update payments set plan_id = null;
update clients  set plan_id = null;

-- 5d. Eliminar la tabla.
drop table if exists plans cascade;

notify pgrst, 'reload schema';
