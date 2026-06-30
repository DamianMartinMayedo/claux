-- ================================================================
-- MIGRACIÓN 071: Asistente IA como ADDON transversal
--
-- Reposiciona `asistente_ia` de módulo (con su grupo en el sidebar) a ADDON:
-- no genera navegación propia; aparece como puntos de entrada (icono+tooltip)
-- repartidos por la plataforma y un chat flotante del dueño. El gating se hace
-- por touchpoint con tieneModulo('asistente_ia'). Ver MODELO-MODULOS §3.1/§7.
--
-- Añade:
--   · clients.ia_config (jsonb): nombre del agente, tono… (espejo de bot_config).
--   · ia_uso: medición por tenant/mes (CONTEXTO §7) + RPC atómica ia_uso_hit.
-- ================================================================

-- 1) Reclasificar el addon (deja de generar grupo/páginas en el sidebar)
update modulos_catalogo
set tipo = 'addon', paginas = '[]'::jsonb
where clave = 'asistente_ia';

-- 2) Config del agente por cliente (nombre, tono, canales). Solo se edita y se
--    muestra con el addon contratado.
alter table clients add column if not exists ia_config jsonb not null default '{}'::jsonb;

-- 3) Medición de consumo por tenant y mes (periodo = 'YYYY-MM').
create table if not exists ia_uso (
  client_id      text not null,
  periodo        text not null,            -- 'YYYY-MM' (zona America/Havana)
  conversaciones int  not null default 0,
  tokens_in      bigint not null default 0,
  tokens_out     bigint not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (client_id, periodo)
);

create index if not exists ia_uso_periodo_idx on ia_uso (periodo);

-- Incremento atómico (sin leer-modificar-escribir). p_nueva_conv suma 1 a
-- conversaciones solo cuando arranca una conversación nueva.
create or replace function ia_uso_hit(
  p_client_id  text,
  p_tokens_in  bigint,
  p_tokens_out bigint,
  p_nueva_conv boolean
) returns void language plpgsql as $$
declare
  v_periodo text := to_char(now() at time zone 'America/Havana', 'YYYY-MM');
begin
  insert into ia_uso (client_id, periodo, conversaciones, tokens_in, tokens_out, updated_at)
  values (
    p_client_id, v_periodo,
    case when p_nueva_conv then 1 else 0 end,
    greatest(coalesce(p_tokens_in, 0), 0),
    greatest(coalesce(p_tokens_out, 0), 0),
    now()
  )
  on conflict (client_id, periodo) do update set
    conversaciones = ia_uso.conversaciones + case when p_nueva_conv then 1 else 0 end,
    tokens_in      = ia_uso.tokens_in  + greatest(coalesce(p_tokens_in, 0), 0),
    tokens_out     = ia_uso.tokens_out + greatest(coalesce(p_tokens_out, 0), 0),
    updated_at     = now();
end;
$$;

grant execute on function ia_uso_hit(text, bigint, bigint, boolean) to service_role;

notify pgrst, 'reload schema';
