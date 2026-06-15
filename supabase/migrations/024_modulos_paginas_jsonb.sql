-- 018: Añadir columna paginas (JSONB) a modulos_catalogo
-- Almacena metadatos de las páginas internas de cada módulo: ruta, label, orden.
-- Las páginas reales (page.tsx) las crea el asistente de IA.
-- Esto permite renombrar y reordenar páginas desde el admin sin tocar código.

ALTER TABLE modulos_catalogo ADD COLUMN IF NOT EXISTS paginas JSONB DEFAULT '[]';

-- Seed: migrar las páginas hardcodeadas actuales a la columna paginas
UPDATE modulos_catalogo SET paginas = '[
  {"ruta": "/portal/ventas",     "label": "Ventas",                  "orden": 0},
  {"ruta": "/portal/gastos",     "label": "Gastos y cobros",         "orden": 1},
  {"ruta": "/portal/cxc",        "label": "Cuentas por cobrar",      "orden": 2},
  {"ruta": "/portal/cxp",        "label": "Cuentas por pagar",       "orden": 3},
  {"ruta": "/portal/tesoreria",  "label": "Tesorería",               "orden": 4},
  {"ruta": "/portal/reportes",   "label": "Reportes",                "orden": 5},
  {"ruta": "/portal/terceros",   "label": "Clientes y proveedores",  "orden": 6},
  {"ruta": "/portal/monedas",    "label": "Monedas y Tasas",         "orden": 7}
]'::jsonb WHERE clave = 'base';

UPDATE modulos_catalogo SET paginas = '[
  {"ruta": "/portal/productos",  "label": "Productos",   "orden": 0},
  {"ruta": "/portal/almacenes",  "label": "Almacenes",   "orden": 1},
  {"ruta": "/portal/compras",    "label": "Compras",     "orden": 2},
  {"ruta": "/portal/inventario", "label": "Movimientos", "orden": 3}
]'::jsonb WHERE clave = 'inventario';

UPDATE modulos_catalogo SET paginas = '[
  {"ruta": "/portal/rrhh", "label": "Personal y nómina", "orden": 0}
]'::jsonb WHERE clave = 'rrhh';

UPDATE modulos_catalogo SET paginas = '[
  {"ruta": "/portal/ia", "label": "Asistente IA", "orden": 0}
]'::jsonb WHERE clave = 'asistente_ia';

UPDATE modulos_catalogo SET paginas = '[
  {"ruta": "/portal/empresas", "label": "Mis Empresas", "orden": 0}
]'::jsonb WHERE clave = 'multiempresa';

UPDATE modulos_catalogo SET paginas = '[
  {"ruta": "/portal/catalogo", "label": "Catálogo QR", "orden": 0}
]'::jsonb WHERE clave = 'catalogo_qr';

UPDATE modulos_catalogo SET paginas = '[
  {"ruta": "/portal/reservas", "label": "Reservas y citas", "orden": 0}
]'::jsonb WHERE clave = 'reservas_citas';

UPDATE modulos_catalogo SET paginas = '[
  {"ruta": "/portal/imprenta", "label": "Docs imprenta", "orden": 0}
]'::jsonb WHERE clave = 'documentos_imprenta';
