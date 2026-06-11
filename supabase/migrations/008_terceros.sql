-- ── Módulo Terceros ───────────────────────────────────────────────────────────
-- Clientes, proveedores y contactos comerciales unificados por empresa

create table if not exists third_parties (
  tercero_id        text        primary key,                 -- TER-XXXXXXXX
  client_id         text        not null,
  empresa_id        text        not null,

  -- Clasificación
  tipo              text        not null default 'CLIENTE',  -- CLIENTE | PROVEEDOR | AMBOS
  nombre            text        not null,
  identificacion    text,                                    -- RIF / NIT / Cédula

  -- Contacto
  telefono          text,
  email             text,
  direccion         text,
  ciudad            text,
  pais              text,

  -- Condiciones comerciales
  condicion_pago    text        not null default 'CONTADO',  -- CONTADO | 15 | 30 | 60 | 90
  limite_credito    numeric(18,2),
  moneda_defecto    text,

  -- Info adicional
  datos_pago        text,                                    -- Texto libre (banco, cuenta…)
  notas             text,

  -- Soft delete y auditoría
  activo            boolean     not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Índices de consulta habituales
create index if not exists idx_third_parties_client    on third_parties (client_id);
create index if not exists idx_third_parties_empresa   on third_parties (empresa_id);
create index if not exists idx_third_parties_tipo      on third_parties (tipo);
create index if not exists idx_third_parties_activo    on third_parties (activo);
create index if not exists idx_third_parties_nombre    on third_parties (lower(nombre));
