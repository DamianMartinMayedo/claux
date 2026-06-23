-- ================================================================
-- MIGRACIÓN 065: Catálogo visible en el diagnóstico público
--
-- El formulario de diagnóstico (landing) deriva sus "necesidades" del
-- catálogo real (modulos_catalogo) para no quedar nunca desincronizado.
-- Esta columna deja que el equipo cure qué módulos aparecen como opción
-- sin tocar código: por defecto todos, salvo los nicho/operativos.
-- ================================================================

alter table modulos_catalogo
  add column if not exists mostrar_en_diagnostico boolean not null default true;

-- Fuera del diagnóstico por defecto: multiempresa (escalado/facturación) y
-- documentos de imprenta (nicho). El equipo puede reactivarlos cuando quiera.
update modulos_catalogo set mostrar_en_diagnostico = false
  where clave in ('multiempresa', 'documentos_imprenta');

notify pgrst, 'reload schema';
