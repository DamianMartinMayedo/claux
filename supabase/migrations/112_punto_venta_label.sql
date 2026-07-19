-- ================================================================
-- MIGRACIÓN 112: «Cajas» → «Puntos de venta» en el menú del módulo
--
-- El módulo ya se llama «Punto de venta», pero su primera página seguía
-- etiquetada «Cajas», y eso chocaba con las cajas de Tesorería (cuentas de
-- tipo CAJA): en la misma pantalla de configuración, «caja» significaba dos
-- cosas distintas —el terminal y la cuenta de efectivo—. El terminal pasa a
-- llamarse punto de venta; la caja de Tesorería se queda como está, que ahí
-- el nombre es el correcto.
--
-- Solo cambia la ETIQUETA. La ruta sigue siendo /portal/caja: cambiarla
-- rompería los enlaces guardados y el scope de la PWA ya instalada.
-- ================================================================

UPDATE modulos_catalogo
SET paginas = (
  SELECT jsonb_agg(
    CASE WHEN pagina->>'ruta' = '/portal/caja'
         THEN jsonb_set(pagina, '{label}', '"Puntos de venta"')
         ELSE pagina
    END
    ORDER BY (pagina->>'orden')::int
  )
  FROM jsonb_array_elements(paginas) AS pagina
)
WHERE clave = 'caja'
  AND paginas @> '[{"ruta": "/portal/caja", "label": "Cajas"}]'::jsonb;
