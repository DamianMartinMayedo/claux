-- ================================================================
-- MIGRACIÓN 237: la clasificación de un mensaje de soporte
--
-- Plan `docs/planes/ia-claux-plataforma.md` § Fase 5. Al llegar un mensaje del
-- portal, la IA interna lo etiqueta: de qué módulo habla, si es una duda, un
-- fallo o una petición, cuánto corre y una línea de resumen. Con eso la bandeja
-- se puede ordenar por urgencia y el borrador de respuesta deja de estar ciego
-- (hoy solo ve las FAQ generales, porque no sabe de qué módulo va el mensaje).
--
-- POR QUÉ COLUMNAS NUEVAS Y NO `modulo_clave`, que parece hecha para esto:
-- `modulo_clave` es la marca de OTRA cosa —el interés en contratar un módulo
-- desde el banner del dashboard (mig. 137)— y la lista de Ventas se arma con
-- «tiene modulo_clave». Escribir ahí el tema convertiría cada duda sobre la caja
-- en una solicitud de ampliación en el embudo comercial.
--
-- Todas nulables: los mensajes de antes de hoy no tienen clasificación y no
-- pasa nada — la pantalla lo dice y se puede clasificar a mano o con un botón.
-- ================================================================

alter table public.soporte_mensajes
  -- De qué va: clave de `modulos_catalogo` o 'general'. No lleva FK a propósito:
  -- si un módulo desaparece del catálogo, el mensaje viejo conserva su etiqueta.
  add column if not exists tema           text,
  add column if not exists tipo           text,
  add column if not exists prioridad      text,
  -- El mensaje en una línea, para leer la bandeja sin abrir cada fila.
  add column if not exists resumen        text,
  -- Quién puso la etiqueta. Se apaga en cuanto una persona la corrige: una
  -- clasificación revisada por alguien ya no es una sugerencia de la máquina.
  add column if not exists clasificado_ia boolean not null default false;

alter table public.soporte_mensajes drop constraint if exists soporte_mensajes_tipo_check;
alter table public.soporte_mensajes
  add constraint soporte_mensajes_tipo_check
  check (tipo is null or tipo in ('duda', 'fallo', 'peticion'));

alter table public.soporte_mensajes drop constraint if exists soporte_mensajes_prioridad_check;
alter table public.soporte_mensajes
  add constraint soporte_mensajes_prioridad_check
  check (prioridad is null or prioridad in ('alta', 'media', 'baja'));

-- Lo que se consulta: lo urgente que sigue abierto. Parcial porque las filas sin
-- clasificar no se buscan por aquí.
create index if not exists idx_soporte_msg_prioridad
  on public.soporte_mensajes (estado, prioridad)
  where prioridad is not null;

notify pgrst, 'reload schema';
