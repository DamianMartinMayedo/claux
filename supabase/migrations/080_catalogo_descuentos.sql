-- Descuentos en el catálogo digital, en porcentaje, a dos niveles:
--   · por producto  (catalogo_items.descuento_pct)
--   · por categoría (catalogo_categorias.descuento_pct) — masivo para todo el grupo
-- El descuento efectivo de un ítem = el suyo si > 0, si no el de su categoría
-- (el del producto manda sobre el del grupo). 0 = sin descuento.

alter table catalogo_items      add column if not exists descuento_pct numeric(5,2) not null default 0;
alter table catalogo_categorias add column if not exists descuento_pct numeric(5,2) not null default 0;
