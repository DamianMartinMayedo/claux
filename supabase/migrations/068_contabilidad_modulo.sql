-- ================================================================
-- MIGRACIÓN 068: Contabilidad deja de ser "base" y pasa a ser un módulo
--
-- La contabilidad ya era opcional (067 + cambios de portal/admin). Este paso
-- retira su categoría especial: pasa de tipo='base'/es_base=true a un módulo
-- normal (tipo='modulo', es_base=false). La CLAVE sigue siendo 'base' (todo el
-- wiring depende de ella: modulos_activos, requireModulo('base'), recomendación,
-- mapeo del diagnóstico), solo cambia su categoría/presentación.
-- ================================================================

update modulos_catalogo
set tipo = 'modulo', es_base = false
where clave = 'base';

notify pgrst, 'reload schema';
