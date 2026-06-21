-- ================================================================
-- MIGRACIÓN 045: Añadir hora a reservas
--
-- Cada reserva se asigna a una hora concreta dentro de la franja.
-- La disponibilidad se comprueba por franja + fecha + hora.
-- ================================================================

alter table reservas add column if not exists hora time;

-- Rellenar las reservas existentes con la hora de inicio de la franja
update reservas r set hora = f.hora_inicio
from reserva_franjas f
where r.franja_id = f.franja_id and r.hora is null and f.hora_inicio is not null;

notify pgrst, 'reload schema';
