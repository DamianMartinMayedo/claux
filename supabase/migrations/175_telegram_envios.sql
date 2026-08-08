-- ================================================================
-- MIGRACIÓN 175: registro de entrega de Telegram (fase 7 · TG-2).
--
-- `enviarMensaje` tragaba el error y devolvía `false` a un `console.error`, y
-- ningún llamador miraba el resultado: si el dueño bloqueaba el bot, revocaba el
-- token o cambiaba de cuenta, los avisos se perdían para siempre y EN SILENCIO.
-- El correo tiene `emails_log`; Telegram no tenía nada. De esta tabla sale además
-- el aviso `telegram_no_entregado` de la fase 9.
--
-- Se purga a 90 días en el barrido diario (`lib/reservas/barrido.ts`): es un log
-- de diagnóstico, no un histórico.
-- ================================================================

create table if not exists telegram_envios (
  id          bigserial primary key,
  client_id   text not null references clients(client_id),
  columna     text not null,            -- bot_config | bot_config_citas
  chat_id     text not null,
  tipo        text not null,            -- reserva_nueva | estado | vinculo | prueba | recordatorio | bot
  ok          boolean not null,
  error       text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_telegram_envios_cliente on telegram_envios (client_id, created_at desc);
-- Para el aviso: «¿ha fallado algo?» sin barrer la tabla entera.
create index if not exists idx_telegram_envios_fallos  on telegram_envios (client_id, created_at desc) where ok = false;

-- Tabla nueva ⇒ RLS con política (memoria `rls-admin-prod`).
alter table telegram_envios enable row level security;
drop policy if exists admin_full_access on telegram_envios;
create policy admin_full_access on telegram_envios for all to authenticated using (true) with check (true);

-- Y entra en `eliminar_cliente()` (memoria `listas-a-mano-derivan`). El cuerpo
-- completo se reaplica en la migración de continuación; aquí queda la nota para
-- que nadie añada una tabla de tenant sin pasar por ahí.

notify pgrst, 'reload schema';
