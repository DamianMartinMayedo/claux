-- ================================================================
-- MIGRACIÓN 226: la columna en euros deja de ser paridad
--
-- La 225 sembró los euros IGUALADOS al dólar (20 → 20) para que el catálogo
-- naciera completo. Eso no es un precio: cambiar de moneda en la ficha no movía
-- ni una cifra, y el euro acababa cobrándose como si valiera lo mismo que el
-- dólar.
--
-- LA TASA, Y POR QUÉ ESA. Se tarifa a **1 EUR = 1,05 USD** (euro = dólar × 0,95),
-- con el mercado entre 1,08 y 1,16: el diferencial se queda en casa y paga el
-- coste de facturar y cobrar desde España. El redondeo es **siempre hacia
-- arriba, al medio euro** (23,75 → 24,00), por el mismo motivo: si hay que
-- ceder medio euro, que lo ceda el cliente y no la caja.
--
-- SIGUE SIENDO UN PRECIO PROPIO, NO UNA CONVERSIÓN. Esto es una SEMILLA: fija el
-- punto de partida del catálogo, y a partir de aquí cada celda se teclea en
-- /admin/modulos. Por eso solo toca las filas que siguen en paridad exacta
-- (`_eur = _usd` en los tres niveles): una celda ya ajustada a mano no se pisa.
--
-- LA TARIFA DE LA HORA NO SE TOCA: ya está tecleada (19 €/h sobre 20 $/h, la
-- misma tasa) y es del dueño.
-- ================================================================

-- Euro = dólar × 0,95 redondeado hacia arriba al medio euro.
create or replace function public.claux_eur_desde_usd(usd numeric)
returns numeric language sql immutable as $$
  -- `round(...,2)` no cambia el importe (siempre cae en medio euro): fija la ESCALA.
  -- Sin él la división deja 9.5000000000000000, y eso es lo que se ve en el input del panel.
  select round(ceil(usd * 0.95 * 2) / 2, 2);
$$;

comment on function public.claux_eur_desde_usd(numeric) is
  'Semilla del precio en euros desde el de dólares: ×0,95 (1 EUR = 1,05 USD) redondeado hacia arriba al medio euro. Solo para sembrar; el precio vivo es el de la columna.';

update public.modulos_catalogo set
  precio_inicial_eur = public.claux_eur_desde_usd(precio_inicial_usd),
  precio_empresa_eur = public.claux_eur_desde_usd(precio_empresa_usd),
  precio_pro_eur     = public.claux_eur_desde_usd(precio_pro_usd),
  updated_at         = now()
where precio_inicial_eur = precio_inicial_usd
  and precio_empresa_eur = precio_empresa_usd
  and precio_pro_eur     = precio_pro_usd;

-- La caché en euros de la cartera se rehace entera: es Σ de lo que acaba de
-- cambiar. Sin esto, el MRR en euros seguiría contando los precios de paridad.
update public.clients c set
  precio_mensual_eur = coalesce((
    select sum(
      case lower(coalesce(c.nivel, 'inicial'))
        when 'empresa' then m.precio_empresa_eur
        when 'pro'     then m.precio_pro_eur
        else                m.precio_inicial_eur
      end)
    from public.modulos_catalogo m
    where m.activo and m.clave = any(coalesce(c.modulos_activos, '{}'::text[]))
  ), 0);

notify pgrst, 'reload schema';
