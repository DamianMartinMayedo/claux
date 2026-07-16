-- ================================================================
-- MIGRACIÓN 102: Dossier — correo de contacto en la portada de cierre
--
-- No existe ningún "correo del negocio" en el esquema (clients/empresas no lo
-- tienen; los emails que hay son de terceros, empleados, soporte…). El deck lo
-- necesita para que el inversor pueda responder tras el "Muchas gracias", así que
-- es un dato PROPIO del dossier, opcional y editable (como nombre_portada). Vacío
-- → no se muestra nada.
-- ================================================================

alter table dossiers add column if not exists contacto_email text;
