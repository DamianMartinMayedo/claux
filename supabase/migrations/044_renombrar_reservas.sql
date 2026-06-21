-- ================================================================
-- MIGRACIÓN 044: Renombrar "Reservas y citas" → "Reservas"
-- ================================================================

update modulos_catalogo set nombre = 'Reservas', descripcion = 'Formulario, turnos, bot de botones, notificaciones'
  where clave = 'reservas_citas';

update modulos_catalogo set paginas = '[
  {"ruta": "/portal/reservas", "label": "Reservas", "orden": 0}
]'::jsonb where clave = 'reservas_citas';

notify pgrst, 'reload schema';
