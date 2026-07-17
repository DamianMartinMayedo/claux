-- ── Asesores como página del módulo Contabilidad (base) ──────────────────────────
--
-- El directorio de asesores (tabla `asesores`, migración 105) vivía en Perfil, que
-- lo mostraba a todos los clientes. Pasa a ser una página propia del módulo `base`
-- (Contabilidad): así SOLO aparece en el sidebar de quien tiene contabilidad
-- contratada, y su ruta `/portal/asesores` se gatea con requireModulo('base').
--
-- El sidebar se construye desde `modulos_catalogo.paginas` (ver PortalSidebar): con
-- añadir la página al módulo `base` basta para que aparezca en su grupo.

update modulos_catalogo
set paginas = paginas || '[{"ruta":"/portal/asesores","label":"Asesores","orden":7}]'::jsonb
where clave = 'base'
  and not (paginas @> '[{"ruta":"/portal/asesores"}]'::jsonb);
