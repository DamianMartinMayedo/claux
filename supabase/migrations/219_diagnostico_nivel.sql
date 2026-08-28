-- ================================================================
-- MIGRACIÓN 219: el diagnóstico también recomienda NIVEL
--
-- Plan: docs/planes/niveles-comerciales.md §11.2 (decisión D12).
--
-- POR QUÉ. El diagnóstico público recomendaba módulos y nada más. Con el modelo
-- de tres niveles, «qué módulos necesitas» ya no basta para preparar una oferta:
-- falta cuánto le cabe. El formulario gana un paso de tamaño (tres preguntas,
-- con las bandas derivadas EN VIVO de `nivel_limites`) y aquí se guarda a qué
-- nivel apuntaban esas respuestas.
--
-- No se guarda ningún precio, ni aquí ni en la pantalla: la cuota depende de los
-- módulos que active y eso se habla con el cliente (D12).
--
-- AMBAS COLUMNAS SON NULLABLE y así se quedan: los leads anteriores a esta
-- migración no respondieron el paso de tamaño y no hay forma honesta de
-- rellenarles el hueco. Un default 'inicial' sería inventarles una respuesta.
-- ================================================================

alter table public.diagnosticos
  add column if not exists nivel_rec text,
  add column if not exists tamano    jsonb;

-- Sin CHECK contra `niveles(clave)` ni FK: `diagnosticos` es una tabla de leads
-- públicos y una FK la ataría al catálogo comercial. Si un nivel se retirara del
-- catálogo, los leads viejos que lo mencionan tienen que sobrevivir tal cual —
-- son historia de lo que se le dijo a esa persona, no configuración vigente.
comment on column public.diagnosticos.nivel_rec is
  'Clave del nivel recomendado (inicial|empresa|pro) según los volúmenes declarados. '
  'NULL en los leads anteriores al paso de tamaño.';
comment on column public.diagnosticos.tamano is
  'Respuestas del paso de tamaño: { clave_pregunta: índice del nivel que exige }. '
  'Se guarda para poder revisar de dónde salió la recomendación.';
