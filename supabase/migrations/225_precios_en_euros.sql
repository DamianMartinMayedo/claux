-- ================================================================
-- MIGRACIÓN 225: CLAUX cobra en dos monedas (USD y EUR)
--
-- Plan: docs/planes/precios-en-euros.md
--
-- POR QUÉ. Los precios de CLAUX están en dólares y a algunos clientes hay que
-- facturarlos desde España, en euros. Hasta hoy el euro salía de convertir con la
-- tasa del día, así que lo facturado y lo pagado no coincidían nunca. Lo que hace
-- falta no es una conversión: es un **precio propio en euros**, fijo, que el dueño
-- teclea igual que teclea el de dólares.
--
-- LAS TRES REGLAS, que no son la misma:
--
--   1. TARIFA → las dos columnas, siempre las dos. `precio_*_eur` junto a
--      `precio_*_usd`. No guardan ninguna proporción entre sí a propósito: son
--      dos precios comerciales, no un importe y su cambio.
--   2. CACHÉ → las dos, siempre las dos. `clients.precio_mensual_eur` junto a la
--      de dólares. Cuesta cero (la rehace `recalcularCuotas`) y deja **una cifra
--      comparable** para el MRR: sumar una cartera en dos monedas no significa nada.
--   3. HECHO CONSUMADO → una cifra + `moneda`, y la columna pierde el `_usd`.
--      Un presupuesto se emite en una moneda y un cobro entra en una moneda;
--      guardar el gemelo de la otra sería inventarse el dato.
--
-- POR QUÉ RENOMBRAR Y NO AÑADIR. Mismo motivo que la mig. 214: `monto_usd`
-- conteniendo euros no da error nunca, y un `$` cableado encima sobrevive para
-- siempre. El renombrado rompe la compilación en los ~115 sitios que citan estas
-- columnas, y eso es lo que se busca. **Es el mecanismo de seguridad, no un
-- efecto colateral.**
--
-- LA SEMILLA ES PARIDAD, NO UNA TASA. Las columnas en euros nacen igualadas a las
-- de dólares (20 → 20). No es una conversión ni pretende serlo: es un punto de
-- partida redondo para que el catálogo esté completo desde el primer minuto y
-- `audit:nivel` no se encuentre módulos a cero (que `precioModulo` leería como
-- GRATIS). El dueño ajusta cada celda en /admin/modulos, o resiembra la columna
-- entera con el multiplicador que quiera desde el mismo panel.
--
-- LAS FIRMAS VIGENTES NO SE MUEVEN. La versión del Anexo I y la del contrato
-- sellan su contenido, y ahora llevan la moneda dentro. Sin el renombrado del
-- final, TODA la cartera en dólares vería sus documentos como pendientes y
-- tendría que volver a firmar exactamente lo mismo. Es el mismo arreglo que ya
-- hicieron la 204 y la 218, por el mismo motivo. El hash y el snapshot no se
-- tocan: lo firmado sigue siendo lo firmado.
-- ================================================================

-- ── 1. Catálogo: el precio en euros de cada módulo, en cada nivel ────────────
alter table public.modulos_catalogo
  add column if not exists precio_inicial_eur numeric not null default 0,
  add column if not exists precio_empresa_eur numeric not null default 0,
  add column if not exists precio_pro_eur     numeric not null default 0;

comment on column public.modulos_catalogo.precio_inicial_eur is 'Precio mensual en el nivel Inicial (EUR). Propio, no derivado del de USD.';
comment on column public.modulos_catalogo.precio_empresa_eur is 'Precio mensual en el nivel Empresa (EUR). Propio, no derivado del de USD.';
comment on column public.modulos_catalogo.precio_pro_eur     is 'Precio mensual en el nivel Pro (EUR). Propio, no derivado del de USD.';

update public.modulos_catalogo set
  precio_inicial_eur = precio_inicial_usd,
  precio_empresa_eur = precio_empresa_usd,
  precio_pro_eur     = precio_pro_usd,
  updated_at         = now()
where precio_inicial_eur = 0 and precio_empresa_eur = 0 and precio_pro_eur = 0;

-- ── 2. El cliente se factura en una moneda, y su cuota se cachea en las dos ──
alter table public.clients
  add column if not exists moneda_facturacion text    not null default 'USD',
  add column if not exists precio_mensual_eur numeric not null default 0;

alter table public.clients drop constraint if exists clients_moneda_facturacion_check;
alter table public.clients
  add constraint clients_moneda_facturacion_check check (moneda_facturacion in ('USD', 'EUR'));

comment on column public.clients.moneda_facturacion is
  'Moneda en la que se factura HOY a este cliente. Es mutable: puede pagar en euros un mes y en dólares el siguiente. Cambiarla mueve la versión del Anexo I y obliga a re-firmar.';
comment on column public.clients.precio_mensual_eur is
  'Caché de la cuota de catálogo en euros (Σ módulos activos en la columna del nivel), sin descuento. Gemela de precio_mensual_usd; las dos se mantienen siempre.';

