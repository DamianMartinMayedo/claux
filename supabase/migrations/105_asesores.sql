-- ── Directorio de asesores ────────────────────────────────────────────────────
--
-- Contactos de asesor/gestor a los que el dueño le envía los reportes financieros
-- por correo (módulo Reportes → "Enviar al asesor"). Es un directorio por cliente,
-- empresa-aware: `empresa_id` NULL = el asesor vale para todas las empresas; con
-- valor = solo esa empresa. Al enviar reportes de la empresa X, el selector ofrece
-- los asesores con empresa_id NULL o = X.
--
-- Trampa PK-id (CONTEXTO §2): la PRIMARY KEY real es `id` uuid; `asesor_id` es solo
-- el código legible de negocio. Nunca arrastrar `id` al copiar/duplicar filas.

create table if not exists asesores (
  id           uuid        primary key default gen_random_uuid(),
  asesor_id    text        not null,                    -- ASE-XXXXXXXX
  client_id    text        not null,
  nombre       text        not null,
  email        text        not null,
  empresa_id   text,                                    -- NULL = todas las empresas
  activo       boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Un mismo correo puede repetirse para empresas distintas (o para "todas"), pero no
-- exactamente duplicado en el mismo ámbito. coalesce evita que dos filas "todas"
-- (empresa_id NULL) se cuelen como distintas por la semántica NULL de Postgres.
create unique index if not exists asesores_client_email_empresa_key
  on asesores (client_id, lower(email), coalesce(empresa_id, ''));

create index if not exists idx_asesores_client  on asesores (client_id);
create index if not exists idx_asesores_empresa on asesores (empresa_id);

-- RLS y grants (patrón del repo: RLS on, sin políticas; acceso vía service_role)
alter table public.asesores enable row level security;
grant select, insert, update, delete on public.asesores to service_role;
