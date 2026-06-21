-- ================================================================
-- MIGRACIÓN 042: Limpiar página suelta de configuración de reservas
--
-- La ruta /portal/reservas/configuracion se eliminó (todo unificado
-- en /portal/reservas con tabs). Esta migración quita la página
-- huérfana del catálogo si quedó registrada.
-- ================================================================

update modulos_catalogo set paginas = '[
  {"ruta": "/portal/reservas", "label": "Reservas y citas", "orden": 0}
]'::jsonb where clave = 'reservas_citas';

notify pgrst, 'reload schema';
