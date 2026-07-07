-- 085_rls_admin_tablas.sql
-- Causa raíz: en producción el admin usa el cliente Supabase AUTENTICADO (RLS
-- aplicado), tanto para leer como para escribir. Muchas tablas tienen RLS activado
-- pero SIN ninguna política → RLS niega todo salvo service_role. En local no se
-- nota porque el bypass de desarrollo usa service_role (ignora RLS). Por eso el
-- admin no cargaba módulos, necesidades de diagnóstico, etc. La 084 arregló solo
-- la LECTURA de modulos_catalogo.
--
-- Fix general y consistente con el modelo ya existente ("Admin full access" en
-- clients/sales/settings/…): acceso total al rol `authenticated`. Solo los
-- super-admins tienen sesión de Supabase Auth (los clientes del portal usan un JWT
-- propio), así que la anon key sigue sin poder leer nada. El portal y las páginas
-- públicas usan service_role y no se ven afectados.

-- 1) Todas las tablas con RLS activado y SIN políticas → acceso total a authenticated.
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_policy p on p.polrelid = c.oid
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
    group by c.relname
    having count(p.polname) = 0
  loop
    execute format(
      'create policy "admin_full_access" on public.%I for all to authenticated using (true) with check (true)',
      r.relname
    );
  end loop;
end $$;

-- 2) modulos_catalogo ya tenía SELECT público (084), pero el admin también lo EDITA
--    (crear/editar/eliminar módulos); añadimos acceso total a authenticated para que
--    las escrituras funcionen en prod (la lectura pública se mantiene).
drop policy if exists "admin_full_access" on public.modulos_catalogo;
create policy "admin_full_access" on public.modulos_catalogo
  for all to authenticated using (true) with check (true);
