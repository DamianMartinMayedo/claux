-- ================================================================
-- MIGRACIÓN 031: RRHH · páginas del sidebar — Fase 5
--
-- RRHH pasa de una sola página con pestañas a CINCO páginas planas,
-- coherente con la base contable e inventario (cada subárea = una
-- entrada del sidebar = una ruta). El sidebar se genera de
-- modulos_catalogo.paginas, así que basta actualizar el JSONB.
-- Las rutas planas evitan tocar la navegación de los demás módulos.
-- ================================================================

UPDATE modulos_catalogo SET paginas = '[
  {"ruta": "/portal/rrhh",          "label": "Personal",  "orden": 0},
  {"ruta": "/portal/contratos",     "label": "Contratos", "orden": 1},
  {"ruta": "/portal/turnos",        "label": "Turnos",    "orden": 2},
  {"ruta": "/portal/nomina",        "label": "Nómina",    "orden": 3},
  {"ruta": "/portal/rrhh-reportes", "label": "Reportes",  "orden": 4}
]'::jsonb WHERE clave = 'rrhh';

notify pgrst, 'reload schema';
