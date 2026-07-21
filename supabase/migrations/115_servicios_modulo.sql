-- ================================================================
-- MIGRACIÓN 115: «Servicios» pasa de funcionalidad a MÓDULO propio
--
-- Sustituye a las migraciones 113/114 (funcionalidad barata que compartía la
-- página /portal/productos con Inventario — el paso intermedio "servicio como
-- producto"). Esos ficheros se borran. La decisión final
-- (docs/planes/modulo-servicios.md) es SEPARAR POR COMPLETO: Inventario se queda
-- solo con productos físicos, y nace un módulo Servicios con página propia
-- (/portal/servicios), suscripciones y cobro recurrente, al mismo precio que
-- Inventario ($15/$25). Servicios e Inventario comparten la TABLA `products`
-- (filtro por `tipo`), nunca la página.
--
-- Es AUTOSUFICIENTE e IDEMPOTENTE: converge la BD que ya tiene la fila vieja de
-- la 113 (vía upsert) y también un clon fresco. Precio y claves SOLO en datos.
-- ================================================================

-- ── 1. Catálogo: servicios → módulo, precio 15/25, página propia ──
INSERT INTO modulos_catalogo
  (clave, nombre, descripcion, precio_fundador_usd, precio_estandar_usd, es_base, tipo, orden, activo, paginas)
VALUES (
  'servicios',
  'Servicios',
  'Catálogo de servicios con precio por moneda, más suscripciones y cobro recurrente a tus clientes. Para negocios que venden servicios y no mercancía física.',
  15, 25, false, 'modulo', 13, true,
  -- Solo la página PROPIA. Las compartidas (/portal/terceros) las inyecta el
  -- sidebar por prioridad. /portal/suscripciones se añade en la Fase B.
  '[{"ruta": "/portal/servicios", "label": "Servicios", "orden": 0}]'::jsonb
)
ON CONFLICT (clave) DO UPDATE SET
  nombre              = EXCLUDED.nombre,
  descripcion         = EXCLUDED.descripcion,
  precio_fundador_usd = EXCLUDED.precio_fundador_usd,
  precio_estandar_usd = EXCLUDED.precio_estandar_usd,
  tipo                = EXCLUDED.tipo,
  paginas             = EXCLUDED.paginas;

-- ── 2. Diagnóstico: re-siembra idempotente (la 114 se borra) ──
-- La necesidad 'servicios' y los sectores que la sugieren siguen valiendo; se
-- re-siembran para que un clon fresco los tenga. Texto actualizado: el módulo
-- ahora promete el cobro recurrente, no solo "la lista en las facturas".
INSERT INTO diagnostico_necesidades (clave, etiqueta, descripcion, icono, modulos, orden, activa)
VALUES (
  'servicios',
  'Vender servicios y cobrarlos cada período',
  'Tus servicios con su precio, listos para facturarlos; y si son recurrentes, gestiona las suscripciones de tus clientes y cóbralas cada mes.',
  'inventario',
  '["servicios"]'::jsonb,
  2,
  true
)
ON CONFLICT (clave) DO UPDATE SET
  etiqueta    = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  modulos     = EXCLUDED.modulos;

-- Sectores que venden servicios: sugerirla de entrada (idempotente). Ya no hay
-- absorción en el código, así que un salón puede acabar con servicios + inventario
-- recomendados a la vez — correcto: son dos módulos distintos.
UPDATE plantillas_sector
SET modulos = array_append(modulos, 'servicios')
WHERE sector IN ('peluqueria', 'barberia', 'estetica', 'clinica', 'gimnasio', 'alquiler', 'servicios')
  AND NOT (modulos @> ARRAY['servicios']);

NOTIFY pgrst, 'reload schema';
