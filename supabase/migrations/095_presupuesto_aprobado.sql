-- Añade el estado 'aprobado' al ciclo de vida de un presupuesto de instalación.
-- Flujo: guardado → aprobado (el cliente acepta la oferta; habilita crear cliente)
--         → instalado (se registran las horas reales al cerrar la instalación).
alter table presupuestos_instalacion
  drop constraint if exists presupuestos_instalacion_estado_check;

alter table presupuestos_instalacion
  add constraint presupuestos_instalacion_estado_check
  check (estado in ('guardado', 'aprobado', 'instalado'));
