-- ── Landing: mostrar Multiempresa, ocultar Multidossier ──────────────────────
--
-- En la grilla "Los módulos que tú eliges" (src/app/(landing)/page.tsx →
-- ModulesSection, que lista modulos_catalogo con mostrar_en_landing = true) se
-- mostraba el addon Multidossier. Decisión de producto: en la landing se
-- comunica Multiempresa; Multidossier no se menciona ahí.
--
-- Solo toca el flag de visibilidad en landing; ambos addons siguen activos y
-- contratables. La landing usa ISR, así que se refleja en la próxima
-- revalidación.
update modulos_catalogo set mostrar_en_landing = true  where clave = 'multiempresa';
update modulos_catalogo set mostrar_en_landing = false where clave = 'multidossier';
