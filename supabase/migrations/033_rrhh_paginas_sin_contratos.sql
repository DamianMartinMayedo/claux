-- ================================================================
-- MIGRACIÓN 033: RRHH · quitar "Contratos" del sidebar — Fase 5
--
-- Los contratos pasan a vivir dentro de cada empleado (su página de
-- detalle /portal/rrhh/[empleado]), no como página propia. El sidebar
-- de RRHH queda con 4 páginas planas.
-- ================================================================

UPDATE modulos_catalogo SET paginas = '[
  {"ruta": "/portal/rrhh",          "label": "Personal", "orden": 0},
  {"ruta": "/portal/turnos",        "label": "Turnos",   "orden": 1},
  {"ruta": "/portal/nomina",        "label": "Nómina",   "orden": 2},
  {"ruta": "/portal/rrhh-reportes", "label": "Reportes", "orden": 3}
]'::jsonb WHERE clave = 'rrhh';

notify pgrst, 'reload schema';
