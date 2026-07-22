-- ================================================================
-- MIGRACIÓN 127: Únicos compuestos de los códigos de negocio
--
-- Prerrequisito del importador de datos (migración masiva por CSV).
-- `third_parties` y `products` tienen PK surrogate `id` uuid; sus códigos
-- de negocio (`tercero_id`, `producto_id`, `codigo`) NO tenían índice único,
-- así que una importación podía colar códigos repetidos y reventar los
-- `.single()`/`.maybeSingle()` que los consultan (CONTEXTO §2, «Trampa al
-- duplicar/copiar filas», punto B). Verificado en prod: cero duplicados y
-- cero nulos, así que los únicos se crean sin conflicto.
-- ================================================================

create unique index if not exists uq_third_parties_client_tercero
  on third_parties (client_id, tercero_id);

create unique index if not exists uq_products_client_producto
  on products (client_id, producto_id);

create unique index if not exists uq_products_client_codigo
  on products (client_id, codigo);

notify pgrst, 'reload schema';
