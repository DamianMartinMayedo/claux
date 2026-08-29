-- ================================================================
-- MIGRACIÓN 223: se retira el rol 'partner' de `admin_users`
--
-- Deshace la 205. Aquel rol se creó para el revendedor externo y en la práctica
-- no hacía nada que el vendedor no hiciera: leer el manual. Mantener dos roles
-- para una sola frontera obligaba a escribirla dos veces —en el panel, en la
-- capa del manual, en el rótulo, en los permisos— y cada sitio podía olvidarse.
--
-- A partir de aquí hay UN rol que vende, del equipo o de fuera:
--
--   · super_admin → lo ve todo, y elige con qué capa lee el manual.
--   · vendedor    → entra al panel por las secciones que tenga en `permisos` y
--     lee el manual en la capa `vendedor` (`usar` + `vender`), que le impone el
--     rol y no puede cambiar.
--
-- Lo que antes era «ser partner» ahora es un vendedor con `permisos` VACÍO: no
-- entra al panel (el layout de /admin lo devuelve al manual), entra por
-- `/partners` y solo lee. Es un dato y no un rol, que es lo que en realidad era.
--
-- El check se queda: sin él, un rol mal escrito ('Partner', 'socio') caería en
-- la rama «no es super_admin» del código y se comportaría como vendedor. Con la
-- lista corta a dos, eso ya no puede colarse.
-- ================================================================

-- Ninguna fila en producción usaba 'partner', pero la conversión va igual: una
-- copia de la base con datos no puede quedarse con un rol que el check prohíbe.
-- Se le vacían los permisos a propósito: es lo que lo deja en «solo manual».
update public.admin_users
   set rol = 'vendedor', permisos = '{}'
 where rol = 'partner';

alter table public.admin_users drop constraint if exists admin_users_rol_check;

alter table public.admin_users
  add constraint admin_users_rol_check
  check (rol in ('super_admin', 'vendedor'));

comment on column public.admin_users.rol is
  'super_admin | vendedor. El super_admin lo ve todo; el vendedor entra al panel por las '
  'secciones de `permisos` y lee el manual en la capa vendedor, impuesta por su rol. Un '
  'vendedor con `permisos` vacío es quien revende desde fuera: no entra al panel, solo lee.';

notify pgrst, 'reload schema';
