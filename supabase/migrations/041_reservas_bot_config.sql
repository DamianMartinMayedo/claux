-- ================================================================
-- MIGRACIÓN 041: Reservas y citas · Configuración del bot (Fase 0 · Tanda 1)
--
-- Añade bot_config (JSONB) a clients para que cada dueño
-- configure su bot de Telegram desde el portal.
-- ================================================================

alter table clients
  add column if not exists bot_config jsonb default '{}'::jsonb;

notify pgrst, 'reload schema';
