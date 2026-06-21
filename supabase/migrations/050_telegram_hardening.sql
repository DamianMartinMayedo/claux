-- ================================================================
-- MIGRACIÓN 050: Telegram — lookup indexado, dedupe de updates,
--                sesiones por (cliente, chat)
--
-- Corrige tres fallos del webhook (route.ts) y de 048:
--   #1 Escala: el webhook cargaba TODOS los clientes y filtraba el token en JS
--      (O(n) por cada update). Índice funcional sobre bot_config->>'token' para
--      resolver el negocio en una sola query indexada.
--   #2 Duplicados: Telegram reintrega el update ante cualquier no-200/timeout.
--      Sin deduplicado se creaban reservas duplicadas. telegram_updates guarda
--      los update_id ya procesados (insert-on-conflict-do-nothing).
--   #3 Colisión de sesiones: 048 usaba session_id (=chat_id) como PK simple, de
--      modo que un mismo usuario hablando con dos negocios CLAUX se pisaba la
--      sesión. La clave pasa a ser (client_id, chat_id).
-- ================================================================

-- #1 Lookup O(1) por token de bot
create index if not exists idx_clients_bot_token on clients ((bot_config->>'token'));

-- #2 Dedupe de updates de Telegram
create table if not exists telegram_updates (
  client_id   text        not null,
  update_id   bigint      not null,
  recibido_at timestamptz not null default now(),
  primary key (client_id, update_id)
);
alter table public.telegram_updates enable row level security;
grant select, insert, delete on public.telegram_updates to service_role;

-- #3 Sesiones del bot con clave compuesta (cliente, chat)
drop table if exists telegram_sessions;
create table telegram_sessions (
  client_id  text        not null,
  chat_id    text        not null,
  paso       text,
  datos      jsonb       default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_id, chat_id)
);
create index idx_ts_updated on telegram_sessions (updated_at);
alter table public.telegram_sessions enable row level security;
grant select, insert, update, delete on public.telegram_sessions to service_role;

notify pgrst, 'reload schema';