-- Caché inicial en euros: la misma suma, por la columna en euros del nivel.
-- `activo` filtra igual que `sumarModulos`; si aquí contara un módulo archivado,
-- la previsualización del panel y el cobro dirían cifras distintas.
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

-- ── 3. El presupuesto se emite en UNA moneda ────────────────────────────────
alter table public.presupuestos_instalacion
  add column if not exists moneda text not null default 'USD';

alter table public.presupuestos_instalacion drop constraint if exists presupuestos_instalacion_moneda_check;
alter table public.presupuestos_instalacion
  add constraint presupuestos_instalacion_moneda_check check (moneda in ('USD', 'EUR'));

comment on column public.presupuestos_instalacion.moneda is
  'Moneda en la que se emitió este presupuesto. Congelada: un presupuesto enseñado hace tres meses se imprime tal cual. Puede diferir de clients.moneda_facturacion.';

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'presupuestos_instalacion'
                and column_name = 'coste_instalacion_usd')
  then alter table public.presupuestos_instalacion rename column coste_instalacion_usd to coste_instalacion; end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'presupuestos_instalacion'
                and column_name = 'cuota_mensual_usd')
  then alter table public.presupuestos_instalacion rename column cuota_mensual_usd to cuota_mensual; end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'presupuestos_instalacion'
                and column_name = 'total_final_usd')
  then alter table public.presupuestos_instalacion rename column total_final_usd to total_final; end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'presupuestos_instalacion'
                and column_name = 'tarifa_hora_usd')
  then alter table public.presupuestos_instalacion rename column tarifa_hora_usd to tarifa_hora; end if;
end $$;

-- El snapshot del desglose lleva el sufijo dentro de cada fase. Se renombra la
-- clave del JSON en vez de leer las dos en el código: un `subtotalUsd ?? subtotal`
-- eterno es la deuda que nadie retira después.
update public.presupuestos_instalacion
set    desglose = (
         select jsonb_agg(
                  case when e ? 'subtotalUsd'
                       then (e - 'subtotalUsd') || jsonb_build_object('subtotal', e -> 'subtotalUsd')
                       else e
                  end
                  order by ord)
         from jsonb_array_elements(desglose) with ordinality as t(e, ord)
       )
where  jsonb_typeof(desglose) = 'array'
  and  exists (select 1 from jsonb_array_elements(desglose) e where e ? 'subtotalUsd');

-- ── 4. El cobro entra en UNA moneda ─────────────────────────────────────────
alter table public.payments
  add column if not exists moneda text not null default 'USD';

alter table public.payments drop constraint if exists payments_moneda_check;
alter table public.payments
  add constraint payments_moneda_check check (moneda in ('USD', 'EUR'));

comment on column public.payments.moneda is
  'Moneda en la que entró este cobro. Un cliente puede pagar en euros un mes y en dólares el siguiente; cada fila lleva la suya.';

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'payments' and column_name = 'monto_usd')
  then alter table public.payments rename column monto_usd to monto; end if;
end $$;

comment on column public.payments.monto is
  'Importe cobrado, EN LA MONEDA DE LA FILA (columna `moneda`). Se llamaba monto_usd y dejó de ser cierto al aparecer el euro.';

-- ── 5. La hora de instalación tiene precio propio en euros ──────────────────
-- No se convierte: es una tarifa, y las tarifas se teclean. Nace igualada a la de
-- dólares por el mismo criterio que el catálogo.
insert into public.settings (key, value)
select 'tarifa_hora_eur', coalesce((select value from public.settings where key = 'tarifa_hora_usd'), '20')
on conflict (key) do nothing;

-- ── 6. Las firmas vigentes en dólares conservan su versión ──────────────────
-- La moneda entra en la cadena de versión (documentos.ts y las plantillas). Estos
-- tres UPDATE dicen «lo que ya estaba firmado era en dólares» sin cambiar nada de
-- lo pactado, para que nadie tenga que firmar dos veces lo mismo. Solo las
-- VIGENTES: una firma caducada es prueba histórica y no se reescribe jamás.

-- Anexo I con presupuesto enlazado: presupuesto-<id>-<ciclo>-… → presupuesto-<id>-usd-<ciclo>-…
update public.firmas_documentos
set    version = regexp_replace(version, '^(presupuesto-[0-9]+)-', '\1-usd-')
where  tipo = 'presupuesto'
  and  caducada_at is null
  and  version ~ '^presupuesto-[0-9]+-';

-- Anexo I autogenerado: modulos-<ciclo>-… → modulos-usd-<ciclo>-…
update public.firmas_documentos
set    version = regexp_replace(version, '^modulos-', 'modulos-usd-')
where  tipo = 'presupuesto'
  and  caducada_at is null
  and  version like 'modulos-%';

-- Contrato: la cláusula 5 dice la moneda en su cuerpo, así que el texto pasa a
-- tener una variante por moneda. El de dólares queda BYTE A BYTE igual —por eso
-- el hash sigue cuadrando—, solo cambia el nombre de la versión.
update public.firmas_documentos
set    version = version || '-usd'
where  tipo = 'contrato'
  and  caducada_at is null
  and  version not like '%-usd'
  and  version not like '%-eur';

notify pgrst, 'reload schema';
