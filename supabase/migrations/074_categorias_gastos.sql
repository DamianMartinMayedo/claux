-- Sistema de categorías de gastos.
--
-- Modelo: `categorias_gastos` (catálogo por cliente) + columna FK `categoria_id`
-- en las tablas transaccionales, MÁS el nombre desnormalizado `categoria` que ya
-- existía (lo mantenemos para reportes/listados y lo propagamos al renombrar).
--
-- Categorías del sistema por cliente: "Comisiones bancarias" (fees de
-- transferencia) y "Salarios" (nóminas). Renombrables, no archivables.

-- 1. Catálogo de categorías
create table if not exists categorias_gastos (
  categoria_id text primary key,
  client_id    text not null references clients(client_id) on delete cascade,
  nombre       text not null,
  descripcion  text,
  estado       text not null default 'ACTIVO' check (estado in ('ACTIVO','INACTIVO')),
  es_sistema   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (client_id, nombre)
);
create index if not exists idx_categorias_gastos_client on categorias_gastos(client_id);
create index if not exists idx_categorias_gastos_estado on categorias_gastos(estado);

-- 2. Columna categoria_id (FK) en las tablas transaccionales
alter table gastos_cobros         add column if not exists categoria_id text references categorias_gastos(categoria_id) on delete set null;
alter table movimientos_tesoreria add column if not exists categoria_id text references categorias_gastos(categoria_id) on delete set null;
create index if not exists idx_gastos_cobros_categoria on gastos_cobros(categoria_id);
create index if not exists idx_mov_tesoreria_categoria on movimientos_tesoreria(categoria_id);

-- 3. Categorías del sistema por cliente
insert into categorias_gastos (categoria_id, client_id, nombre, es_sistema)
select 'CATGAS-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)), c.client_id, s.nombre, true
from clients c
cross join (values ('Comisiones bancarias'), ('Salarios')) as s(nombre)
on conflict (client_id, nombre) do update set es_sistema = true;

-- 4. Migrar los textos de categoría existentes → filas de categorias_gastos
insert into categorias_gastos (categoria_id, client_id, nombre, es_sistema)
select 'CATGAS-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)), t.client_id, t.categoria, false
from (
  select distinct client_id, categoria from gastos_cobros         where categoria is not null and categoria <> ''
  union
  select distinct client_id, categoria from movimientos_tesoreria where categoria is not null and categoria <> ''
) t
on conflict (client_id, nombre) do nothing;

-- 5. Backfill de categoria_id por (client_id, categoria = nombre)
update gastos_cobros g
set categoria_id = cg.categoria_id
from categorias_gastos cg
where g.categoria_id is null and g.categoria is not null
  and cg.client_id = g.client_id and cg.nombre = g.categoria;

update movimientos_tesoreria m
set categoria_id = cg.categoria_id
from categorias_gastos cg
where m.categoria_id is null and m.categoria is not null
  and cg.client_id = m.client_id and cg.nombre = m.categoria;
