-- ── Módulo Terceros ───────────────────────────────────────────────────────────
-- Clientes, proveedores y contactos comerciales unificados por empresa
--
-- ⚠️ ESTE `create table` NUNCA SE APLICÓ. La tabla ya existía (creada a mano
-- antes de que hubiera migraciones — ver deuda técnica (2) en docs/CONTEXTO.md
-- §2), así que el `if not exists` la dejó intacta. Lo de abajo se ha corregido
-- para que refleje el esquema REAL de producción; antes declaraba
-- `tercero_id text primary key`, y esa mentira costó un bug: copiar un tercero a
-- otra empresa reventaba con «duplicate key ... third_parties_pkey» porque el
-- código regeneraba `tercero_id` creyendo que era la clave, y arrastraba la `id`
-- original. Si tocas esta tabla, comprueba el esquema real contra la BD.

create table if not exists third_parties (
  -- La PRIMARY KEY real. `tercero_id` es solo el código legible de negocio.
  id                uuid        primary key default gen_random_uuid(),
  tercero_id        text        not null,                    -- TER-XXXXXXXX
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
