-- ================================================================
-- MIGRACIÓN 017: Catálogo de módulos + módulos por cliente
--                (modelo comercial à la carte)
--
-- Contexto:
--   Sustituye el modelo de "planes cerrados con nombre" por
--   "base contable + módulos à la carte". Ver docs/MODELO-MODULOS.md.
--
--   1. modulos_catalogo → lista de lo que CLAUX vende, con precio.
--      Tres tipos: 'base' (obligatoria), 'modulo' (capacidad general),
--      'funcionalidad' (propia de un sector). Los precios viven aquí,
--      en datos — nunca en el código.
--   2. clients gana modulos_activos / tarifa / precio_mensual_usd:
--      qué tiene encendido cada negocio y su mensualidad compuesta.
--
--   plan_id se CONSERVA en clients (el histórico de payments lo
--   referencia); simplemente deja de ser la fuente del gating.
--
--   NOTA: aplicar primero en una branch de Supabase y validar antes
--   de tocar la base compartida. El backfill de modulos_activos a
--   partir de plans.modulos se hace aparte (script de una vez).
-- ================================================================

-- ── 1. Catálogo de módulos vendibles ─────────────────────────────
create table if not exists modulos_catalogo (
  clave                text          primary key,               -- p.ej. 'catalogo_qr'
  nombre               text          not null,
  descripcion          text,
  precio_fundador_usd  numeric(10,2) not null default 0,
  precio_estandar_usd  numeric(10,2) not null default 0,
  es_base              boolean       not null default false,    -- la base obligatoria (siempre activa)
  tipo                 text          not null default 'modulo', -- 'base' | 'modulo' | 'funcionalidad'
  orden                int           not null default 0,
  activo               boolean       not null default true,
  created_at           timestamptz   not null default now(),
  updated_at           timestamptz   not null default now()
);

create index if not exists idx_modulos_catalogo_tipo   on modulos_catalogo (tipo);
create index if not exists idx_modulos_catalogo_activo on modulos_catalogo (activo);

-- ── 2. Módulos activos y precio compuesto por cliente ────────────
alter table clients
  add column if not exists modulos_activos    text[]        not null default '{}',
  add column if not exists tarifa             text          not null default 'estandar',  -- 'fundador' | 'estandar'
  add column if not exists precio_mensual_usd numeric(10,2) not null default 0;

-- ── 3. Seed del catálogo (precios de CONTEXTO §5 — ajustar si cambian) ──
insert into modulos_catalogo (clave, nombre, descripcion, precio_fundador_usd, precio_estandar_usd, es_base, tipo, orden) values
  ('base',                'Base contable',                  'Ventas, gastos/cobros, cuentas por cobrar/pagar, tesorería, reportes, terceros, multimoneda', 20, 35, true,  'base',          10),
  ('inventario',          'Inventario',                     'Almacenes, productos, compras, movimientos, disponibilidad',                                  8,  14, false, 'modulo',        20),
  ('rrhh',                'RRHH',                           'Personal, contratos, bajas, turnos, nómina simple',                                           8,  14, false, 'modulo',        30),
  ('multiempresa',        'Multiempresa',                   'Varias empresas/locales con consolidación',                                                   12, 20, false, 'modulo',        40),
  ('asistente_ia',        'Asistente IA',                   'Chat con clientes, NL para reservas/pedidos, consultas del dueño, resumen semanal',           15, 25, false, 'modulo',        50),
  ('catalogo_qr',         'Catálogo digital QR + mini-web', 'Carta/catálogo por QR, mini-web pública, multi-idioma opcional',                               10, 18, false, 'funcionalidad', 60),
  ('reservas_citas',      'Reservas y citas + bot',         'Formulario, panel, bot de botones, notificaciones',                                           10, 18, false, 'funcionalidad', 70),
  ('documentos_imprenta', 'Documentos de imprenta',         'El cliente envía sus documentos por correo antes de recogerlos',                               0,  0,  false, 'funcionalidad', 80)
on conflict (clave) do nothing;

-- ── 4. RLS y grants (patrón de 011_grants_rls.sql; la app accede vía service_role) ──
alter table public.modulos_catalogo enable row level security;
grant select, insert, update, delete on public.modulos_catalogo to service_role;

-- ── 5. Recarga caché de PostgREST ────────────────────────────────
notify pgrst, 'reload schema';
