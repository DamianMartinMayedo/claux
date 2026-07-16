-- ================================================================
-- MIGRACIÓN 101: Dossier — sincronía del snapshot y nombre de portada
--
-- Dos huecos que se veían al usar el módulo:
--
--  1. moneda / empresa / período son PARÁMETROS DEL SNAPSHOT, no metadatos
--     libres: la serie (`dossier_serie`) guarda los importes YA convertidos a la
--     moneda vigente al congelar. Cambiar la moneda en «Lo básico» solo reescribía
--     la etiqueta → el deck mostraba importes en la moneda vieja rotulados con la
--     nueva (y, peor, los números de otra empresa bajo el nombre nuevo). Marcamos
--     el snapshot como DESFASADO al cambiar cualquiera de los tres; el flag se
--     limpia solo al volver a escribir el snapshot (la RPC de abajo).
--
--  2. En un dossier CONSOLIDADO (empresa_id null) la portada caía al nombre de la
--     cuenta ("Negocio Test"). `nombre_portada` deja que el dueño fije qué nombre
--     ve el inversor (holding, nombre comercial…); vacío → se deriva como hasta
--     ahora (empresa si está acotado, si no el nombre de la cuenta).
-- ================================================================

alter table dossiers add column if not exists snapshot_stale boolean not null default false;
alter table dossiers add column if not exists nombre_portada text;

-- ── RPC: al escribir el snapshot, queda SINCRONIZADO ─────────────────────────
--   Reemplaza la de 098 añadiendo `snapshot_stale = false`: escribir la serie es
--   justamente lo que la pone al día con la moneda/empresa/período actuales.
create or replace function dossier_guardar_snapshot(
  p_dossier_id text,
  p_client_id  text,
  p_serie      jsonb,
  p_lineas     jsonb,
  p_tasas      jsonb,
  p_faltantes  text[]
) returns void
language plpgsql as $$
begin
  if not exists (
    select 1 from dossiers where dossier_id = p_dossier_id and client_id = p_client_id
  ) then
    raise exception 'DOSSIER_NO_ENCONTRADO';
  end if;

  delete from dossier_serie  where dossier_id = p_dossier_id and client_id = p_client_id;
  delete from dossier_lineas where dossier_id = p_dossier_id and client_id = p_client_id;

  insert into dossier_serie
    (dossier_id, client_id, mes, ingresos, costo_ventas, gastos_operativos, moneda, origen)
  select
    p_dossier_id, p_client_id,
    e->>'mes',
    coalesce((e->>'ingresos')::numeric, 0),
    coalesce((e->>'costo_ventas')::numeric, 0),
    coalesce((e->>'gastos_operativos')::numeric, 0),
    e->>'moneda',
    coalesce(e->>'origen', 'MANUAL')
  from jsonb_array_elements(coalesce(p_serie, '[]'::jsonb)) as e;

  insert into dossier_lineas
    (dossier_id, client_id, grupo, concepto, monto, orden)
  select
    p_dossier_id, p_client_id,
    e->>'grupo',
    e->>'concepto',
    coalesce((e->>'monto')::numeric, 0),
    coalesce((e->>'orden')::int, 0)
  from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) as e;

  update dossiers set
    tasas_usadas      = coalesce(p_tasas, '{}'::jsonb),
    monedas_faltantes = coalesce(p_faltantes, '{}'::text[]),
    snapshot_at       = now(),
    snapshot_stale    = false,
    updated_at        = now()
  where dossier_id = p_dossier_id and client_id = p_client_id;
end; $$;

grant execute on function dossier_guardar_snapshot(text, text, jsonb, jsonb, jsonb, text[]) to service_role;

notify pgrst, 'reload schema';
