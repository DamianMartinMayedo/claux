-- ================================================================
-- MIGRACIÓN 126: Subcategorías de gastos (jerarquía de 2 niveles)
--
-- `categorias_gastos` gana `parent_id` autorreferenciado:
--   parent_id NULL  → categoría (nivel 1)
--   parent_id fijo  → subcategoría (nivel 2) de esa categoría
-- Solo 2 niveles: la app impide anidar una subcategoría bajo otra.
--
-- El nombre único deja de ser (client_id, nombre) GLOBAL: pasa a ser
-- único DENTRO de su nivel. Como Postgres trata NULL como distinto en
-- un UNIQUE, se usa coalesce(parent_id,'') para que dos categorías raíz
-- no puedan repetir nombre (mismo patrón `coalesce` que la idempotencia
-- de notificaciones internas).
--
-- Los datos existentes son todas raíces (parent_id NULL por defecto):
-- el nuevo índice equivale al viejo para ellas, así que no hay conflicto.
-- ================================================================

alter table categorias_gastos
  add column if not exists parent_id text
    references categorias_gastos(categoria_id) on delete cascade;

create index if not exists idx_categorias_gastos_parent on categorias_gastos(parent_id);

-- Sustituir el único global por uno por-nivel
alter table categorias_gastos drop constraint if exists categorias_gastos_client_id_nombre_key;

create unique index if not exists uq_categorias_gastos_client_parent_nombre
  on categorias_gastos (client_id, coalesce(parent_id, ''), nombre);

notify pgrst, 'reload schema';
