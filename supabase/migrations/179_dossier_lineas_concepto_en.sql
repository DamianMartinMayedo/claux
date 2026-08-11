-- 179 · Traducción al inglés de los conceptos del desglose («El detalle»)
--
-- La slide «El detalle» del deck lista los conceptos del desglose ("Comida",
-- "Alquiler"…). Son texto que teclea el dueño, así que no valen las etiquetas fijas
-- del armazón (esas ya viven en deck-i18n): necesitan su propia traducción, que
-- genera la IA junto con el relato y se guarda aquí.
--
--   · dossier_lineas.concepto_en → el concepto traducido; NULL → el deck cae al ES.
--
-- Nota: la RPC `dossier_guardar_snapshot` reescribe (delete+insert) las líneas al
-- editar el desglose, así que un cambio de conceptos DEJA `concepto_en` en NULL —
-- que es lo correcto: la traducción vieja quedaría obsoleta, y regenerar el inglés
-- la vuelve a rellenar (editar el dossier ya marca «inglés desactualizado»).
--
-- Sin nuevas tablas → no toca la purga del tenant (columna de tabla ya purgada).

alter table public.dossier_lineas
  add column if not exists concepto_en text;
