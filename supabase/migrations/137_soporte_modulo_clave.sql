-- 137: el interés en contratar un módulo deja de ser solo texto en el asunto.
--
-- `registrarInteresModulo` (banner de captación del dashboard) inserta en
-- `soporte_mensajes` con asunto «Interés en <nombre>». Adivinar el módulo desde
-- ese texto no vale: el nombre depende del sector («Menú» vs «Catálogo») y del
-- catálogo comercial, que puede cambiar. Con la clave guardada, el dashboard
-- puede pintar «Pedido el 26 jul» al recargar y el admin marcar la fila como
-- contratación, no como incidencia.
--
-- Nula para los mensajes normales de soporte: solo la llevan los de captación.

alter table public.soporte_mensajes
  add column if not exists modulo_clave text;

-- Lo que se consulta: los módulos ya pedidos por ESTE cliente, para no volver a
-- ofrecerlos como si nada. Parcial porque la inmensa mayoría de filas son
-- mensajes de soporte sin clave.
create index if not exists idx_soporte_mensajes_modulo
  on public.soporte_mensajes (client_id, modulo_clave)
  where modulo_clave is not null;
