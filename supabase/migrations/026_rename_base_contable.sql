-- Renombrar el módulo base de "Base contable" a "Contabilidad"
UPDATE modulos_catalogo SET nombre = 'Contabilidad' WHERE clave = 'base';
