-- ─────────────────────────────────────────────────────────────────────────────
-- 216 · El presupuesto de instalación habla de NIVEL, no de tarifa
--
-- Plan: docs/planes/niveles-comerciales.md (§7, fase 5)
--
-- La 215 renombró `clients.tarifa` → `clients.nivel`. `presupuestos_instalacion`
-- guarda un SNAPSHOT del mismo eje —qué se le cotizó a este cliente y con qué
-- precios— y se quedó con el nombre viejo y con valores que ya no existen en
-- ninguna otra tabla: un presupuesto decía 'fundador' mientras su cliente decía
-- 'inicial'. Dos vocabularios para lo mismo es exactamente cómo nace un informe
-- que no cuadra.
--
-- OJO: `tarifa_hora_usd` NO se toca. Es otra cosa —cuánto se cobra la hora de
-- instalación (mig. 168)— y comparte prefijo por casualidad.
--
-- Los presupuestos ya emitidos conservan sus importes intactos: esto renombra el
-- eje, no recalcula nada. `coste_instalacion_usd`, `cuota_mensual_usd` y
-- `total_final_usd` son snapshots cerrados y así se quedan.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'presupuestos_instalacion' and column_name = 'tarifa'
  ) then
    alter table public.presupuestos_instalacion rename column tarifa to nivel;
  end if;
end $$;

-- El CHECK viejo sobrevive al rename (Postgres renombra la columna, no la
-- restricción) y sigue exigiendo 'fundador'/'estandar': si no se retira primero,
-- el UPDATE de abajo lo viola y la migración entera se cae.
alter table public.presupuestos_instalacion drop constraint if exists presupuestos_instalacion_tarifa_check;
alter table public.presupuestos_instalacion alter column nivel drop default;

update public.presupuestos_instalacion
   set nivel = case nivel
                 when 'fundador' then 'inicial'
                 when 'estandar' then 'empresa'
                 else 'inicial'
               end
 where nivel is null or nivel not in ('inicial', 'empresa', 'pro');

alter table public.presupuestos_instalacion alter column nivel set default 'inicial';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'presupuestos_instalacion_nivel_check'
  ) then
    alter table public.presupuestos_instalacion
      add constraint presupuestos_instalacion_nivel_check
      check (nivel in ('inicial', 'empresa', 'pro'));
  end if;
end $$;

comment on column public.presupuestos_instalacion.nivel is
  'Nivel comercial cotizado (inicial/empresa/pro). Snapshot: no se recalcula al cambiar el del cliente.';
