-- ================================================================
-- MIGRACIÓN 054: Bot de Telegram independiente para Citas (agenda)
--
-- Reservas y Citas son funcionalidades contratables por separado y casi siempre
-- excluyentes; cada una configura su PROPIO bot (token, secreto del webhook,
-- código de vínculo, chat del dueño, confirmación automática). Reservas sigue
-- en `clients.bot_config`; Citas usa la nueva `clients.bot_config_citas`.
-- El webhook resuelve el negocio por token contra cualquiera de las dos.
-- ================================================================

alter table clients add column if not exists bot_config_citas jsonb not null default '{}'::jsonb;

-- Índice funcional para el lookup del webhook por token (igual que bot_config)
create index if not exists idx_clients_bot_citas_token on clients ((bot_config_citas->>'token'));

notify pgrst, 'reload schema';
