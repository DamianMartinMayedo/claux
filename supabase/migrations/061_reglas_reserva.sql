-- ================================================================
-- MIGRACIÓN 061: Reglas de reserva del negocio
--
-- Config a nivel de negocio (aplica a Reservas y Citas):
--   · antelacion_min_horas: horas mínimas de antelación (0 = sin mínimo)
--   · ventana_max_dias:     cuántos días vista se puede reservar (0 = sin límite)
--   · max_personas:         tope de personas por reserva de aforo (0 = sin límite;
--                           no aplica a citas, que son de 1)
-- ================================================================

alter table clients add column if not exists reserva_antelacion_min_horas int not null default 0;
alter table clients add column if not exists reserva_ventana_max_dias     int not null default 0;
alter table clients add column if not exists reserva_max_personas         int not null default 0;

notify pgrst, 'reload schema';
