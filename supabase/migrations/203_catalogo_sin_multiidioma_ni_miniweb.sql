-- ================================================================
-- MIGRACIÓN 203: la SEMILLA del catálogo deja de prometer multi-idioma
--                y mini-web en `catalogo_qr`
--
-- Lo que vendían los ficheros de migración:
--
--   · «multi-idioma opcional», en la descripción sembrada por la mig. 017.
--     No existe: no hay columna de traducción en catalogo_categorias ni en
--     catalogo_items, no hay selector de idioma en CatalogoEditor.tsx y no hay
--     nada de idiomas en la vista pública. La carta se publica en uno solo.
--
--   · «+ mini-web» en el nombre, que le puso la mig. 079. La página pública es
--     la carta (categorías, ítems, fotos, precios); la mini-web completa
--     —horarios, ubicación— sigue pendiente, como dice CONTEXTO §2.
--
-- No es cosmético: `src/lib/publico/catalogo.ts` lee `nombre` y `descripcion`,
-- y la landing los pinta en la grilla de módulos (page.tsx → ModulesSection),
-- así que ese texto es lo que lee un cliente ANTES de contratar. El `nombre`
-- viaja además al presupuesto de instalación y a los documentos del cliente.
--
-- EN PRODUCCIÓN ESTO NO CAMBIA NADA, y es a propósito: la fila ya se corrigió a
-- mano desde /admin/modulos y hoy dice «Menú/catálogo digital». Esta migración
-- existe para que un entorno NUEVO —que se levanta corriendo 017 y 079— no
-- vuelva a nacer con la promesa. Deja la semilla exactamente en el texto vivo,
-- para que ambos entornos digan lo mismo.
--
-- Por eso los dos UPDATE van GUARDADOS por el valor antiguo: si alguien vuelve
-- a editar la ficha desde el admin, esto no le pisa el texto. En producción los
-- guardas no casan y la migración es un no-op limpio.
-- La landing es ISR: cualquier cambio se ve en la siguiente revalidación.
-- ================================================================

update modulos_catalogo
set nombre = 'Menú/catálogo digital'
where clave = 'catalogo_qr'
  and nombre = 'Catálogo digital + mini-web';

update modulos_catalogo
set descripcion = 'Tu carta o catálogo con fotos y precios, que tus clientes abren escaneando un código QR.'
where clave = 'catalogo_qr'
  and descripcion = 'Carta/catálogo por QR, mini-web pública, multi-idioma opcional';
