-- 169 · Turnos: distinguir «libra» de «sin asignar»
--
-- En la rejilla semanal, la celda vacía significaba las DOS cosas a la vez: que esa
-- persona descansa ese día y que a nadie se le ha asignado nada todavía. Con una sola
-- forma de decirlo, ni el total de horas de la semana ni la sugerencia de días
-- trabajados de la nómina pueden saber si un hueco es descanso planificado o un olvido.
--
-- Un turno de descanso no suma horas y no cuenta como día trabajado; uno sin horas
-- puestas sí cuenta (es «Mañana» con el horario a medio rellenar, que es otra cosa).
-- Por eso hace falta un dato explícito y no se puede deducir de `hora_inicio is null`.
--
-- Aditiva y con defecto seguro: NINGUNA fila existente cambia de comportamiento.
--
-- No lleva índice para `turno_asignaciones`: `uq_tas_emp_dia (empleado_id, dia_semana)`
-- ya existe en producción y es lo que protege el reemplazo de celda.

alter table turnos
  add column if not exists es_descanso boolean not null default false;

comment on column turnos.es_descanso is
  'Turno de DESCANSO: no suma horas ni cuenta como día trabajado. Distingue «libra» de «sin asignar», que en la rejilla eran la misma celda vacía.';
