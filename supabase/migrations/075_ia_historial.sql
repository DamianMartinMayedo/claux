-- Historial de conversaciones del asistente IA
-- Permite al usuario ver conversaciones previas y retomarlas

-- Tabla de conversaciones
create table if not exists ia_conversaciones (
  conversacion_id text primary key,
  client_id       text not null references clients(client_id) on delete cascade,
  user_id         text not null,
  titulo          text not null default 'Nueva conversación',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_ia_conversaciones_client on ia_conversaciones(client_id);
create index if not exists idx_ia_conversaciones_user on ia_conversaciones(user_id);
create index if not exists idx_ia_conversaciones_updated on ia_conversaciones(updated_at desc);

-- Tabla de mensajes
create table if not exists ia_mensajes (
  mensaje_id       text primary key,
  conversacion_id  text not null references ia_conversaciones(conversacion_id) on delete cascade,
  rol              text not null check (rol in ('user', 'assistant')),
  contenido        text not null,
  created_at       timestamptz not null default now()
);

create index if not exists idx_ia_mensajes_conversacion on ia_mensajes(conversacion_id);
create index if not exists idx_ia_mensajes_created on ia_mensajes(created_at);

-- Función para generar IDs
create or replace function generar_ia_conversacion_id()
returns text as $$
begin
  return 'CONV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
end;
$$ language plpgsql;

create or replace function generar_ia_mensaje_id()
returns text as $$
begin
  return 'MSG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
end;
$$ language plpgsql;
