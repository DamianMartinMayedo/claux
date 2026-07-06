-- Moneda de visualización del catálogo público. Los precios de los ítems (que
-- pueden estar en distintas monedas, p.ej. al importar de Inventario) se
-- convierten a esta moneda según la tasa de cambio vigente (pares_tasa/tasas_cambio).
-- NULL → se usa la moneda de consolidación del cliente como defecto.
alter table clients add column if not exists catalogo_moneda text;
