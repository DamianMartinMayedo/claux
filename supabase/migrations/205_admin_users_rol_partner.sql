-- ================================================================
-- MIGRACIÓN 205: `admin_users.rol` acepta 'partner'
--
-- La Fase 2 de CLAUX Academia (portal de partners) no monta un sistema de
-- cuentas nuevo: reutiliza el que ya existe para el equipo (mig. 091). Un
-- partner es una cuenta más de `admin_users`, creada por el equipo desde
-- /admin/usuarios, con su cuenta de Supabase Auth como cualquier vendedor.
--
-- La diferencia es de ROL, y es una frontera, no un matiz:
--
--   · super_admin / vendedor  → gente de CLAUX. Entran al panel.
--   · partner                 → revendedor EXTERNO. NO entra al panel: ninguna
--     sección del admin le está permitida (`puedeAcceder()` devuelve false para
--     todas), y su única superficie es el manual leído en la capa `partner`
--     —`usar` + `vender`—, impuesta por su rol y no elegible con el selector.
--
-- Por qué el check y no dejarlo en texto libre: `permisos` es un array de claves
-- de sección, y sin la restricción un rol mal escrito ('Partner', 'socio') caería
-- en la rama «no es super_admin» del código y se comportaría como un VENDEDOR,
-- es decir, como equipo interno. El rol de un externo no puede depender de que
-- nadie se equivoque al teclear.
--
-- `permisos` se queda vacío para un partner (lo fuerza `normalizarPermisos`): su
-- acceso no se describe por secciones del panel, sino por la capa del manual.
-- ================================================================

alter table public.admin_users drop constraint if exists admin_users_rol_check;

alter table public.admin_users
  add constraint admin_users_rol_check
  check (rol in ('super_admin', 'vendedor', 'partner'));

comment on column public.admin_users.rol is
  'super_admin | vendedor | partner. Los dos primeros son equipo de CLAUX y entran al panel; '
  '«partner» es un revendedor externo: no accede a ninguna sección de /admin y lee el manual '
  'en la capa partner, impuesta por su rol.';

notify pgrst, 'reload schema';
