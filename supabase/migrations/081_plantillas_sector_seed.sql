-- Siembra de plantillas_sector: sectores ofrecidos en el alta de cliente.
-- Cada sector resuelve las ETIQUETAS visibles (catálogo/reservas/recurso) y un
-- icono de catálogo para las cards sin foto: 'comida' → cubiertos, 'producto' → caja.
-- El pipeline ya existe (clients.sector → plantillas_sector.etiquetas → etiquetasDe);
-- esto solo lo alimenta. Idempotente: re-ejecutar actualiza.
insert into plantillas_sector (sector, nombre, modulos, etiquetas, orden, activa) values
  ('restaurante', 'Restaurante / Cafetería',
   array['base','catalogo_qr','reservas_citas'],
   '{"catalogo":"Menú","catalogoIcono":"comida","reservas":"Reservas","recurso":"Mesa","recurso_pl":"Mesas","servicio":"Servicio"}'::jsonb,
   10, true),
  ('tienda', 'Tienda',
   array['base','catalogo_qr','inventario'],
   '{"catalogo":"Catálogo","catalogoIcono":"producto","reservas":"Reservas","recurso":"Personal","recurso_pl":"Personal","servicio":"Servicio"}'::jsonb,
   20, true),
  ('servicios', 'Servicios',
   array['base','catalogo_qr','agenda'],
   '{"catalogo":"Servicios","catalogoIcono":"producto","reservas":"Citas","recurso":"Profesional","recurso_pl":"Profesionales","servicio":"Servicio"}'::jsonb,
   30, true)
on conflict (sector) do update set
  nombre    = excluded.nombre,
  modulos   = excluded.modulos,
  etiquetas = excluded.etiquetas,
  orden     = excluded.orden,
  activa    = excluded.activa;
