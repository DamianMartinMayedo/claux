-- ─────────────────────────────────────────────────────────────────────────────
-- 235 · La bolsa de IA interna de CLAUX
--
-- POR QUÉ UNA TABLA Y NO UNA FILA EN `ia_uso`. La opción barata era medir el
-- consumo del equipo con un `client_id` reservado (`__claux__`) y no migrar nada.
-- Ensucia todo lo que da por hecho que un `client_id` ES UN INQUILINO: los joins
-- con `clients`, la purga `eliminar_cliente()`, el centinela de tablas sin purgar
-- y cualquier recuento de «clientes con IA». Un inquilino falso se cuela en cada
-- consulta que nadie volverá a leer con esa idea en la cabeza.
--
-- La llave es (periodo, ORIGEN), no (periodo, usuario): la pregunta que nos vamos
-- a hacer al mirar la factura no es quién gastó, es EN QUÉ se fue —el importador,
-- la propuesta, soporte o el relleno de textos—. Eso decide dónde se invierte y
-- qué se recorta.
--
-- La regla de coste (decidida y no se re-discute): el coste sigue a QUIÉN CONDUCE
-- la sesión. Si la conduce el cliente, la paga su addon `asistente_ia` y se mide
-- en `ia_uso`. Si la conduce nuestro equipo —nuestro /admin, nuestro importador en
-- una migración pagada—, la paga CLAUX y se mide aquí.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists ia_uso_interno (
  periodo        text not null,            -- 'YYYY-MM' (zona America/Havana)
  origen         text not null,            -- importador · propuesta · soporte · relleno
  conversaciones int  not null default 0,
  tokens_in      bigint not null default 0,
  tokens_out     bigint not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (periodo, origen),
  constraint ia_uso_interno_origen_ck
    check (origen in ('importador', 'propuesta', 'soporte', 'relleno'))
);

comment on table ia_uso_interno is
  'Consumo de IA que paga CLAUX (no un cliente). Sin client_id A PROPÓSITO: no es un inquilino. Ver mig. 235.';

-- Incremento atómico, gemelo de `ia_uso_hit`. El período se calcula EN LA BASE y
-- en la zona del negocio, igual que allí: si lo pusiera quien llama, dos rutas
-- distintas podrían cortar el mes en días distintos.
create or replace function ia_uso_interno_hit(
  p_origen     text,
  p_tokens_in  bigint,
  p_tokens_out bigint,
  p_nueva_conv boolean
) returns void language plpgsql as $$
declare
  v_periodo text := to_char(now() at time zone 'America/Havana', 'YYYY-MM');
begin
  insert into ia_uso_interno (periodo, origen, conversaciones, tokens_in, tokens_out, updated_at)
  values (
    v_periodo, p_origen,
    case when p_nueva_conv then 1 else 0 end,
    greatest(coalesce(p_tokens_in, 0), 0),
    greatest(coalesce(p_tokens_out, 0), 0),
    now()
  )
  on conflict (periodo, origen) do update set
    conversaciones = ia_uso_interno.conversaciones + case when p_nueva_conv then 1 else 0 end,
    tokens_in      = ia_uso_interno.tokens_in  + greatest(coalesce(p_tokens_in, 0), 0),
    tokens_out     = ia_uso_interno.tokens_out + greatest(coalesce(p_tokens_out, 0), 0),
    updated_at     = now();
end;
$$;

grant execute on function ia_uso_interno_hit(text, bigint, bigint, boolean) to service_role;

-- RLS CON POLÍTICA, las dos cosas. Una tabla con RLS activada y SIN política no
-- devuelve nada… solo en producción: en local el cliente de servicio se la salta,
-- así que el síntoma es «funciona en local y en el admin sale vacío». Misma
-- política que `ia_uso`: esto no es de un inquilino, es de CLAUX, y quien entra al
-- panel ya pasó por su guarda de sesión.
alter table ia_uso_interno enable row level security;

drop policy if exists admin_full_access on ia_uso_interno;
create policy admin_full_access on ia_uso_interno
  for all to authenticated using (true) with check (true);

-- Los dos ajustes de la bolsa. El CUPO nace en 300 conversaciones/mes (decisión
-- del dueño), y se sube viendo el reparto por origen del primer mes. El MODELO
-- nace VACÍO = hereda el principal: aquí sí cabe el caro —lo pagamos nosotros y
-- lo usa el equipo, no miles de inquilinos—, pero elegirlo es una decisión
-- comercial que se toma en /admin, no una que siembre una migración.
insert into settings (key, value) values
  ('ia_cupo_interno_mes', '300'),
  ('ia_model_interno',    '')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
