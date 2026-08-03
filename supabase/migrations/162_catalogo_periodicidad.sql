-- ================================================================
-- MIGRACIÓN 162: el precio del catálogo público dice si es «/mes»
--
-- PROBLEMA. Un servicio suscribible se anuncia en el catálogo público a «2.000 CUP»,
-- exactamente igual que uno que se paga una vez. Ante el cliente final eso no es un
-- matiz de formato: cambia el sentido del precio. El dato existe en el catálogo
-- interno (`products.periodicidad_defecto`) y se perdía al importar al público.
--
-- `catalogo_items` es una copia deliberada del catálogo (el público no consulta
-- `products` en cada visita: es la frontera dura de rendimiento, ver CONTEXTO §3), así
-- que la periodicidad viaja con la copia.
--
-- Nullable y sin relleno: un ítem sin periodicidad se anuncia como hoy, sin sufijo.
-- Ningún catálogo existente cambia al aplicar esto.
-- ================================================================

alter table catalogo_items
  add column if not exists periodicidad text;

comment on column catalogo_items.periodicidad is
  'MENSUAL|TRIMESTRAL|SEMESTRAL|ANUAL. Copiada del catálogo al importar un servicio suscribible; NULL = pago único (se anuncia sin sufijo).';
