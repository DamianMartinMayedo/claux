-- ================================================================
-- MIGRACIÓN 215: el cliente tiene nivel, descuento y bandera de socio
--
-- Plan: docs/planes/niveles-comerciales.md § 4.3, § 7.2 y § 10
--
-- 1) `tarifa` → `nivel`.
--    Mismo motivo que el renombrado de precios de la 214: obliga al compilador a
--    encontrar los 21 ficheros que hoy dicen «fundador». Y de paso deshace una
--    ambigüedad que ya mordía: en el presupuesto de instalación existe
--    `TARIFA_HORA`, que es el $/h del montaje y NO tiene nada que ver con esto.
--    Con `nivel` ya no hay dos cosas llamándose igual.
--
--    El mapeo conserva lo que cada cliente pagaba:
--      fundador → inicial   (el precio de lista del negocio pequeño)
--      estandar → empresa   (el nivel medio)
--    El default pasa de 'estandar' a 'inicial': un cliente nuevo nace en el nivel
--    de entrada, no en el medio.
--
-- 2) Descuento sobre la CUOTA MENSUAL, con ventana de validez.
--    Es independiente del que ya existe en `presupuestos_instalacion` (ese es del
--    montaje): se negocian y se envían por separado. Lo caro de un descuento no es
--    aplicarlo, es CADUCARLO y avisarlo — de ahí `desde`/`hasta`, que es el mismo
--    patrón de ventana que `caja_descuentos` (mig. 210).
--
-- 3) `es_socio`: BANDERA, no estado.
--    Un Socio CLAUX es un negocio al que no se le cobra, por un período
--    prolongable, y que lo ve en su portal. `estado` mueve la maquinaria de corte
--    (pantalla de bloqueado, vencimientos, cobros) y un socio conserva su ciclo de
--    vida por debajo: puede estar en TRIAL o GRACIA, y puede vencer cuando la
--    relación acabe. Meterlo como sexto estado colapsaría dos ejes independientes
--    y obligaría a auditar cada `switch (estado)` del sistema.
--
--    NO CONFUNDIR con `admin_users.rol = 'partner'` (mig. 205), que es el
--    REVENDEDOR externo y es una frontera de acceso. Son cosas distintas y una
--    misma persona puede ser las dos a la vez. Por eso esta se llama «socio».
--
--    Un socio SÍ tiene nivel y SÍ tiene límites: es gratis, no ilimitado. Así, el
--    día que convierta, no cambia nada salvo que empieza a pagar.
--
-- 4) `limites_override`: excepciones de límite por cliente.
--    Misma forma que `ia_config`, que ya funciona así con el cupo de IA. Es la
--    válvula del acantilado Inicial→Empresa: un cliente que solo se pasa en una
--    dimensión no tiene por qué duplicar la factura. {"trabajadores": 150}.
-- ================================================================

-- ── 1) tarifa → nivel ────────────────────────────────────────────
alter table public.clients rename column tarifa to nivel;

alter table public.clients alter column nivel drop default;

update public.clients set nivel = case nivel
  when 'fundador' then 'inicial'
  when 'estandar' then 'empresa'
  else 'inicial'
end;

alter table public.clients alter column nivel set default 'inicial';

alter table public.clients drop constraint if exists clients_nivel_check;
alter table public.clients
  add constraint clients_nivel_check check (nivel in ('inicial', 'empresa', 'pro'));

comment on column public.clients.nivel is
  'inicial | empresa | pro. Nivel comercial contratado: fija el precio de cada módulo '
  '(modulos_catalogo.precio_*_usd) y los límites de capacidad (nivel_limites). '
  'No confundir con TARIFA_HORA del presupuesto de instalación, que es otra cosa.';

-- ── 2) Descuento sobre la cuota mensual ──────────────────────────
alter table public.clients add column if not exists descuento_pct    numeric not null default 0;
alter table public.clients add column if not exists descuento_desde  date;
alter table public.clients add column if not exists descuento_hasta  date;
alter table public.clients add column if not exists descuento_motivo text;

alter table public.clients drop constraint if exists clients_descuento_pct_check;
alter table public.clients
  add constraint clients_descuento_pct_check check (descuento_pct >= 0 and descuento_pct <= 100);

comment on column public.clients.descuento_pct is
  '% de descuento sobre la CUOTA MENSUAL. Independiente del descuento del presupuesto de '
  'instalación. Solo cuenta si hoy está dentro de [descuento_desde, descuento_hasta]; '
  'hasta NULL = indefinido.';

-- ── 3) Socio CLAUX ───────────────────────────────────────────────
alter table public.clients add column if not exists es_socio     boolean not null default false;
alter table public.clients add column if not exists socio_hasta  date;
alter table public.clients add column if not exists socio_motivo text;

comment on column public.clients.es_socio is
  'Socio CLAUX: no se le genera cobro mientras esté vigente (socio_hasta NULL = indefinido). '
  'Conserva nivel y límites: es gratis, no ilimitado. NO confundir con admin_users.rol='
  '''partner'' (mig. 205), que es el revendedor externo.';

-- ── 4) Excepciones de límite por cliente ─────────────────────────
alter table public.clients
  add column if not exists limites_override jsonb not null default '{}'::jsonb;

comment on column public.clients.limites_override is
  'Excepciones de límite para este cliente, por dimensión: {"trabajadores": 150}. '
  'Gana sobre nivel_limites. Mismo patrón que ia_config.cupo.';

notify pgrst, 'reload schema';
