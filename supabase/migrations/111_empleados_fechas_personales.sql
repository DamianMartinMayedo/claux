-- Notificaciones internas, Fase 3 (parte de RRHH): dos fechas que el esquema no
-- tenía y sin las cuales no se podía avisar de nada.
--
-- · fecha_nacimiento      → felicitar el cumpleaños (detalle que en un negocio
--                           pequeño lo es todo, y que hoy se olvida).
-- · documento_vencimiento → caducidad del carné/documento de `empleados.documento`,
--                           que ya existía pero sin fecha: se sabía el número y
--                           no cuándo deja de valer.
--
-- Ambas opcionales: nadie tiene que rellenarlas para que RRHH siga funcionando,
-- y el escáner simplemente no avisa de lo que está vacío.

ALTER TABLE empleados
  ADD COLUMN IF NOT EXISTS fecha_nacimiento      DATE,
  ADD COLUMN IF NOT EXISTS documento_vencimiento DATE;

-- El escáner de cumpleaños filtra por (mes, día) sobre todos los empleados de
-- los tenants con RRHH; el índice evita el seq scan diario cuando haya volumen.
CREATE INDEX IF NOT EXISTS idx_empleados_cumple
  ON empleados (client_id, fecha_nacimiento)
  WHERE fecha_nacimiento IS NOT NULL;
