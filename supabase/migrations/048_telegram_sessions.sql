-- ================================================================
-- MIGRACIÓN 048: Sesiones de conversación del bot de Telegram
--
-- Guarda el estado de la conversación por usuario para flujos
-- multi-paso (reserva conversacional).
-- ================================================================

create table if not exists telegram_sessions (
  session_id text          primary key,                -- chat_id (único por usuario)
  client_id  text          not null,
  chat_id    text          not null,
  paso       text,                                      -- null = sin flujo activo
  datos      jsonb         default '{}'::jsonb,         -- datos acumulados (fecha, franja_id, hora, etc)
  created_at timestamptz   not null default now(),
  updated_at timestamptz   not null default now()
);

create index if not exists idx_ts_client on telegram_sessions (client_id);

alter table public.telegram_sessions enable row level security;
grant select, insert, update, delete on public.telegram_sessions to service_role;

notify pgrst, 'reload schema';
