-- 019: añadir tipo 'addon' al catálogo. Reclasificar multiempresa como addon.
-- Los addons no generan items en el sidebar; desbloquean capacidad extra en páginas existentes.

-- Actualizar el check constraint para aceptar 'addon'
ALTER TABLE modulos_catalogo DROP CONSTRAINT IF EXISTS modulos_catalogo_tipo_check;
ALTER TABLE modulos_catalogo ADD CONSTRAINT modulos_catalogo_tipo_check CHECK (tipo IN ('base', 'modulo', 'funcionalidad', 'addon'));

-- Reclasificar multiempresa como addon
UPDATE modulos_catalogo SET tipo = 'addon', paginas = '[]'::jsonb WHERE clave = 'multiempresa';
