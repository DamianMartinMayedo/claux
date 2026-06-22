-- ================================================================
-- MIGRACIÓN 055: Token público por reserva/cita (gestión por el cliente)
--
-- Cada reserva/cita lleva un token opaco para que el cliente pueda gestionarla
-- (cancelar) desde /[slug]/r/<token> sin cuenta. No es adivinable (a diferencia
-- de reserva_id). Aplica a aforo y agenda (misma tabla `reservas`).
-- ================================================================

alter table reservas add column if not exists token text;

-- Backfill de filas existentes
update reservas set token = replace(gen_random_uuid()::text, '-', '') where token is null;

-- Nuevas filas obtienen token por defecto (los RPC no lo especifican en el insert)
alter table reservas alter column token set default replace(gen_random_uuid()::text, '-', '');

create unique index if not exists idx_reservas_token on reservas(token);

notify pgrst, 'reload schema';
