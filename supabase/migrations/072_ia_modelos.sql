-- ================================================================
-- MIGRACIÓN 072: Catálogo de modelos de IA + límites globales
--
-- El admin controla qué modelos (agentes) usan los clientes. Se siembra solo con
-- los modelos GRATIS de OpenCode Zen; los de pago se añaden después (con su
-- api_base/key) y se elige cuál es el principal. Auto-fallback a un modelo gratis
-- cuando un cliente supera su cupo del mes (abaratar). Cupo global en settings +
-- override por cliente en clients.ia_config.cupo.
--
-- IMPORTANTE: los ids de OpenCode Zen van SIN prefijo `opencode/`.
-- ================================================================

create table if not exists ia_modelos (
  id          text primary key,           -- id del modelo en el proveedor
  nombre      text not null,              -- etiqueta visible en el admin
  gratis      boolean not null default true,
  activo      boolean not null default true,
  api_base    text,                       -- null = usa settings.ia_api_base / default
  api_key_env text,                       -- nombre de la env var con la key; null = OPENCODE_ZEN_API_KEY
  orden       int not null default 100,
  created_at  timestamptz not null default now()
);

-- Seed: SOLO modelos gratis de Zen (los de pago los añade el admin luego).
insert into ia_modelos (id, nombre, gratis, activo, orden) values
  ('deepseek-v4-flash-free', 'DeepSeek V4 Flash (free)', true, true, 10),
  ('minimax-m3-free',        'MiniMax M3 (free)',        true, true, 20),
  ('mimo-v2.5-free',         'MiMo V2.5 (free)',         true, true, 30),
  ('qwen3.6-plus-free',      'Qwen 3.6 Plus (free)',     true, true, 40),
  ('nemotron-3-ultra-free',  'Nemotron 3 Ultra (free)',  true, true, 50),
  ('north-mini-code-free',   'North Mini Code (free)',   true, true, 60),
  ('big-pickle',             'Big Pickle (free)',        true, true, 70)
on conflict (id) do nothing;

-- Ajustes globales (clave-valor en settings). El modelo principal sigue siendo
-- settings.ia_model (ya existente).
insert into settings (key, value) values
  ('ia_model',                  'deepseek-v4-flash-free'),
  ('ia_modelo_fallback_gratis', 'deepseek-v4-flash-free'),
  ('ia_cupo_conversaciones',    '500')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
