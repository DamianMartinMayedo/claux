-- ================================================================
-- MIGRACIÓN 091: Tipos de usuario del equipo interno (panel /admin)
--
-- Hasta ahora el admin era binario: cualquier email en ADMIN_EMAILS
-- entraba como super admin (sin tabla ni roles). Añadimos un rol
-- 'vendedor' con permisos por sección (Solicitudes, Presupuestos,
-- Clientes solo lectura, y CRM futuro).
--
-- El acceso real de la app pasa por service_role (createAdminClient)
-- + guards en código. La whitelist ADMIN_EMAILS se conserva como
-- BOOTSTRAP: sus emails son super_admin aunque no tengan fila aquí
-- (evita bloqueos y no exige seed inicial).
-- ================================================================

create table if not exists admin_users (
  email        text        primary key,               -- normalizado a minúsculas en código
  nombre       text        not null,
  rol          text        not null default 'vendedor' check (rol in ('super_admin','vendedor')),
  permisos     text[]      not null default '{}',      -- claves de sección visibles para el vendedor
  activo       boolean     not null default true,
  auth_user_id uuid,                                    -- id en auth.users (para reset/borrado de la cuenta)
  created_at   timestamptz not null default now()
);

create index if not exists idx_admin_users_activo on admin_users (activo);

-- RLS: patrón de 085 (acceso total a authenticated; la app usa service_role).
alter table public.admin_users enable row level security;
grant select, insert, update, delete on public.admin_users to service_role;
drop policy if exists "admin_full_access" on public.admin_users;
create policy "admin_full_access" on public.admin_users
  for all to authenticated using (true) with check (true);

notify pgrst, 'reload schema';
