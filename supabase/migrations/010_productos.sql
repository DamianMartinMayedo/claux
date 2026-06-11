-- ── Módulo Productos ─────────────────────────────────────────────────────────

-- Categorías del catálogo (global por cliente, no por empresa)
create table if not exists product_categories (
  categoria_id  text        primary key,          -- CAT-XXXXXXXX
  client_id     text        not null,
  nombre        text        not null,
  descripcion   text,
  estado        text        not null default 'ACTIVO',  -- ACTIVO | INACTIVO
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_product_categories_client on product_categories (client_id);
create index if not exists idx_product_categories_estado on product_categories (estado);

-- Catálogo de productos y servicios (global por cliente)
create table if not exists products (
  producto_id       text          primary key,    -- PRD-XXXXXXXX | SRV-XXXXXXXX
  client_id         text          not null,
  codigo            text          not null,       -- PRD-0001 | SRV-0001 (código visible)
  codigo_proveedor  text,                         -- código en catálogo del proveedor
  nombre            text          not null,
  descripcion       text,
  tipo              text          not null default 'PRODUCTO',   -- PRODUCTO | SERVICIO
  categoria_id      text,
  proveedor_id      text,                         -- FK → third_parties (opcional)
  unidad            text          not null default 'unidad',
  precios           jsonb         not null default '{}',   -- { "USD": 25.00, "VES": 150000 }
  costos            jsonb         not null default '{}',   -- { "USD": 15.00 }
  stock_actual      numeric(18,3) not null default 0,
  stock_minimo      numeric(18,3) not null default 0,
  estado            text          not null default 'ACTIVO',     -- ACTIVO | INACTIVO
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now()
);

create index if not exists idx_products_client    on products (client_id);
create index if not exists idx_products_tipo      on products (tipo);
create index if not exists idx_products_estado    on products (estado);
create index if not exists idx_products_categoria on products (categoria_id);
create unique index if not exists idx_products_codigo_unique on products (client_id, codigo);

-- Recargar caché de PostgREST
notify pgrst, 'reload schema';
