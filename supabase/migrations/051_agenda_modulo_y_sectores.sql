-- ================================================================
-- MIGRACIÓN 051: Módulo "Citas" (agenda) + plantillas de sector
--
-- Packaging: reservas de mesa (aforo) y citas por profesional son DOS
-- funcionalidades contratables por separado (decisión de producto):
--   · reservas_citas → "Reservas" (aforo: mesas/personas por franja)
--   · agenda         → "Citas"    (agenda: 1 cita por recurso/profesional y slot)
-- Cada negocio contrata la que aplica; gating independiente.
--
-- Onboarding adaptado por sector: clients.sector + plantillas_sector definen
-- qué módulos se sugieren y las etiquetas visibles ("Reservas"/"Citas"/"Clases",
-- "Mesa"/"Profesional"/"Cancha", "Menú"/"Servicios"…). El código usa la clave;
-- la etiqueta la resuelve el sector (CONTEXTO §1, MODELO-MODULOS §6).
-- ================================================================

-- ── Nuevo módulo: Citas (agenda) ─────────────────────────────────────────────
insert into modulos_catalogo (clave, nombre, descripcion, precio_fundador_usd, precio_estandar_usd, es_base, tipo, orden, paginas, activo)
values (
  'agenda', 'Citas',
  'Agenda por profesional/recurso: servicios con duración, reserva pública, bot y notificaciones',
  10, 18, false, 'funcionalidad', 8,
  '[{"ruta":"/portal/citas","label":"Citas","orden":0}]'::jsonb, true
)
on conflict (clave) do update set
  nombre = excluded.nombre, descripcion = excluded.descripcion,
  precio_fundador_usd = excluded.precio_fundador_usd, precio_estandar_usd = excluded.precio_estandar_usd,
  tipo = excluded.tipo, orden = excluded.orden, paginas = excluded.paginas, activo = excluded.activo;

-- Reordenar documentos_imprenta detrás de Citas
update modulos_catalogo set orden = 9 where clave = 'documentos_imprenta';

-- Aclarar que reservas_citas es el modo aforo (mesas)
update modulos_catalogo
  set descripcion = 'Reservas por aforo (mesas/personas y franjas): formulario público, panel, bot y notificaciones'
  where clave = 'reservas_citas';

-- ── Sector del negocio ───────────────────────────────────────────────────────
alter table clients add column if not exists sector text;

-- ── Plantillas de sector (onboarding + etiquetas) ────────────────────────────
create table if not exists plantillas_sector (
  sector     text primary key,
  nombre     text   not null,
  modulos    text[] not null default '{}',   -- claves sugeridas al dar de alta
  etiquetas  jsonb  not null default '{}'::jsonb,
  orden      int    not null default 0,
  activa     boolean not null default true
);
alter table public.plantillas_sector enable row level security;
grant select, insert, update, delete on public.plantillas_sector to service_role;

insert into plantillas_sector (sector, nombre, modulos, etiquetas, orden) values
  ('restaurante', 'Restaurante',        array['catalogo_qr','reservas_citas'], '{"reservas":"Reservas","recurso":"Mesa","recurso_pl":"Mesas","servicio":"Servicio","catalogo":"Menú"}'::jsonb, 1),
  ('cafeteria',   'Cafetería',          array['catalogo_qr','reservas_citas'], '{"reservas":"Reservas","recurso":"Mesa","recurso_pl":"Mesas","servicio":"Servicio","catalogo":"Carta"}'::jsonb, 2),
  ('bar',         'Bar',                array['catalogo_qr','reservas_citas'], '{"reservas":"Reservas","recurso":"Mesa","recurso_pl":"Mesas","servicio":"Servicio","catalogo":"Carta"}'::jsonb, 3),
  ('peluqueria',  'Peluquería',         array['agenda','catalogo_qr'],         '{"reservas":"Citas","recurso":"Profesional","recurso_pl":"Profesionales","servicio":"Servicio","catalogo":"Servicios"}'::jsonb, 4),
  ('barberia',    'Barbería',           array['agenda','catalogo_qr'],         '{"reservas":"Citas","recurso":"Barbero","recurso_pl":"Barberos","servicio":"Servicio","catalogo":"Servicios"}'::jsonb, 5),
  ('estetica',    'Estética / Spa',     array['agenda','catalogo_qr'],         '{"reservas":"Citas","recurso":"Cabina","recurso_pl":"Cabinas","servicio":"Tratamiento","catalogo":"Tratamientos"}'::jsonb, 6),
  ('clinica',     'Clínica / Consulta', array['agenda'],                       '{"reservas":"Citas","recurso":"Profesional","recurso_pl":"Profesionales","servicio":"Servicio","catalogo":"Servicios"}'::jsonb, 7),
  ('gimnasio',    'Gimnasio',           array['reservas_citas'],               '{"reservas":"Clases","recurso":"Clase","recurso_pl":"Clases","servicio":"Clase","catalogo":"Actividades"}'::jsonb, 8),
  ('alquiler',    'Alquiler (canchas/salas)', array['agenda'],                 '{"reservas":"Reservas","recurso":"Cancha","recurso_pl":"Canchas","servicio":"Servicio","catalogo":"Servicios"}'::jsonb, 9),
  ('tienda',      'Tienda',             array['catalogo_qr','inventario'],     '{"reservas":"Reservas","recurso":"Recurso","recurso_pl":"Recursos","servicio":"Servicio","catalogo":"Catálogo"}'::jsonb, 10),
  ('servicios',   'Servicios (genérico)', array['agenda','catalogo_qr'],       '{"reservas":"Citas","recurso":"Profesional","recurso_pl":"Profesionales","servicio":"Servicio","catalogo":"Servicios"}'::jsonb, 11)
on conflict (sector) do nothing;

notify pgrst, 'reload schema';
