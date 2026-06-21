-- ================================================================
-- MIGRACIÓN 046: Duración de turno + hora_fin en reservas
--
-- Cada turno define cuánto dura una reserva (ej: 90 min).
-- La disponibilidad ahora comprueba solapamiento real en vez
-- de comparar solo la hora exacta de inicio.
--
-- hora_fin en reservas se calcula al crear: hora + duracion_minutos.
-- Se guarda para que las queries de solapamiento sean eficientes.
-- ================================================================

alter table reserva_franjas add column if not exists duracion_minutos int not null default 60;

alter table reservas add column if not exists hora_fin time;

-- Backfill: calcular hora_fin para reservas existentes según duración de la franja
update reservas r set hora_fin = (r.hora + (f.duracion_minutos || ' minutes')::interval)::time
from reserva_franjas f
where r.franja_id = f.franja_id and r.hora_fin is null and r.hora is not null;

notify pgrst, 'reload schema';
