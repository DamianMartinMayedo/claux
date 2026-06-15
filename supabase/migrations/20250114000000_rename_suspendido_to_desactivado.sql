-- Renombrar estado SUSPENDIDO a DESACTIVADO
UPDATE clients SET estado = 'DESACTIVADO' WHERE estado = 'SUSPENDIDO';
