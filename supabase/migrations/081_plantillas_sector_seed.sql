-- Añade `catalogoIcono` (comida|producto) a las etiquetas de sector de la 051, para
-- que la card de catálogo sin foto muestre cubiertos (comida) o caja (producto), en
-- portal y público. NO redefine sectores (la 051 es la fuente): solo hace merge del
-- icono sobre las etiquetas existentes. Idempotente.
--
-- (Restaura además restaurante/tienda/servicios a sus valores oficiales de la 051,
--  por si una versión previa de este archivo los había sobrescrito.)

update plantillas_sector set nombre = 'Restaurante', modulos = array['catalogo_qr','reservas_citas'],
  etiquetas = '{"reservas":"Reservas","recurso":"Mesa","recurso_pl":"Mesas","servicio":"Servicio","catalogo":"Menú"}'::jsonb, orden = 1
  where sector = 'restaurante';
update plantillas_sector set nombre = 'Tienda', modulos = array['catalogo_qr','inventario'],
  etiquetas = '{"reservas":"Reservas","recurso":"Recurso","recurso_pl":"Recursos","servicio":"Servicio","catalogo":"Catálogo"}'::jsonb, orden = 10
  where sector = 'tienda';
update plantillas_sector set nombre = 'Servicios (genérico)', modulos = array['agenda','catalogo_qr'],
  etiquetas = '{"reservas":"Citas","recurso":"Profesional","recurso_pl":"Profesionales","servicio":"Servicio","catalogo":"Servicios"}'::jsonb, orden = 11
  where sector = 'servicios';

-- Icono del catálogo por sector (merge sin pisar el resto de etiquetas):
update plantillas_sector set etiquetas = etiquetas || '{"catalogoIcono":"comida"}'::jsonb
  where sector in ('restaurante','cafeteria','bar');
update plantillas_sector set etiquetas = etiquetas || '{"catalogoIcono":"producto"}'::jsonb
  where sector not in ('restaurante','cafeteria','bar');
