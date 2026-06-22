-- ================================================================
-- MIGRACIÓN 056: Sesiones del bot por funcionalidad
--
-- Reservas y Citas tienen bots independientes. Un mismo usuario (chat_id) podría,
-- en el caso raro de un negocio con ambos bots, tener un flujo en cada uno a la
-- vez. La clave de sesión pasa a (client_id, chat_id, modulo) para no clobbear.
-- Las filas existentes son de Reservas (default 'reservas').
-- ================================================================

alter table telegram_sessions add column if not exists modulo text not null default 'reservas';

do $$
declare pkname text;
begin
  select conname into pkname
  from pg_constraint
  where conrelid = 'telegram_sessions'::regclass and contype = 'p';
  if pkname is not null then
    execute format('alter table telegram_sessions drop constraint %I', pkname);
  end if;
end $$;

alter table telegram_sessions add constraint telegram_sessions_pkey primary key (client_id, chat_id, modulo);

notify pgrst, 'reload schema';
