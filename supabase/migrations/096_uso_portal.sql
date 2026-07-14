-- ================================================================
-- 096 · Medición de uso del portal por los clientes
--   · client_users.last_login_at: último acceso real de cada usuario.
--   · uso_portal: rollup diario de "hits" por (tenant, usuario, módulo, día).
--     Una fila por tenant×usuario×módulo×día acota el crecimiento (patrón ia_uso).
--   · uso_portal_hit: incremento atómico (sin leer-modificar-escribir).
-- La actividad del equipo CLAUX en sesiones de impersonación NO se registra
-- (se filtra en la app por el flag `imp` de la sesión), así que esta tabla
-- refleja solo el uso real del cliente.
-- ================================================================

-- 1) Último login real por usuario del portal.
alter table client_users add column if not exists last_login_at timestamptz;

-- 2) Rollup diario de uso por módulo.
create table if not exists uso_portal (
  client_id  text not null,
  user_id    text not null,
  modulo     text not null,
  dia        date not null,               -- zona America/Havana
  hits       int  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (client_id, user_id, modulo, dia)
);

-- Índices para las lecturas de métricas (por tenant y por rango de fechas).
create index if not exists uso_portal_client_dia_idx on uso_portal (client_id, dia);
create index if not exists uso_portal_dia_idx        on uso_portal (dia);

-- 3) Incremento atómico. El día se resuelve en zona America/Havana para que
--    "usuarios activos hoy" cuadre con la percepción local del cliente.
create or replace function uso_portal_hit(
  p_client_id text,
  p_user_id   text,
  p_modulo    text
) returns void language plpgsql as $$
declare
  v_dia date := (now() at time zone 'America/Havana')::date;
begin
  insert into uso_portal (client_id, user_id, modulo, dia, hits, updated_at)
  values (p_client_id, p_user_id, p_modulo, v_dia, 1, now())
  on conflict (client_id, user_id, modulo, dia) do update set
    hits       = uso_portal.hits + 1,
    updated_at = now();
end;
$$;
