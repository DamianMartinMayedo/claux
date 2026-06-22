-- ================================================================
-- MIGRACIÓN 057: Rate limiting de endpoints públicos (sin Redis)
--
-- Ventana fija por bucket (acción:ip). rl_hit incrementa atómicamente y devuelve
-- si la petición está permitida. Protege crearReservaPublica/crearCitaPublica,
-- cancelación y disponibilidad pública del abuso/spam.
-- ================================================================

create table if not exists rate_limits (
  bucket       text primary key,
  count        int  not null default 0,
  window_start timestamptz not null default now()
);

create or replace function rl_hit(p_key text, p_max int, p_window int) returns boolean as $$
declare
  v_count int;
begin
  insert into rate_limits (bucket, count, window_start)
  values (p_key, 1, now())
  on conflict (bucket) do update set
    count = case
      when rate_limits.window_start < now() - make_interval(secs => p_window) then 1
      else rate_limits.count + 1 end,
    window_start = case
      when rate_limits.window_start < now() - make_interval(secs => p_window) then now()
      else rate_limits.window_start end
  returning count into v_count;

  return v_count <= p_max;
end;
$$ language plpgsql;

grant execute on function rl_hit(text, int, int) to service_role;

notify pgrst, 'reload schema';
