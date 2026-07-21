-- ================================================================
-- MIGRACIÓN 122: las categorías saben si son de productos, de servicios o de ambos
--
-- Problema (visto probando): `product_categories` es una lista ÚNICA y la página de
-- Servicios ofrecía todas — «Alimentos», «Bebidas», «Limpieza»— al crear un servicio.
-- El resultado ya estaba en los datos reales: una categoría «Servicios» y otra
-- «Servicio», duplicada porque la lista no distinguía y nadie encontraba la suya.
--
-- `tipo`: PRODUCTO | SERVICIO | AMBAS. No son dos listas estancas a propósito: un bar
-- quiere «Barra» para el refresco y para el servicio de camarero, y obligarle a
-- crearla dos veces sería cambiar un incordio por otro.
--
-- RELLENO DEDUCIDO DEL USO REAL, no un default a ciegas:
--   · solo la usan físicos          → PRODUCTO
--   · solo la usan servicios        → SERVICIO
--   · la usan los dos, o está vacía → AMBAS  (no se adivina; se deja abierta)
-- Así el cliente que ya tenía sus categorías ordenadas ve el filtro correcto sin tocar
-- nada, y el que las mezclaba no pierde ninguna.
-- ================================================================

ALTER TABLE product_categories
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'AMBAS';

UPDATE product_categories c
   SET tipo = CASE
         WHEN u.fisicos > 0 AND u.servicios = 0 THEN 'PRODUCTO'
         WHEN u.servicios > 0 AND u.fisicos = 0 THEN 'SERVICIO'
         ELSE 'AMBAS'
       END,
       updated_at = now()
  FROM (
    SELECT c2.categoria_id,
           count(*) FILTER (WHERE p.tipo = 'PRODUCTO') AS fisicos,
           count(*) FILTER (WHERE p.tipo = 'SERVICIO') AS servicios
      FROM product_categories c2
      LEFT JOIN products p ON p.categoria_id = c2.categoria_id
     GROUP BY c2.categoria_id
  ) u
 WHERE u.categoria_id = c.categoria_id;

ALTER TABLE product_categories DROP CONSTRAINT IF EXISTS product_categories_tipo_chk;
ALTER TABLE product_categories ADD CONSTRAINT product_categories_tipo_chk
  CHECK (tipo IN ('PRODUCTO', 'SERVICIO', 'AMBAS'));

NOTIFY pgrst, 'reload schema';
