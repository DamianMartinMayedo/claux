-- ================================================================
-- MIGRACIÓN 058: Tabla diagnosticos — leads del formulario público
-- ================================================================

create table if not exists diagnosticos (
  id            bigserial primary key,
  nombre        text not null,
  telefono      text not null,
  email         text not null,
  sector        text not null,
  necesidades   text[] not null default '{}',
  modo_actual   text not null,
  modulos_rec   text[] not null default '{}',
  created_at    timestamptz not null default now()
);

comment on table diagnosticos is 'Leads del formulario público de diagnóstico (landing)';
