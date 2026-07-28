-- ================================================================
-- MIGRACIÓN 145: RLS de las tablas nuevas de nómina
--
-- PROBLEMA. Las cinco tablas creadas por las migraciones 140-144 nacieron con RLS
-- activado y CERO políticas. RLS sin política niega todo salvo `service_role`. En
-- local no se nota —el bypass de desarrollo usa service_role, que ignora RLS— y el
-- portal tampoco, porque también va por service_role. Lo que se rompe es el ADMIN
-- EN PRODUCCIÓN, que usa el cliente autenticado con RLS aplicado: las tablas
-- simplemente no cargan, sin más síntoma que una pantalla vacía.
--
-- Es exactamente la causa raíz que documentó y arregló la mig. 085 para las tablas
-- de entonces. Las nuevas no la heredan: cada `create table` vuelve a abrir el
-- agujero, porque el remedio de la 085 fue un bucle de una sola pasada, no una
-- regla permanente.
--
-- ALCANCE DELIBERADAMENTE ESTRECHO. Al escribir esto había 26 tablas en esa
-- situación, no 5. Las otras 21 son de dossiers, caja, suscripciones, importador,
-- notificaciones, asesores y uso_portal, y decidir si el admin debe verlas no es
-- parte de la nómina: conceder acceso es una decisión de control de acceso y se
-- toma mirando cada módulo, no en un bucle. Aquí se nombran las cinco tablas una a
-- una, a propósito.
--
-- POR QUÉ `authenticated` Y NO ALGO MÁS FINO. Solo los super-admins tienen sesión
-- de Supabase Auth; los clientes del portal usan un JWT propio y llegan por
-- service_role. La anon key sigue sin poder leer nada. El aislamiento entre
-- inquilinos lo hace la aplicación filtrando por `client_id` en toda query, no RLS
-- (docs/CONTEXTO.md). Una política «por tenant» aquí daría sensación de seguridad
-- sin añadir ninguna, porque quien la evaluaría es justo el rol que la ignora.
-- ================================================================

do $$
declare
  t text;
  tablas text[] := array[
    'nomina_linea_conceptos',
    'deducciones_reglas',
    'empresa_config_nomina',
    'incidencias_nomina',
    'parametros_fiscales_cuba'
  ];
begin
  foreach t in array tablas loop
    execute format('drop policy if exists "admin_full_access" on public.%I', t);
    execute format(
      'create policy "admin_full_access" on public.%I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

-- Verificación: las cinco tienen que quedar con política.
do $$
declare sin_politica text;
begin
  select string_agg(c.relname, ', ') into sin_politica
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policy p on p.polrelid = c.oid
  where n.nspname = 'public'
    and c.relname in ('nomina_linea_conceptos','deducciones_reglas',
                      'empresa_config_nomina','incidencias_nomina',
                      'parametros_fiscales_cuba')
  group by c.relname
  having count(p.polname) = 0;

  if sin_politica is not null then
    raise exception 'Tablas de nómina con RLS y sin política: %', sin_politica;
  end if;
end $$;
