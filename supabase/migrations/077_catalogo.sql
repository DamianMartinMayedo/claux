-- Funcionalidad "Catálogo digital QR" (clave `catalogo_qr`).
--
-- Modelo de datos PROPIO e independiente del módulo Inventario (regla de módulos
-- independientes, CONTEXTO §2): el catálogo funciona al 100% sin `products`. Si el
-- cliente tiene Inventario activo, `catalogo_items.producto_id` guarda una
-- referencia BLANDA (sin FK) al producto de origen, como mera conveniencia de
-- "importar/vincular" — nunca una dependencia.
--
-- Scope multi-tenant por `client_id` (sin RLS por tenant; el acceso es vía
-- service_role en servidor, como el resto de la app). La página pública lee por
-- `clients.slug`.

-- ── 1. Categorías del catálogo (por cliente) ──
create table if not exists catalogo_categorias (
  categoria_id text primary key,
  client_id    text not null references clients(client_id) on delete cascade,
  nombre       text not null,
  orden        int  not null default 0,
  activa       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_catalogo_categorias_client on catalogo_categorias(client_id, orden);

-- ── 2. Ítems del catálogo (platos / productos / servicios de carta) ──
-- Campos públicos del vertical (CONTEXTO §6): foto, ingredientes, alérgenos,
-- calorías, disponibilidad (agotado) y traducciones (JSONB, sin UI aún).
create table if not exists catalogo_items (
  item_id      text primary key,
  client_id    text not null references clients(client_id) on delete cascade,
  categoria_id text references catalogo_categorias(categoria_id) on delete set null,
  nombre       text not null,
  descripcion  text,
  precio       numeric(14,2),
  moneda       text,
  foto_url     text,             -- URL pública (bucket `catalogo`) de la imagen optimizada (WebP)
  foto_path    text,             -- ruta en el bucket, para poder borrarla/reemplazarla
  foto_thumb_url text,           -- miniatura (WebP) para la rejilla
  ingredientes text,
  alergenos    text,
  calorias     int,
  disponible   boolean not null default true,   -- false = "agotado"
  orden        int  not null default 0,
  activo       boolean not null default true,
  producto_id  text,             -- referencia BLANDA al products de Inventario (sin FK); NULL si no vinculado
  traducciones jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_catalogo_items_client    on catalogo_items(client_id);
create index if not exists idx_catalogo_items_categoria on catalogo_items(client_id, categoria_id, orden);

-- ── 3. Bucket de Storage público para las fotos del catálogo ──
-- Público de lectura (mismo criterio que `logos`): las fotos del menú son
-- públicas. La escritura va siempre por service_role desde una server action
-- (que bypassa RLS). Ruta: catalogo/<client_id>/<item_id>.webp (+ _thumb).
insert into storage.buckets (id, name, public)
values ('catalogo', 'catalogo', true)
on conflict (id) do nothing;
